// Sound for the site.
//   assets/bgm-futuristic.mp3   64 s seamless loop; starts with the intro video and carries on into the home page
//   assets/sfx-intro-video.mp3  accents for the intro video, laid over the music (same key and tempo):
//                               burst at 1.33 s, dark veil from 6.7 s, home page at 7.33 s
//   interface ticks             generated with the Web Audio API
// Everything plays through one Web Audio context. Both files are downloaded and decoded while the entry
// screen is up, so they start in the same frame as the intro video instead of loading after the tap.
// Nothing plays until the visitor chooses sound on the entry screen or with the sound button.
const BGM_SRC = 'assets/bgm-futuristic.mp3';
const STING_SRC = 'assets/sfx-intro-video.mp3';
const BGM_VOLUME = .8;
const BGM_LOOP = 64; // seconds: 24 bars at 90 BPM

let ctx = null, master, sfxBus, reverb;
let enabled = false, musicAllowed = false;
let padOut = null, padMode = false;
let stingBuf = null, stingSrc = null, stingGain = null, stingStartedAt = null;
let bgmBuf = null, bgmSrc = null, musicGain = null, musicStartedAt = null;
let suspendTimer = 0;
const listeners = new Set();
const emit = () => listeners.forEach(fn => fn(enabled));

// decode without a live audio context, so nothing needs a tap yet
function decodeBytes(data) {
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return Promise.reject(new Error('Web Audio unavailable'));
  return new Promise((ok, fail) => {
    const p = new OAC(2, 1, 44100).decodeAudioData(data, ok, fail);
    if (p && p.then) p.then(ok, fail);
  });
}
const fetchBytes = url => fetch(url).then(r => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); });

const stingReady = fetchBytes(STING_SRC).then(decodeBytes).then(b => { stingBuf = b; return true; }).catch(() => false);
// the music is decoded up front too: it starts with the first frame of the intro video
const bgmReady = fetchBytes(BGM_SRC).then(decodeBytes).then(b => { bgmBuf = b; return true; }).catch(() => { padMode = true; return false; });
const allReady = Promise.all([stingReady, bgmReady]).then(r => r.every(Boolean));

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
  reverb = ctx.createConvolver(); reverb.buffer = impulse(3.4, 2.8);
  const wet = ctx.createGain(); wet.gain.value = .5; reverb.connect(wet); wet.connect(master);
  return ctx;
}
function impulse(seconds, decay) {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return buf;
}
function whenRunning(fn) {
  if (!ctx) return;
  if (ctx.state === 'running') fn();
  else ctx.resume().then(fn, () => {});
}
function ramp(param, to, seconds) {
  const t = ctx.currentTime;
  param.cancelScheduledValues(t);
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + seconds);
}

// where a clock that started at `startedAt` (performance.now() time) is now, plus the time the sound takes to
// reach the speaker. Negative when the first video frame is still a few milliseconds away.
function clockAt(startedAt) {
  return (performance.now() - startedAt) / 1000 + (ctx.outputLatency || ctx.baseLatency || 0);
}

// ---------- intro accents, kept in step with the video clock ----------
function startSting() {
  if (!enabled || !ctx || !stingBuf || stingStartedAt == null) return;
  const offset = clockAt(stingStartedAt);
  if (offset >= stingBuf.duration - .05) return;
  stopSting(.03);
  const src = ctx.createBufferSource(), g = ctx.createGain();
  src.buffer = stingBuf; src.connect(g); g.connect(master);
  // joining part-way (sound switched on mid-intro, or the intro skipped): fade in briefly so there is no click
  if (offset > .05) { g.gain.value = 0; ramp(g.gain, 1, .04); }
  if (offset < 0) src.start(ctx.currentTime - offset, 0); else src.start(0, offset);
  src.onended = () => { if (stingSrc === src) { stingSrc = null; stingGain = null; } };
  stingSrc = src; stingGain = g;
}
function stopSting(fade = .12) {
  if (!stingSrc || !ctx) return;
  const src = stingSrc;
  ramp(stingGain.gain, 0, fade);
  try { src.stop(ctx.currentTime + fade + .02); } catch (e) { /* already stopped */ }
  stingSrc = null; stingGain = null;
}

// ---------- background music: a gapless loop of the decoded file ----------
// the mp3 encoder adds a few milliseconds of silence before the music; the loop starts after it
function contentStart(buf) {
  const n = Math.min(buf.length, Math.floor(buf.sampleRate * .1));
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < buf.numberOfChannels; c++) if (Math.abs(buf.getChannelData(c)[i]) > .01) return i / buf.sampleRate;
  }
  return 0;
}
function playMusic() {
  if (!enabled || !musicAllowed || !ensure()) return;
  if (padMode) { startPad(); return; }
  if (!bgmBuf) { bgmReady.then(playMusic); return; }
  if (!musicGain) { musicGain = ctx.createGain(); musicGain.gain.value = 0; musicGain.connect(master); }
  let fade = 2.6;
  if (!bgmSrc) {
    const src = ctx.createBufferSource(), start = contentStart(bgmBuf);
    const loopEnd = Math.min(bgmBuf.duration, start + BGM_LOOP), loopLen = loopEnd - start;
    src.buffer = bgmBuf; src.loop = true;
    src.loopStart = start; src.loopEnd = loopEnd;
    src.connect(musicGain);
    // the music runs on the intro clock: its first bar starts with the first video frame, so the home page
    // lands on its chord change; switched on later, it joins at the matching bar
    const at = clockAt(musicStartedAt);
    if (at < 0) src.start(ctx.currentTime - at, start); else src.start(0, start + (at % loopLen));
    fade = at < 1 ? .4 : 1.5;
    bgmSrc = src;
  }
  ramp(musicGain.gain, BGM_VOLUME, fade);
}
function stopMusic() {
  if (musicGain && ctx) ramp(musicGain.gain, 0, .45);
  if (padOut && ctx) padOut.gain.setTargetAtTime(0, ctx.currentTime, .3);
}

