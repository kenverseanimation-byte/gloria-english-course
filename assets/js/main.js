// Entry screen, full-screen intro video, sound, looping videos, navigation, tilt cards, legality dialog and the 3D scene hookup.
import { sound } from './audio.js';
import { createIntro } from './intro-video.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const gsap = window.gsap;
// ?motion=full shows the full animation even when the device asks for reduced motion (for testing)
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches && !/[?&]motion=full/.test(location.search);
const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

// ---------- 3D background scene (optional: the page works without WebGL) ----------
// Loaded alongside the page, not before it: the page is ready at once even on a slow connection, and the globe
// joins whatever is happening when it arrives (attachWorld, below).
let world = null;
import('./scene.js')
  .then(({ createScene }) => createScene($('#scene'), { reduced }))
  .then(w => { if (w) attachWorld(w); else $('#scene').style.display = 'none'; })
  .catch(err => { console.warn('Gloria: 3D scene unavailable', err); $('#scene').style.display = 'none'; });

// ---------- intro video, downloaded while the entry screen is up so it starts instantly ----------
const introEl = $('#intro');
const intro = createIntro({ el: introEl, veil: $('#veil'), reduced });

// ---------- entry gate and loading ----------
const gate = $('#gate');
const tasks = { fonts: false, sound: false, video: false };
document.fonts?.ready.then(() => { tasks.fonts = true; });
sound.ready.then(() => { tasks.sound = true; }); // music and intro accents decoded, so they start with the video
intro.ready.then(() => { tasks.video = true; });
setTimeout(() => { tasks.fonts = true; tasks.sound = true; }, 6000);
setTimeout(() => { tasks.video = true; }, 15000); // slow connection: the video streams instead

if (gate) {
  const bar = $('.gate__bar', gate), pct = $('.gate__pct', gate), label = $('.gate__state', gate);
  const t0 = performance.now();
  let shown = 0;
  const tick = () => {
    // the video is most of the download, so it carries most of the bar
    const done = tasks.fonts * .1 + tasks.sound * .15 + (tasks.video ? 1 : Math.min(.99, intro.progress)) * .75;
    const time = Math.min(1, (performance.now() - t0) / 1400);
    shown += (Math.min(done, time) - shown) * .12;
    if (done > .999 && time === 1 && shown > .995) shown = 1;
    bar.style.setProperty('--p', shown.toFixed(3));
    bar.setAttribute('aria-valuenow', String(Math.round(shown * 100)));
    pct.textContent = `${Math.round(shown * 100)}%`;
    if (shown < 1) requestAnimationFrame(tick); else label.textContent = 'Siap';
  };
  tick();
}

let entered = false, introDone = false, introRunning = false, videosAllowed = false, activeScene = 'hero';
function enter(withSound) {
  if (entered) return;
  entered = true;
  sound.prime();
  if (withSound) sound.enable();
  sound.click();
  scrollTo(0, 0);
  root.classList.add('is-entered', 'is-intro');
  if (gate) {
    gate.classList.add('is-out');
    gate.setAttribute('aria-hidden', 'true');
    setTimeout(() => gate.remove(), 700);
  }
  world?.setSection('hero');
  runIntro(); // inside the tap, so the video is allowed to play
  unlockVideos(); // and the home page videos may start later on their own
}
$$('[data-enter]').forEach(b => b.addEventListener('click', () => enter(b.dataset.enter === 'sound')));
addEventListener('keydown', e => {
  if (!entered && e.key === 'Enter' && e.target === document.body) enter(true);
});

function runIntro() {
  introRunning = true;
  // the intro is opaque and fills the screen: stop drawing the globe behind it so the video has the GPU to itself
  world?.hold(true);
  intro.play({
    // picture and sound start from the moment the first video frame is on screen and share one clock
    onStart: (startedAt, { withVideo }) => sound.startIntro(startedAt, { withAccents: withVideo }),
    onResync: startedAt => sound.playSting(startedAt), // the video was held up: the accents wait for it
    // half a second before the home page shows, under the intro: the globe starts drawing again, so its first
    // frames are not spent at the moment of the hand-off
    // the home page videos start then too, so their first frame never shows as a jump after the veil
    onWarm: () => { world?.hold(false); world?.setSection(activeScene); videosAllowed = true; syncVideos(); },
    onReveal: endIntro,
  }).then(finishIntro);
}
// runs when the dark veil is deepest: the home page goes in underneath and is already rising as the veil lifts
function endIntro() {
  if (introDone) return;
  introDone = true;
  const heroBits = $$('.hero__copy > *');
  if (gsap && !reduced) gsap.set(heroBits, { autoAlpha: 0, y: 34 });
  if (introRunning) introEl.classList.add('is-leaving'); // the intro keeps fading out on top
  root.classList.remove('is-intro');
  // the headline rises out of the dark as the veil lifts
  if (gsap && !reduced) gsap.to(heroBits, { autoAlpha: 1, y: 0, duration: 1.2, delay: .2, stagger: .09, ease: 'power3.out', clearProps: 'transform' });
  world?.hold(false);
  world?.setSection(activeScene);
  sound.allowMusic(); // the music started with the intro and carries on; this only matters if it had not
  videosAllowed = true;
  syncVideos();
}
function finishIntro() {
  endIntro();
  introRunning = false;
  introEl.classList.remove('is-leaving');
}
function skipIntro() {
  const startedAt = intro.skip();
  if (startedAt != null) sound.playSting(startedAt); // the accents jump with the picture
}
$('#skip-intro').addEventListener('click', skipIntro);
addEventListener('keydown', e => { if (e.key === 'Escape' && entered && !introDone) skipIntro(); });

