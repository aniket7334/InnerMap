// The 3D scene of the "Orbit" loading screen (three.js), written so it can run either in a Web
// Worker on an OffscreenCanvas (preferred: the animation then stays smooth while the globe's own
// start-up keeps the page's main thread busy) or on the main thread.
//
//   const scene = createOrbitScene({ canvas, width, height, dpr, reduceMotion, loadTexture, emit });
//   scene.setState({ phase, progress, startedAgo, handover });  scene.resize(w, h, dpr);
//   scene.frame(now) - once per animation frame;  scene.dispose()
// emit(event): { type: 'progress', pct, step } | { type: 'revealed' } | { type: 'handoverStart' }
//              | { type: 'handoverEnd' } | { type: 'slow' }
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';

export const TEXTURES = { day: '/textures/earth-day.v1.jpg', night: '/textures/earth-night.v1.jpg', water: '/textures/earth-water.v1.png' };
export const MIN_SHOW_3D = 5200; // keep equal to MIN_SHOW_MS['3d'] in splashState.js
const R_EARTH = 6371000;
const ORBIT_R = 1.55;
const TRAIL = 90;
const START_LON = 78.9; // the app opens over South Asia
const HANDOVER_MS = 2800;

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

function stepFor(p) {
  if (p < 0.35) return 'Starting the 3D engine';
  if (p < 0.8) return 'Loading satellite imagery';
  if (p < 0.995) return 'Placing country and city names';
  return 'Ready';
}

function starLayer(count, size, opacity) {
  const pos = [];
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const s = Math.sqrt(1 - u * u);
    const r = 400 + Math.random() * 300;
    pos.push(s * Math.cos(a) * r, u * r, s * Math.sin(a) * r);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  return new Points(g, new PointsMaterial({ color: 0xffffff, size, sizeAttenuation: false, transparent: true, opacity }));
}