// fallback music when the mp3 cannot load: a soft generated pad
function startPad() {
  if (!ensure()) return;
  if (padOut) { padOut.gain.setTargetAtTime(.3, ctx.currentTime, 1.5); return; }
  padOut = ctx.createGain(); padOut.gain.value = 0; padOut.connect(master); padOut.connect(reverb);
  const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 900;
  filter.connect(padOut);
  [73.42, 110, 146.83, 164.81, 220, 277.18].forEach((f, i) => [-6, 6].forEach(det => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = i < 2 ? 'sine' : 'triangle'; o.frequency.value = f; o.detune.value = det;
    g.gain.value = i < 2 ? .14 : .05; o.connect(g); g.connect(filter); o.start();
  }));
  padOut.gain.setTargetAtTime(.3, ctx.currentTime, 2.5);
}

function tone(freq, dur, gain, type = 'sine', glide = 1, delay = 0, toReverb = false) {
  if (!enabled || !ctx) return;
  const t = ctx.currentTime + delay, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (glide !== 1) o.frequency.exponentialRampToValueAtTime(freq * glide, t + dur);
  g.gain.setValueAtTime(.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + .01);
  g.gain.exponentialRampToValueAtTime(.0001, t + dur);
  o.connect(g); g.connect(sfxBus); if (toReverb) g.connect(reverb);
  o.start(t); o.stop(t + dur + .05);
}
let lastHover = 0;

export const sound = {
  get on() { return enabled; },
  /** Resolves once the intro accents and the music are decoded (true) or one could not load (false). */
  ready: allReady,
  /** Call inside a tap or click: creates the audio context and lets later sounds play. */
  prime() {
    // iPhone: play even when the ring/silent switch is on silent
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* not supported */ }
    const c = ensure();
    if (c && c.state !== 'running') c.resume().catch(() => {});
  },
  enable() {
    this.prime();
    if (!ctx) return;
    enabled = true;
    clearTimeout(suspendTimer);
    ramp(master.gain, 1, .25);
    // switched on while the intro is still running: join the accents at the matching moment
    if (stingStartedAt != null && !stingSrc) stingReady.then(() => whenRunning(startSting));
    playMusic();
    emit();
  },
  disable() {
    enabled = false;
    if (ctx) {
      ramp(master.gain, 0, .2);
      stopSting(.2);
      // let the phone release its audio once everything has faded
      clearTimeout(suspendTimer);
      suspendTimer = setTimeout(() => { if (!enabled && ctx.state === 'running') ctx.suspend().catch(() => {}); }, 600);
    }
    stopMusic();
    emit();
  },
  toggle() { enabled ? this.disable() : this.enable(); },
  /**
   * The first intro video frame is on screen at `startedAt` (performance.now() time): start the music from its
   * first bar, and the accents with it when the video plays (`withAccents: false` for the still, calm version).
   */
  startIntro(startedAt = performance.now(), { withAccents = true } = {}) {
    musicStartedAt = startedAt;
    musicAllowed = true;
    if (withAccents) stingStartedAt = startedAt;
    if (!enabled) return;
    allReady.then(() => whenRunning(() => { if (withAccents) startSting(); playMusic(); }));
  },
  /** The intro jumped (skipped): the accents follow the video to its new position; the music carries on. */
  playSting(startedAt = performance.now()) {
    stingStartedAt = startedAt;
    if (!enabled) return;
    stingReady.then(() => whenRunning(startSting));
  },
  /** The home section is on screen: background music may start (it already has, unless there was no intro). */
  allowMusic() {
    if (musicStartedAt == null) musicStartedAt = performance.now();
    musicAllowed = true;
    playMusic();
  },
  hover() {
    const now = performance.now();
    if (now - lastHover < 90) return;
    lastHover = now;
    tone(2350, .07, .014, 'sine', 1.12);
  },
  click() {
    tone(660, .18, .04, 'triangle', 1.5);
    tone(1320, .32, .022, 'sine', 1, .03, true);
  },
  open() {
    tone(392, .5, .03, 'sine', 2, 0, true);
    tone(1046.5, .9, .02, 'sine', 1, .12, true);
    tone(1568, 1.1, .014, 'sine', 1, .2, true);
  },
  onChange(fn) { listeners.add(fn); },
};
