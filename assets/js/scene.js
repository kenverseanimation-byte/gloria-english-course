// Gold dotted globe with routes from Pulukan, Bali to the world, plus drifting gold dust.
// One fixed WebGL canvas behind the page; each section moves the globe to a new pose.
import * as THREE from '../vendor/three.module.min.js'; // three.js r160, kept on this site

const DEG = Math.PI / 180;
const GOLD = new THREE.Color('#D4AF37');
const PALE = new THREE.Color('#F3E5AB');
const ORIGIN = { lat: -8.39, lon: 114.84 }; // Pulukan, Jembrana
const CITIES = [
  [51.51, -0.13], [40.71, -74.0], [35.68, 139.69], [-33.87, 151.21], [1.35, 103.82],
  [25.2, 55.27], [43.65, -79.38], [37.57, 126.98], [48.86, 2.35], [-37.81, 144.96],
];

const latLon = (lat, lon, r = 1) => {
  const phi = (90 - lat) * DEG, th = (lon + 180) * DEG;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
};

// Poses per section: x, y = globe position, s = scale, arcs = how much of each route is drawn, dim = brightness, focus = turn Bali to the viewer.
const POSES = {
  wide: {
    gate:    { x: 0,    y: 0,     s: 1.0,  arcs: 0, dim: .5,  focus: 0 },
    hero:    { x: 0,    y: -2.45, s: 1.9,  arcs: 0, dim: .95, focus: 0 },
    future:  { x: 1.75, y: -.05,  s: 1.3,  arcs: 1, dim: 1,   focus: 1 },
    program: { x: -2.9, y: .5,    s: .85,  arcs: 1, dim: .4,  focus: 0 },
    about:   { x: 2.5,  y: -.55,  s: 1.15, arcs: 1, dim: .55, focus: 0 },
    legal:   { x: -2.5, y: -.3,   s: 1.0,  arcs: 1, dim: .45, focus: 0 },
    enroll:  { x: 0,    y: -2.6,  s: 1.8,  arcs: 1, dim: .45, focus: 0 },
    closing: { x: 0,    y: .1,    s: .62,  arcs: 1, dim: .3,  focus: 0 },
  },
  narrow: {
    gate:    { x: 0,    y: .1,    s: .7,   arcs: 0, dim: .45, focus: 0 },
    hero:    { x: 0,    y: -2.2,  s: 1.25, arcs: 0, dim: .9,  focus: 0 },
    future:  { x: .2,   y: 1.25,  s: .82,  arcs: 1, dim: .7,  focus: 1 },
    program: { x: .7,   y: 1.7,   s: .7,   arcs: 1, dim: .3,  focus: 0 },
    about:   { x: -.6,  y: -1.7,  s: .9,   arcs: 1, dim: .35, focus: 0 },
    legal:   { x: .6,   y: 1.6,   s: .7,   arcs: 1, dim: .35, focus: 0 },
    enroll:  { x: 0,    y: -2.3,  s: 1.2,  arcs: 1, dim: .35, focus: 0 },
    closing: { x: 0,    y: .2,    s: .55,  arcs: 1, dim: .25, focus: 0 },
  },
};

function glowTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d'), grd = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grd.addColorStop(0, 'rgba(243,229,171,0.55)');
  grd.addColorStop(.35, 'rgba(212,175,55,0.22)');
  grd.addColorStop(1, 'rgba(212,175,55,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

const pointsVert = /* glsl */`
  uniform float uTime; uniform float uPixel; uniform float uSize;
  attribute float aRand;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelViewMatrix) * position);
    float facing = n.z;
    float tw = .62 + .38 * sin(uTime * 1.4 + aRand * 6.2831);
    vAlpha = smoothstep(-.45, .55, facing) * tw * .95 + .04;
    gl_PointSize = uSize * uPixel * (.55 + .45 * smoothstep(-.3, .8, facing)) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const pointsFrag = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - .5);
    float a = smoothstep(.5, .05, d);
    gl_FragColor = vec4(uColor, a * vAlpha * uOpacity);
  }`;
const arcVert = /* glsl */`
  attribute float aT; varying float vT;
  void main() { vT = aT; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const arcFrag = /* glsl */`
  uniform float uTime; uniform float uDraw; uniform float uOffset; uniform float uOpacity; uniform vec3 uColor;
  varying float vT;
  void main() {
    if (vT > uDraw) discard;
    float head = fract(uTime * .2 + uOffset);
    float pulse = exp(-pow((vT - head) * 13.0, 2.0));
    float a = .18 + pulse * .95;
    gl_FragColor = vec4(mix(uColor, vec3(1.0, .96, .84), pulse * .7), a * uOpacity);
  }`;
const dustVert = /* glsl */`
  uniform float uTime; uniform float uPixel;
  attribute float aRand; attribute float aSpeed;
  varying float vAlpha;
  void main() {
    vec3 p = position;
    p.y = mod(p.y + uTime * aSpeed + 7.0, 14.0) - 7.0;
    p.x += sin(uTime * .3 + aRand * 12.0) * .15;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vAlpha = (.35 + .65 * (.5 + .5 * sin(uTime * 2.0 + aRand * 40.0))) * smoothstep(14.0, 4.0, -mv.z);
    gl_PointSize = (6.0 + aRand * 10.0) * uPixel / -mv.z;
    gl_Position = projectionMatrix * mv;
  }`;
const dustFrag = /* glsl */`
  uniform vec3 uColor; uniform float uOpacity; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - .5);
    gl_FragColor = vec4(uColor, smoothstep(.5, 0.0, d) * vAlpha * uOpacity);
  }`;

export function createScene(canvas, { reduced = false } = {}) {
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false, powerPreference: 'high-performance' });
  } catch (err) {
    return null;
  }
  const narrow = () => innerWidth < 768;
  const mobile = narrow() || matchMedia('(pointer: coarse)').matches;
  const DPR = Math.min(window.devicePixelRatio || 1, mobile ? 1.5 : 1.75);
  renderer.setPixelRatio(DPR);
  renderer.setClearColor(0x0A0A0A, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, .1, 60);
  camera.position.set(0, 0, 6);

  const world = new THREE.Group();
  const tilt = new THREE.Group();
  const globe = new THREE.Group();
  tilt.rotation.set(.32, 0, -.18);
  scene.add(world); world.add(tilt); tilt.add(globe);
  const blend = { transparent: true, depthWrite: false, blending: THREE.AdditiveBlending };

  // dotted sphere (fibonacci lattice)
  const N = mobile ? 2600 : 5200;
  const pos = new Float32Array(N * 3), rnd = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2, r = Math.sqrt(1 - y * y), th = i * 2.399963229728653;
    pos.set([Math.cos(th) * r, y, Math.sin(th) * r], i * 3);
    rnd[i] = Math.random();
  }
  const dotsGeo = new THREE.BufferGeometry();
  dotsGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  dotsGeo.setAttribute('aRand', new THREE.BufferAttribute(rnd, 1));
  const dotsMat = new THREE.ShaderMaterial({
    vertexShader: pointsVert, fragmentShader: pointsFrag, ...blend,
    uniforms: { uTime: { value: 0 }, uPixel: { value: DPR }, uSize: { value: 14 }, uColor: { value: GOLD.clone() }, uOpacity: { value: 0 } },
  });
  globe.add(new THREE.Points(dotsGeo, dotsMat));

  // graticule
  const lines = [];
  for (let lat = -60; lat <= 60; lat += 30) for (let lon = 0; lon < 360; lon += 4) lines.push(latLon(lat, lon, 1.002), latLon(lat, lon + 4, 1.002));
  for (let lon = 0; lon < 180; lon += 30) for (let lat = -90; lat < 90; lat += 4) {
    lines.push(latLon(lat, lon, 1.002), latLon(lat + 4, lon, 1.002));
    lines.push(latLon(lat, lon + 180, 1.002), latLon(lat + 4, lon + 180, 1.002));
  }
  const gratMat = new THREE.LineBasicMaterial({ color: GOLD, opacity: 0, ...blend });
  globe.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(lines), gratMat));

  // halo
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: 0xffffff, opacity: 0, ...blend }));
  halo.scale.setScalar(3.6);
  world.add(halo);

  // orbit ring with a travelling light
  const ringPts = [];
  for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; ringPts.push(new THREE.Vector3(Math.cos(a) * 1.48, 0, Math.sin(a) * 1.48)); }
  const ringMat = new THREE.LineBasicMaterial({ color: GOLD, opacity: 0, ...blend });
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), ringMat);
  const ringGroup = new THREE.Group();
  ringGroup.rotation.set(1.2, .2, .35);
  ringGroup.add(ring);
  const sat = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo.material.map, color: PALE, opacity: 0, ...blend }));
  sat.scale.setScalar(.22);
  ringGroup.add(sat);
  world.add(ringGroup);

  // routes from Bali
  const origin = latLon(ORIGIN.lat, ORIGIN.lon, 1.0);
  const arcMats = [];
  const endPos = [];
  CITIES.forEach(([lat, lon], i) => {
    const b = latLon(lat, lon, 1.0);
    const mid = origin.clone().add(b).multiplyScalar(.5);
    mid.normalize().multiplyScalar(1 + origin.distanceTo(b) * .42);
    const pts = new THREE.QuadraticBezierCurve3(origin, mid, b).getPoints(90);
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    geo.setAttribute('aT', new THREE.BufferAttribute(Float32Array.from(pts, (_, k) => k / (pts.length - 1)), 1));
    const mat = new THREE.ShaderMaterial({
      vertexShader: arcVert, fragmentShader: arcFrag, ...blend,
      uniforms: { uTime: { value: 0 }, uDraw: { value: 0 }, uOffset: { value: i / CITIES.length }, uOpacity: { value: 0 }, uColor: { value: GOLD.clone() } },
    });
    arcMats.push(mat);
    globe.add(new THREE.Line(geo, mat));
    endPos.push(b.x * 1.004, b.y * 1.004, b.z * 1.004);
  });
  const endGeo = new THREE.BufferGeometry();
  endGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(endPos), 3));
  endGeo.setAttribute('aRand', new THREE.BufferAttribute(new Float32Array(CITIES.length).map(() => Math.random()), 1));
  const endMat = new THREE.ShaderMaterial({
    vertexShader: pointsVert, fragmentShader: pointsFrag, ...blend,
    uniforms: { uTime: { value: 0 }, uPixel: { value: DPR }, uSize: { value: 34 }, uColor: { value: PALE.clone() }, uOpacity: { value: 0 } },
  });
  globe.add(new THREE.Points(endGeo, endMat));

  // Bali marker: bright core and a pulsing ring
  const marker = new THREE.Group();
  marker.position.copy(origin.clone().multiplyScalar(1.01));
  marker.lookAt(origin.clone().multiplyScalar(2));
  const core = new THREE.Sprite(new THREE.SpriteMaterial({ map: halo.material.map, color: PALE, opacity: 0, ...blend }));
  core.scale.setScalar(.2);
  const pulseMat = new THREE.MeshBasicMaterial({ color: GOLD, opacity: 0, side: THREE.DoubleSide, ...blend });
  const pulse = new THREE.Mesh(new THREE.RingGeometry(.05, .06, 48), pulseMat);
  marker.add(core, pulse);
  globe.add(marker);

  // dust
  const M = mobile ? 380 : 900;
  const dPos = new Float32Array(M * 3), dRnd = new Float32Array(M), dSpd = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    dPos.set([(Math.random() - .5) * 18, (Math.random() - .5) * 14, -7 + Math.random() * 10], i * 3);
    dRnd[i] = Math.random(); dSpd[i] = .04 + Math.random() * .12;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dustGeo.setAttribute('aRand', new THREE.BufferAttribute(dRnd, 1));
  dustGeo.setAttribute('aSpeed', new THREE.BufferAttribute(dSpd, 1));
  const dustMat = new THREE.ShaderMaterial({
    vertexShader: dustVert, fragmentShader: dustFrag, ...blend,
    uniforms: { uTime: { value: 0 }, uPixel: { value: DPR }, uColor: { value: PALE.clone() }, uOpacity: { value: 0 } },
  });
  scene.add(new THREE.Points(dustGeo, dustMat));

  // ---------- state ----------
  let current = 'gate';
  const state = { ...POSES[narrow() ? 'narrow' : 'wide'].gate, fade: 0 };
  const gsap = window.gsap;
  if (gsap) gsap.to(state, { fade: 1, duration: 2.4, ease: 'power2.out' }); else state.fade = 1;

  function setSection(name) {
    const pose = POSES[narrow() ? 'narrow' : 'wide'][name];
    if (!pose) return;
    current = name;
    if (gsap && !reduced) gsap.to(state, { ...pose, duration: 1.9, ease: 'power3.inOut', overwrite: 'auto' });
    else Object.assign(state, pose);
  }

  // Bali facing the viewer: angle of the marker around the globe's own y axis
  const baliYaw = -Math.atan2(origin.x, origin.z) + .5;
  let yaw = baliYaw - 1.2;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  if (!mobile) addEventListener('pointermove', e => { pointer.tx = e.clientX / innerWidth - .5; pointer.ty = e.clientY / innerHeight - .5; }, { passive: true });

  let pinCb = null;
  const tmp = new THREE.Vector3(), center = new THREE.Vector3(), toCam = new THREE.Vector3();

  function resize() {
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    setSection(current);
  }
  addEventListener('resize', resize);
  resize();

  let t = 0, last = performance.now(), running = true, held = false;
  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    if (document.hidden || held) { last = now; return; }
    const dt = Math.min(.05, (now - last) / 1000); last = now;
    if (!reduced) t += dt;

    // spin freely, or ease Bali toward the viewer
    if (state.focus > .5) {
      let d = baliYaw - yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 1.6);
    } else if (!reduced) yaw += dt * .07;
    globe.rotation.y = yaw;
    ringGroup.rotation.y += reduced ? 0 : dt * .05;
    sat.position.set(Math.cos(t * .5) * 1.48, 0, Math.sin(t * .5) * 1.48);

    pointer.x += (pointer.tx - pointer.x) * .05; pointer.y += (pointer.ty - pointer.y) * .05;
    camera.position.x = pointer.x * .5; camera.position.y = -pointer.y * .35;
    camera.lookAt(0, 0, 0);

    world.position.set(state.x, state.y, 0);
    world.scale.setScalar(state.s);

    const o = state.dim * state.fade;
    dotsMat.uniforms.uTime.value = t; dotsMat.uniforms.uOpacity.value = o;
    endMat.uniforms.uTime.value = t; endMat.uniforms.uOpacity.value = o * state.arcs;
    gratMat.opacity = .09 * o;
    ringMat.opacity = .22 * o;
    sat.material.opacity = .9 * o;
    halo.material.opacity = .55 * o;
    core.material.opacity = o;
    const p = (t * .6) % 1;
    pulse.scale.setScalar(1 + p * 2.4); pulseMat.opacity = (1 - p) * .8 * o;
    for (const m of arcMats) { m.uniforms.uTime.value = t; m.uniforms.uDraw.value = state.arcs; m.uniforms.uOpacity.value = o; }
    dustMat.uniforms.uTime.value = t; dustMat.uniforms.uOpacity.value = .7 * state.fade;

    renderer.render(scene, camera);

    if (pinCb) {
      marker.getWorldPosition(tmp);
      world.getWorldPosition(center);
      toCam.copy(camera.position).sub(tmp);
      const front = tmp.clone().sub(center).dot(toCam) > 0;
      tmp.project(camera);
      pinCb((tmp.x * .5 + .5) * innerWidth, (-tmp.y * .5 + .5) * innerHeight, front && state.focus > .5 && state.arcs > .9);
    }
  }
  requestAnimationFrame(frame);

  return {
    setSection,
    onPin(cb) { pinCb = cb; },
    /** Pause drawing while something opaque covers the whole screen (the intro). */
    hold(on) { held = !!on; },
    stop() { running = false; },
  };
}