export function createOrbitScene({ canvas, width, height, dpr, modest, reduceMotion, loadTexture, emit }) {
  const renderer = new WebGLRenderer({ canvas, antialias: !modest, alpha: true, powerPreference: 'low-power' });
  renderer.setClearColor(0x000000, 0);
  const scene = new Scene();
  const camera = new PerspectiveCamera(38, 1, 0.01, 2000);
  scene.add(starLayer(1400, 1.2, 0.75));
  scene.add(starLayer(250, 2, 0.9));

  // ---- Earth: day imagery lit by the sun, city lights on the night side, sun glint on the sea
  const sun = new Vector3(-0.5, 0.35, 0.8).normalize();
  const earthMat = new ShaderMaterial({
    transparent: true,
    uniforms: { dayMap: { value: null }, nightMap: { value: null }, waterMap: { value: null }, sun: { value: sun }, fullDay: { value: 0 }, reveal: { value: 0 } },
    vertexShader: `
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vUv = uv;
        vN = normalize(mat3(modelMatrix) * normal);
        vec4 w = modelMatrix * vec4(position, 1.0);
        vP = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: `
      uniform sampler2D dayMap; uniform sampler2D nightMap; uniform sampler2D waterMap; uniform vec3 sun; uniform float fullDay; uniform float reveal;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main() {
        vec3 n = normalize(vN);
        float d = dot(n, sun);
        vec3 day = texture2D(dayMap, vUv).rgb;
        vec3 lit = day * (0.10 + 1.15 * max(d, 0.0));
        vec3 night = texture2D(nightMap, vUv).rgb * vec3(1.0, 0.85, 0.6) * 1.5;
        float dayAmount = smoothstep(-0.10, 0.22, d);
        vec3 col = mix(night + day * 0.035, lit, dayAmount);
        vec3 viewDir = normalize(cameraPosition - vP);
        vec3 h = normalize(sun + viewDir);
        float water = texture2D(waterMap, vUv).r;
        col += vec3(1.0, 0.95, 0.85) * pow(max(dot(n, h), 0.0), 120.0) * water * 0.14 * dayAmount * (1.0 - fullDay);
        float rim = pow(1.0 - max(dot(n, viewDir), 0.0), 3.0);
        col += vec3(0.25, 0.5, 1.0) * rim * 0.4 * smoothstep(-0.2, 0.4, d);
        // at the hand-over: evenly lit, like the real globe
        col = mix(col, day * 1.02 + vec3(0.25, 0.5, 1.0) * rim * 0.25, fullDay);
        // fades in once the Earth images have arrived (no blank ball first)
        gl_FragColor = vec4(col, reveal);
        #include <colorspace_fragment>
      }`,
  });
  let imagesReady = false;
  const textures = [];
  Promise.all([loadTexture(TEXTURES.day, true), loadTexture(TEXTURES.night, true), loadTexture(TEXTURES.water, false)])
    .then(([day, night, water]) => {
      day.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      earthMat.uniforms.dayMap.value = day;
      earthMat.uniforms.nightMap.value = night;
      earthMat.uniforms.waterMap.value = water;
      textures.push(day, night, water);
      imagesReady = true;
    })
    .catch(() => {
      imagesReady = true; // keep going without images (the light scene underneath stays)
    });

  const earthGroup = new Group();
  earthGroup.rotation.z = MathUtils.degToRad(23.4);
  scene.add(earthGroup);
  const earth = new Mesh(new SphereGeometry(1, 96, 64), earthMat);
  earth.renderOrder = -1; // drawn first, so the orbit lines never punch holes in it
  earth.rotation.y = MathUtils.degToRad(-90 - START_LON - 70);
  earthGroup.add(earth);
  const atmoMat = new ShaderMaterial({
    side: BackSide,
    blending: AdditiveBlending,
    transparent: true,
    depthWrite: false,
    uniforms: { sun: { value: sun }, fullDay: { value: 0 }, reveal: { value: 0 } },
    vertexShader: `varying vec3 vN; varying vec3 vNW;
      void main(){ vN = normalize(normalMatrix * normal); vNW = normalize(mat3(modelMatrix) * normal);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 sun; uniform float fullDay; uniform float reveal; varying vec3 vN; varying vec3 vNW;
      void main(){ float i = pow(0.70 - dot(vN, vec3(0.0,0.0,1.0)), 3.2);
      float litSide = mix(0.35 + 0.65 * smoothstep(-0.4, 0.5, dot(normalize(vNW), sun)), 1.0, fullDay);
      gl_FragColor = vec4(0.30, 0.60, 1.0, 1.0) * i * 1.05 * litSide * reveal; }`,
  });
  scene.add(new Mesh(new SphereGeometry(1.1, 64, 48), atmoMat));

  // ---- satellite on a tilted orbit, with a fading golden trail
  const orbit = new Group();
  orbit.rotation.set(MathUtils.degToRad(68), MathUtils.degToRad(-18), MathUtils.degToRad(12));
  scene.add(orbit);
  const ringMat = new MeshBasicMaterial({ color: 0x7fb4ff, transparent: true, opacity: 0.28, depthWrite: false });
  orbit.add(new Mesh(new TorusGeometry(ORBIT_R, 0.0035, 8, 256), ringMat));
  const sat = new Group();
  sat.add(new Mesh(new BoxGeometry(0.05, 0.05, 0.07), new MeshBasicMaterial({ color: 0xe5e7eb })));
  const panelMat = new MeshBasicMaterial({ color: 0x2563eb, side: DoubleSide });
  const panelL = new Mesh(new PlaneGeometry(0.11, 0.04), panelMat);
  panelL.position.x = -0.085;
  const panelR = panelL.clone();
  panelR.position.x = 0.085;
  const beacon = new Mesh(new BoxGeometry(0.02, 0.02, 0.02), new MeshBasicMaterial({ color: 0xfbbc04 }));
  beacon.position.z = 0.045;
  sat.add(panelL, panelR, beacon);
  orbit.add(sat);
  const trailPos = new Float32Array(TRAIL * 3);
  const trailCol = new Float32Array(TRAIL * 3);
  const trailGeo = new BufferGeometry();
  trailGeo.setAttribute('position', new BufferAttribute(trailPos, 3));
  trailGeo.setAttribute('color', new BufferAttribute(trailCol, 3));
  const trailMat = new LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95, blending: AdditiveBlending, depthWrite: false });
  orbit.add(new Line(trailGeo, trailMat));

  // ---- layout
  let W = width;
  let H = height;
  const resize = (w, h, ratio) => {
    W = w;
    H = h;
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  resize(width, height, dpr);
  const fitDistance = () => {
    const v = MathUtils.degToRad(38);
    const hFov = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
    return (ORBIT_R + 0.35) / Math.tan(Math.min(v, hFov) / 2);
  };

  // ---- state from the page
  let st = { phase: 'loading', progress: 0, handover: null };
  let startedAt = null; // in this thread's clock
  const setState = (s, now) => {
    st = { ...st, ...s };
    if (s.startedAgo != null && startedAt == null) startedAt = now - s.startedAgo;
  };

  // ---- animation
  let last = null;
  const t0 = { v: null };
  let shown = 0;
  let satAngle = 0;
  let handStart = null;
  let from = null;
  let revealedSent = false;
  let lastPct = -1;
  let lastStep = '';
  let handoverEnded = false;
  let watchFrames = 0;
  let watchSlow = 0;
  let watchFrom = 0;

  // frames drawn per second (diagnostics: window.__innerMapSplashStats in the page)
  let statFrom = 0;
  let statFrames = 0;
  let statSlow = 0;
  const frame = (now) => {
    if (t0.v == null) t0.v = now;
    if (!statFrom) statFrom = now;
    statFrames += 1;
    if (last != null && now - last > 50) statSlow += 1;
    if (now - statFrom >= 1000) {
      emit({ type: 'stats', fps: Math.round((statFrames * 1000) / (now - statFrom)), slow: statSlow });
      statFrom = now;
      statFrames = 0;
      statSlow = 0;
    }
    if (startedAt == null) startedAt = now;
    const rawDt = last == null ? 0.016 : (now - last) / 1000;
    last = now;
    const dt = Math.min(rawDt, 0.05);
    const speed = reduceMotion ? 0.25 : 1;
    const t = (now - t0.v) / 1000;

    // frame-rate watch on the drawing itself: a device that cannot keep this smooth gets the light version
    if (imagesReady && st.phase === 'loading' && watchFrames < 90) {
      if (!watchFrom) watchFrom = now;
      watchFrames += 1;
      if (rawDt > 0.05) watchSlow += 1;
      if (now - watchFrom > 1500 && watchFrames >= 12 && watchSlow / watchFrames > 0.4) {
        watchFrames = 999;
        emit({ type: 'slow' });
      }
    }

    // progress: the real steps, paced to fill steadily over the minimum show time; may run a little
    // ahead of the real progress (which arrives in bursts), never to 100% before the globe is ready
    const paced = Math.min(1, (now - startedAt) / MIN_SHOW_3D);
    const real = Math.max(st.progress, Math.min(t / 14, 0.3)) * (imagesReady ? 1 : 0.9);
    const target = st.phase === 'loading' ? Math.min(paced, real + 0.25, 0.97) : 1;
    shown += (target - shown) * (1 - Math.exp(-dt * 5));
    const pct = Math.round(shown * 100);
    const step = st.phase === 'loading' ? stepFor(Math.min(shown, 0.99)) : 'Ready';
    if (pct !== lastPct || step !== lastStep) {
      lastPct = pct;
      lastStep = step;
      emit({ type: 'progress', pct, step });
    }

    if (imagesReady && earthMat.uniforms.reveal.value < 1) {
      const r = Math.min(1, earthMat.uniforms.reveal.value + dt / 0.6);
      earthMat.uniforms.reveal.value = r;
      atmoMat.uniforms.reveal.value = r;
      if (r >= 1 && !revealedSent) {
        revealedSent = true;
        emit({ type: 'revealed' });
      }
    }

    const base = fitDistance();
    if (st.phase === 'loading' || !st.handover) {
      earth.rotation.y += dt * 0.06 * speed;
      satAngle += dt * 0.55 * speed;
      const drift = reduceMotion ? 0 : Math.sin(t * 0.15) * 0.12;
      const dist = base * (1.12 - Math.min(t / 6, 1) * 0.12);
      camera.position.set(Math.sin(drift) * dist, 0.054 * dist, Math.cos(drift) * dist);
      camera.lookAt(0, 0, 0);
    } else {
      // ---- hand-over: end on exactly the real globe's view (place, size, position, lighting)
      const ho = st.handover;
      if (handStart == null) {
        handStart = now;
        emit({ type: 'handoverStart' });
        from = {
          dist: camera.position.length(),
          drift: Math.atan2(camera.position.x, camera.position.z),
          y: camera.position.y / Math.max(camera.position.length(), 1e-6),
          rotY: earth.rotation.y,
          tilt: earthGroup.rotation.z,
          fov: camera.fov,
        };
        const to = MathUtils.degToRad(-90 - ho.lng);
        let diff = (to - from.rotY) % (Math.PI * 2);
        if (diff > Math.PI) diff -= Math.PI * 2;
        if (diff < -Math.PI) diff += Math.PI * 2;
        from.rotTo = from.rotY + diff;
      }
      const k = Math.min((now - handStart) / HANDOVER_MS, 1);
      const e = ease(k);
      const ang = Math.asin(R_EARTH / (R_EARTH + ho.height));
      const distEnd = 1 / Math.sin(ang);
      const fovEnd = MathUtils.radToDeg(2 * Math.atan((Math.tan(ho.fovy / 2) * H) / Math.max(ho.rect.height, 1)));
      camera.fov = lerp(from.fov, fovEnd, e);
      const dx = ho.rect.left + ho.rect.width / 2 - W / 2;
      const dy = ho.rect.top + ho.rect.height / 2 - H / 2;
      camera.setViewOffset(W, H, -dx * e, -dy * e, W, H);
      const dist = lerp(from.dist, distEnd, e);
      const drift = lerp(from.drift, 0, e);
      camera.position.set(Math.sin(drift) * dist, lerp(from.y, 0, e) * dist, Math.cos(drift) * dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
      earth.rotation.y = lerp(from.rotY, from.rotTo, e);
      earthGroup.rotation.z = lerp(from.tilt, 0, e);
      earthGroup.rotation.x = lerp(0, MathUtils.degToRad(ho.lat), e);
      earthMat.uniforms.fullDay.value = e;
      atmoMat.uniforms.fullDay.value = e;
      ringMat.opacity = 0.28 * (1 - e);
      trailMat.opacity = 0.95 * (1 - e);
      sat.visible = e < 0.9;
      satAngle += dt * 0.55 * speed * (1 - e);
      if (k >= 1 && !handoverEnded) {
        handoverEnded = true;
        emit({ type: 'handoverEnd' });
      }
    }

    sat.position.set(Math.cos(satAngle) * ORBIT_R, Math.sin(satAngle) * ORBIT_R, 0);
    sat.rotation.z = satAngle + Math.PI / 2;
    for (let i = 0; i < TRAIL; i++) {
      const a = satAngle - i * 0.018;
      trailPos[i * 3] = Math.cos(a) * ORBIT_R;
      trailPos[i * 3 + 1] = Math.sin(a) * ORBIT_R;
      trailPos[i * 3 + 2] = 0;
      const f = Math.pow(1 - i / TRAIL, 1.6);
      trailCol[i * 3] = 0.98 * f;
      trailCol[i * 3 + 1] = 0.74 * f;
      trailCol[i * 3 + 2] = 0.2 * f;
    }
    trailGeo.attributes.position.needsUpdate = true;
    trailGeo.attributes.color.needsUpdate = true;
    renderer.render(scene, camera);
  };

  const dispose = () => {
    scene.traverse((o) => {
      o.geometry?.dispose?.();
      if (o.material) [].concat(o.material).forEach((m) => m.dispose?.());
    });
    textures.forEach((tx) => tx.dispose());
    renderer.dispose();
    renderer.forceContextLoss?.(); // give the graphics memory back to the real globe
  };

  return { setState, resize, frame, dispose };
}