// ---------- videos loop silently and keep moving while they are on screen ----------
// An iPhone in Low Power Mode refuses to start a video that a tap did not start, even a silent one. So every
// page video is unlocked inside the entry tap (unlockVideos), a refused video tries again on the visitor's next
// touch, and if it is still refused its frame shows a play button.
// The files load only when needed (their address waits in data-src): nothing until the intro video has
// downloaded, then each one once it is within about two screens. A visitor who never scrolls to the closing
// video does not download it.
const videos = $$('.screen video');
const inView = new Map(videos.map(v => [v, false]));
const near = new Map(videos.map(v => [v, false]));
const blocked = new Set();
let loadAllowed = false;
function loadVideo(v) {
  if (!v.getAttribute('src') && v.dataset.src) v.src = v.dataset.src;
}
function loadNearVideos() {
  if (loadAllowed) videos.forEach(v => { if (near.get(v)) loadVideo(v); });
}
const nearObserver = new IntersectionObserver(entries => {
  entries.forEach(e => near.set(e.target, e.isIntersecting));
  loadNearVideos();
}, { rootMargin: '200% 0px' });
videos.forEach(v => nearObserver.observe(v));
intro.ready.then(() => { loadAllowed = true; loadNearVideos(); });
function setBlocked(v, on) {
  if (on) blocked.add(v); else blocked.delete(v);
  v.closest('.screen').classList.toggle('is-blocked', on);
}
function playVideo(v) {
  const p = v.play();
  if (p && p.then) p.then(() => setBlocked(v, false), err => { if (err && err.name === 'NotAllowedError') setBlocked(v, true); });
}
function syncVideos() {
  videos.forEach(v => {
    if (videosAllowed && inView.get(v)) { loadVideo(v); if (v.paused) playVideo(v); }
    else if (!v.paused) v.pause();
  });
}
// inside a tap the browser lets any video start; once started that way it may be started again later without one.
// A video whose file is not loaded yet is unlocked all the same, and nothing is downloaded for it.
function unlockVideos() {
  videos.forEach(v => {
    if (!v.paused) return;
    const p = v.play();
    if (p && p.catch) p.catch(() => {}); // the pause below interrupts it; that is expected
    v.pause();
  });
}
['touchend', 'click'].forEach(type => document.addEventListener(type, () => { if (blocked.size) syncVideos(); }, { capture: true, passive: true }));
videos.forEach(v => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'screen__play';
  btn.setAttribute('aria-label', 'Putar video');
  btn.addEventListener('click', () => playVideo(v));
  v.closest('.screen').append(btn);
});
const videoObserver = new IntersectionObserver(entries => {
  entries.forEach(e => inView.set(e.target, e.isIntersecting));
  syncVideos();
}, { rootMargin: '120px 0px' });
videos.forEach(v => { v.muted = true; videoObserver.observe(v); });
document.addEventListener('visibilitychange', () => { if (!document.hidden) syncVideos(); });

// ---------- sound button ----------
const soundBtn = $('#sound');
sound.onChange(on => {
  soundBtn.setAttribute('aria-pressed', String(on));
  $('.sound__label', soundBtn).textContent = on ? 'Suara nyala' : 'Suara mati';
});
soundBtn.addEventListener('click', () => sound.toggle());
addEventListener('keydown', e => {
  if ((e.key === 'm' || e.key === 'M') && entered && !e.target.closest('input, textarea')) sound.toggle();
});

// interface sounds on links, buttons and cards
document.addEventListener('pointerover', e => { if (e.target.closest('a, button, [data-tilt]')) sound.hover(); });
document.addEventListener('click', e => { if (entered && e.target.closest('a, button:not([data-enter]):not(#sound)')) sound.click(); });

// ---------- navigation ----------
const nav = $('#nav');
const menuBtn = $('.nav__menu');
const setMenu = open => {
  nav.classList.toggle('is-open', open);
  menuBtn.setAttribute('aria-expanded', String(open));
  menuBtn.textContent = open ? 'Tutup' : 'Menu';
};
menuBtn.addEventListener('click', () => setMenu(!nav.classList.contains('is-open')));
$$('.nav__links a').forEach(a => a.addEventListener('click', () => setMenu(false)));
addEventListener('keydown', e => { if (e.key === 'Escape') setMenu(false); });

