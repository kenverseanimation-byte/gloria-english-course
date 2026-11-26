// Full-screen opening before the home page: the Gloria logo video (assets/intro-gloria.mp4, 6.875 s, silent).
// The video is the user's 4K file trimmed (its dark first 0.7 s and the still logo after the turn are cut) and
// played 1.2x faster. Its sound is the site music (assets/bgm-futuristic.mp3) with assets/sfx-intro-video.mp3
// on top, both started from the moment the first video frame is on screen: the burst lands at 1.33 s, the picture
// sinks into a dark blur from 6.7 s and the home page comes up at 7.33 s (beat 11 of the music). The file is
// downloaded whole while the entry screen is up, so once it starts it never waits for the network.
const SRC = 'assets/intro-gloria.mp4';
const STILL = 'assets/intro-end.jpg';  // last frame: the finished logo, for the calm version
const VW = 1440, VH = 2312;            // video size in pixels
// share of the picture that always stays on screen, so the logo and the text are never cut: GLORIA is widest
// at about 3.4 s (11% to 89% of the width), the crown sits 15% from the top
const MIN_W = .86, MIN_H = .8;
const REVEAL = 7.333;                  // the home page appears (beat 11 of the music)
const REVEAL_CALM = 4;                 // the same for visitors who ask for less motion (on a beat of the music)
const SKIP_TO = 6.55;                  // "Lewati intro" jumps to the finished logo, just before the veil