const progress = $('.progress span');
let ticking = false;
const onScroll = () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const max = document.documentElement.scrollHeight - innerHeight;
    progress.style.setProperty('--s', max > 0 ? (scrollY / max).toFixed(4) : '0');
    nav.classList.toggle('is-scrolled', scrollY > 40);
    ticking = false;
  });
};
addEventListener('scroll', onScroll, { passive: true });
onScroll();

// the section crossing the middle of the screen sets the globe pose and the active menu link
const links = new Map($$('.nav__links a').map(a => [a.getAttribute('href').slice(1), a]));
const sectionObserver = new IntersectionObserver(entries => {
  entries.forEach(e => {
    if (!e.isIntersecting) return;
    activeScene = e.target.dataset.scene;
    if (entered && introDone) world?.setSection(activeScene);
    links.forEach((a, id) => a.classList.toggle('is-active', id === e.target.id));
  });
}, { rootMargin: '-48% 0px -48% 0px' });
$$('[data-scene]').forEach(s => sectionObserver.observe(s));

// ---------- reveal on scroll ----------
const revealObserver = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); revealObserver.unobserve(e.target); } });
}, { rootMargin: '0px 0px -12% 0px' });
$$('.reveal').forEach(el => revealObserver.observe(el));

// ---------- 3D tilt cards ----------
if (finePointer && !reduced) {
  $$('[data-tilt]').forEach(card => {
    let raf = 0;
    card.addEventListener('pointermove', e => {
      const r = card.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        card.classList.add('is-tilting');
        card.style.setProperty('--ry', `${((px - .5) * 14).toFixed(2)}deg`);
        card.style.setProperty('--rx', `${((.5 - py) * 11).toFixed(2)}deg`);
        card.style.setProperty('--gx', `${(px * 100).toFixed(1)}%`);
        card.style.setProperty('--gy', `${(py * 100).toFixed(1)}%`);
      });
    });
    card.addEventListener('pointerleave', () => {
      cancelAnimationFrame(raf);
      card.classList.remove('is-tilting');
      card.style.setProperty('--rx', '0deg');
      card.style.setProperty('--ry', '0deg');
    });
  });
}

// ---------- legality dialog ----------
const dialog = $('#izin');
const tabs = $$('[role="tab"]', dialog);
const selectTab = tab => {
  tabs.forEach(t => {
    const on = t === tab;
    t.setAttribute('aria-selected', String(on));
    t.tabIndex = on ? 0 : -1;
    document.getElementById(t.getAttribute('aria-controls')).hidden = !on;
  });
  $('.izin__body', dialog).scrollTop = 0;
};
tabs.forEach((t, i) => {
  t.addEventListener('click', () => selectTab(t));
  t.addEventListener('keydown', e => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    selectTab(next); next.focus();
  });
});
$$('[data-open-izin]').forEach(b => b.addEventListener('click', () => {
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
  sound.open();
}));
// browsers without <dialog> support (Safari before 15.4) have no close(): remove the open attribute instead
const closeDialog = () => { if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open'); };
$('[data-close]', dialog).addEventListener('click', closeDialog);
dialog.addEventListener('click', e => { if (e.target === dialog) closeDialog(); });

// ---------- cursor ring ----------
if (finePointer && !reduced) {
  const ring = $('.cursor');
  let x = -100, y = -100, cx = x, cy = y;
  addEventListener('pointermove', e => { x = e.clientX; y = e.clientY; }, { passive: true });
  document.addEventListener('pointerover', e => ring.classList.toggle('is-hover', !!e.target.closest('a, button, [data-tilt]')));
  const follow = () => {
    cx += (x - cx) * .22; cy += (y - cy) * .22;
    ring.style.transform = `translate3d(${cx.toFixed(1)}px, ${cy.toFixed(1)}px, 0)`;
    requestAnimationFrame(follow);
  };
  follow();
}

// ---------- the globe joins when it has loaded ----------
const pin = $('#pin-label');
function attachWorld(w) {
  world = w;
  // match what the page is doing now: hidden behind the running intro, or posed for the current section
  if (introRunning && !videosAllowed) world.hold(true);
  world.setSection(introDone ? activeScene : entered ? 'hero' : 'gate');
  // label that follows the Bali marker on the globe
  world.onPin((px, py, visible) => {
    pin.style.setProperty('--x', `${px.toFixed(1)}px`);
    pin.style.setProperty('--y', `${py.toFixed(1)}px`);
    pin.classList.toggle('is-on', visible && innerWidth >= 1024);
  });
}

// this script arrived after the head script had already shown the plain page (a very slow connection):
// carry on from there without the intro, so the videos, the music button and the globe still work
if (!gate || root.classList.contains('no-app')) {
  entered = true;
  loadAllowed = true;
  endIntro();
}

window.__gloriaReady = true;