export function createIntro({ el, veil, reduced = false }) {
  const stage = el.querySelector('.intro__stage');
  const video = el.querySelector('.intro__video');
  const gsap = window.gsap;
  video.muted = true;

  // ---------- size: as large as the screen allows without cutting into the logo or the text ----------
  function layout() {
    const w = innerWidth, h = innerHeight;
    const s = Math.min(Math.max(w / VW, h / VH), w / (VW * MIN_W), h / (VH * MIN_H));
    const sw = VW * s, sh = VH * s;
    el.style.setProperty('--iv-w', `${sw.toFixed(1)}px`);
    el.style.setProperty('--iv-h', `${sh.toFixed(1)}px`);
    // where the picture stops short of the screen, its edges fade into the background
    el.style.setProperty('--iv-fx', sw < w - 1 ? '14%' : '0%');
    el.style.setProperty('--iv-fy', sh < h - 1 ? '9%' : '0%');
  }
  layout();
  addEventListener('resize', layout);

  // ---------- download the whole video while the entry screen is up ----------
  let progress = 0, blobUrl = null;
  const abort = window.AbortController ? new AbortController() : null;
  const ready = reduced ? Promise.resolve((progress = 1, true)) : (async () => {
    try {
      const res = await fetch(SRC, { signal: abort?.signal });
      if (!res.ok) throw new Error(`${SRC}: ${res.status}`);
      const total = +res.headers.get('content-length') || 0;
      let blob;
      if (res.body && res.body.getReader && total) {
        const reader = res.body.getReader(), chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value); got += value.length;
          progress = Math.min(.99, got / total);
        }
        blob = new Blob(chunks, { type: 'video/mp4' });
      } else {
        blob = await res.blob();
      }
      if (!video.getAttribute('src')) { // not already streaming it (the visitor entered before it finished)
        blobUrl = URL.createObjectURL(blob);
        video.src = blobUrl;
        video.load();
      }
      return true;
    } catch (err) {
      return false; // play() streams it from the network instead
    } finally {
      progress = 1;
    }
  })();

  let tl = null, t0 = 0, raf = 0, started = false, calm = reduced, pendingSkip = false, onResync = null;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    // if the video was held up (a slow phone catching up), move the clock to the picture so the sound follows it
    if (!calm && !video.paused && !video.ended && video.readyState >= 3) {
      const videoClock = now - video.currentTime * 1000;
      if (Math.abs(videoClock - t0) > 120) { t0 = videoClock; onResync?.(t0); }
    }
    // the veil and the hand-off follow the same clock as the sound, even if a frame is dropped
    if (tl) tl.time(Math.max(0, (now - t0) / 1000));
  }
  function cleanup() {
    cancelAnimationFrame(raf);
    removeEventListener('resize', layout);
    video.pause();
    video.removeAttribute('src');
    video.load();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
  }

  return {
    /** Share of the video downloaded, 0 to 1 (1 also when the download failed and it will stream instead). */
    get progress() { return progress; },
    ready,
    /**
     * Plays the intro. Call it inside the tap that enters the site.
     * `onStart(startedAt, { withVideo })` runs when the first frame is on screen; `startedAt` is that moment in
     * performance.now() time, so the sound can start from the same clock.
     * `onResync(startedAt)` runs if the video was held up and the clock moved to follow it.
     * `onWarm` runs 0.6 s before the home page shows, while the intro still covers it.
     * `onReveal` runs when the dark veil is at its deepest: the home page goes in underneath and comes up as it lifts.
     */
    play({ onStart, onResync: resync, onWarm, onReveal } = {}) {
      onResync = resync;
      return new Promise(resolve => {
        if (!gsap) {
          // the animation library did not load: no intro, straight to the home page (the music still starts)
          started = true;
          onStart?.(performance.now(), { withVideo: false });
          onWarm?.();
          onReveal?.();
          cleanup();
          resolve();
          return;
        }
        const build = () => {
          const R = calm ? REVEAL_CALM : REVEAL;
          tl?.kill();
          tl = gsap.timeline({ paused: true, onComplete: () => { cleanup(); resolve(); } });
          if (calm) tl.fromTo(stage, { autoAlpha: 0 }, { autoAlpha: 1, duration: 1.4, ease: 'power1.inOut' }, 0);
          // the home page starts drawing underneath, hidden, so it is running smoothly when it shows
          tl.call(() => onWarm?.(), null, R - .6)
            // the finished logo sinks into a soft, dark blur
            .fromTo(veil, { autoAlpha: 0 }, { autoAlpha: 1, duration: .6, ease: 'power2.inOut' }, R - .63)
            // under the veil the home page goes in and the intro slips away
            .call(() => onReveal?.(), null, R)
            .to(el, { autoAlpha: 0, duration: .3, ease: 'power1.inOut' }, R)
            // then the veil lifts and the home page comes up out of the dark, sharpening as it clears
            .to(veil, { autoAlpha: 0, duration: 1, ease: 'power2.out' }, R + .25);
        };
        const begin = at => {
          if (started) return;
          started = true;
          if (pendingSkip && !calm) { try { video.currentTime = SKIP_TO; } catch (e) { /* not seekable yet */ } at -= SKIP_TO * 1000; }
          t0 = at;
          onStart?.(at, { withVideo: !calm });
          raf = requestAnimationFrame(frame);
        };
        // calm version, also used when the video cannot play: the finished logo fades in, then the veil
        const still = () => {
          if (started) return;
          calm = true;
          video.pause();
          video.removeAttribute('src'); // so the still image shows instead of a stuck frame
          video.load();
          video.poster = STILL;
          build();
          begin(performance.now());
        };

        if (calm) { video.poster = STILL; build(); begin(performance.now()); return; }
        build();
        if (!blobUrl) { abort?.abort(); video.src = SRC; } // still downloading: stream it instead
        // the clock starts when the first frame is really on screen
        if (video.requestVideoFrameCallback) {
          video.requestVideoFrameCallback((now, meta) => begin(meta.expectedDisplayTime - meta.mediaTime * 1000));
        }
        // browsers without frame callbacks (or if none arrives in time): the moment playback starts
        video.addEventListener('playing', () => {
          setTimeout(() => begin(performance.now() - video.currentTime * 1000), video.requestVideoFrameCallback ? 60 : 0);
        }, { once: true });
        const p = video.play();
        if (p && p.catch) p.catch(still);
        setTimeout(() => { if (!started) still(); }, 4000);
      });
    },
    /** Jump to the finished logo, then the veil and the home page. Returns the new start time, or null. */
    skip() {
      if (calm) { // straight to the veil
        if (started && (performance.now() - t0) / 1000 < REVEAL_CALM - .6) t0 = performance.now() - (REVEAL_CALM - .6) * 1000;
        return null;
      }
      if (!started) { pendingSkip = true; return null; }
      if ((performance.now() - t0) / 1000 >= SKIP_TO) return null;
      try { video.currentTime = SKIP_TO; } catch (e) { /* keep playing */ }
      t0 = performance.now() - SKIP_TO * 1000;
      return t0;
    },
  };
}
