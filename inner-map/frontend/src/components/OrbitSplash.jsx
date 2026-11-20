// "Orbit" loading screen of InnerMap Earth (3D): a sunlit, slowly turning Earth with city lights
// on the night side and a blue atmosphere rim, a satellite circling on a tilted orbit with a
// fading trail, the name, and a progress bar driven by the real loading steps.
// When the globe is ready the camera moves until this Earth matches the real globe's view (same
// place, size and lighting) and the loading screen fades away over it.
// Earth images: NASA Blue Marble / Black Marble (public domain), bundled in /textures (offline).
import { useEffect, useRef, useState } from 'react';
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  Clock,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LoadingManager,
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
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from 'three';
import { useSplashState } from './splashState';
import { OrbitLiteScene } from './OrbitSplashLite';

const R_EARTH = 6371000;
const ORBIT_R = 1.55;
const TRAIL = 90;
const START_LON = 78.9; // the app opens over South Asia
const HANDOVER_MS = 2200;
const FADE_MS = 550;

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const lerp = (a, b, t) => a + (b - a) * t;

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

export default function OrbitSplash({ onDone, onFail }) {
  const state = useSplashState();
  const stateRef = useRef(state);
  stateRef.current = state;
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const barRef = useRef(null);
  const pctRef = useRef(null);
  const statusRef = useRef(null);
  const overlayRef = useRef(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  // the light scene shows underneath until the 3D Earth has faded in
  const [liteHidden, setLiteHidden] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    let renderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setClearColor(0x000000, 0);
    } catch {
      onFail?.();
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const scene = new Scene();
    const camera = new PerspectiveCamera(38, 1, 0.01, 2000);
    scene.add(starLayer(2200, 1.2, 0.75));
    scene.add(starLayer(350, 2, 0.9));

    // ---- Earth: day imagery lit by the sun, city lights on the night side, sun glint on the sea
    const manager = new LoadingManager();
    let imagesReady = false;
    manager.onLoad = () => (imagesReady = true);
    const loader = new TextureLoader(manager);
    const dayTex = loader.load('/textures/earth-day.v1.jpg');
    const nightTex = loader.load('/textures/earth-night.v1.jpg');
    const waterTex = loader.load('/textures/earth-water.v1.png');
    dayTex.colorSpace = SRGBColorSpace;
    nightTex.colorSpace = SRGBColorSpace;
    dayTex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const sun = new Vector3(-0.5, 0.35, 0.8).normalize();
    const earthMat = new ShaderMaterial({
      transparent: true,
      uniforms: { dayMap: { value: dayTex }, nightMap: { value: nightTex }, waterMap: { value: waterTex }, sun: { value: sun }, fullDay: { value: 0 }, reveal: { value: 0 } },
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
    const earthGroup = new Group();
    earthGroup.rotation.z = MathUtils.degToRad(23.4);
    scene.add(earthGroup);
    const earth = new Mesh(new SphereGeometry(1, 128, 128), earthMat);
    earth.renderOrder = -1; // drawn first, so the orbit lines never punch holes in it
    earth.rotation.y = MathUtils.degToRad(-90 - START_LON - 70);
    earthGroup.add(earth);
    const atmosphere = new Mesh(
      new SphereGeometry(1.1, 96, 96),
      new ShaderMaterial({
        side: BackSide,
        blending: AdditiveBlending,
        transparent: true,
        depthWrite: false,
        uniforms: { sun: { value: sun }, fullDay: { value: 0 } },
        vertexShader: `varying vec3 vN; varying vec3 vNW;
          void main(){ vN = normalize(normalMatrix * normal); vNW = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 sun; uniform float fullDay; varying vec3 vN; varying vec3 vNW;
          void main(){ float i = pow(0.70 - dot(vN, vec3(0.0,0.0,1.0)), 3.2);
          float litSide = mix(0.35 + 0.65 * smoothstep(-0.4, 0.5, dot(normalize(vNW), sun)), 1.0, fullDay);
          gl_FragColor = vec4(0.30, 0.60, 1.0, 1.0) * i * 1.05 * litSide; }`,
      })
    );
    scene.add(atmosphere);

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
    const beacon = new Mesh(new SphereGeometry(0.012, 12, 12), new MeshBasicMaterial({ color: 0xfbbc04 }));
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
    let W = 1;
    let H = 1;
    const resize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      renderer.setSize(W, H, false);
      camera.aspect = W / H;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', resize);
    resize();
    const fitDistance = () => {
      const v = MathUtils.degToRad(38);
      const hFov = 2 * Math.atan(Math.tan(v / 2) * camera.aspect);
      return (ORBIT_R + 0.35) / Math.tan(Math.min(v, hFov) / 2);
    };

    // ---- animation
    const clock = new Clock();
    const t0 = performance.now();
    let shown = 0;
    let satAngle = 0;
    let handStart = null; // when the hand-over began
    let from = null; // camera/earth values at that moment
    let raf = 0;
    let finished = false;

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const dt = Math.min(clock.getDelta(), 0.05);
      const speed = reduceMotion ? 0.25 : 1;
      const s = stateRef.current;
      const t = (now - t0) / 1000;

      // progress: the real steps; a gentle creep while the 3D code itself downloads
      const target = s.phase === 'loading' ? Math.max(s.progress, Math.min(t / 14, 0.3)) * (imagesReady ? 1 : 0.9) : 1;
      shown += (target - shown) * 0.08;
      const pct = Math.round(shown * 100);
      if (barRef.current) barRef.current.style.width = `${pct}%`;
      if (pctRef.current) pctRef.current.textContent = `${pct}%`;
      if (statusRef.current) statusRef.current.textContent = s.phase === 'loading' ? s.step : 'Ready';

      if (imagesReady && earthMat.uniforms.reveal.value < 1) {
        earthMat.uniforms.reveal.value = Math.min(1, earthMat.uniforms.reveal.value + dt / 0.6);
        if (earthMat.uniforms.reveal.value >= 1) setLiteHidden(true);
      }
      const base = fitDistance();
      if (s.phase === 'loading' || !s.handover) {
        earth.rotation.y += dt * 0.06 * speed;
        satAngle += dt * 0.55 * speed;
        const drift = reduceMotion ? 0 : Math.sin(t * 0.15) * 0.12;
        const dist = base * (1.12 - Math.min(t / 6, 1) * 0.12);
        camera.position.set(Math.sin(drift) * dist, 0.054 * dist, Math.cos(drift) * dist);
        camera.lookAt(0, 0, 0);
        if (s.phase === 'gone') {
          // the globe gave up (error): just go away
          if (!finished) {
            finished = true;
            doneRef.current?.();
          }
        }
      } else {
        // ---- hand-over: end on exactly the real globe's view, then fade
        const ho = s.handover;
        if (handStart == null) {
          handStart = now;
          from = {
            dist: camera.position.length(),
            drift: Math.atan2(camera.position.x, camera.position.z),
            y: camera.position.y / Math.max(camera.position.length(), 1e-6),
            rotY: earth.rotation.y,
            tilt: earthGroup.rotation.z,
            fov: camera.fov,
          };
          let to = MathUtils.degToRad(-90 - ho.lng);
          let diff = (to - from.rotY) % (Math.PI * 2);
          if (diff > Math.PI) diff -= Math.PI * 2;
          if (diff < -Math.PI) diff += Math.PI * 2;
          from.rotTo = from.rotY + diff;
        }
        const k = Math.min((now - handStart) / HANDOVER_MS, 1);
        const e = ease(k);
        // same apparent size: angular radius of the Earth seen from the real camera
        const ang = Math.asin(R_EARTH / (R_EARTH + ho.height));
        const distEnd = 1 / Math.sin(ang);
        // same pixel size on this full-screen canvas as on the globe's canvas
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
        atmosphere.material.uniforms.fullDay.value = e;
        ringMat.opacity = 0.28 * (1 - e);
        trailMat.opacity = 0.95 * (1 - e);
        sat.visible = e < 0.9;
        satAngle += dt * 0.55 * speed * (1 - e);
        if (overlayRef.current) overlayRef.current.style.opacity = String(1 - Math.min(k * 2, 1));
        const fade = Math.min(Math.max((now - handStart - HANDOVER_MS) / FADE_MS, 0), 1);
        if (rootRef.current) rootRef.current.style.opacity = String(1 - fade);
        if (fade >= 1 && !finished) {
          finished = true;
          doneRef.current?.();
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
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        if (o.material) [].concat(o.material).forEach((m) => m.dispose?.());
      });
      [dayTex, nightTex, waterTex].forEach((tx) => tx.dispose());
      renderer.dispose();
      renderer.forceContextLoss?.(); // give the graphics memory back to the real globe
    };
  }, [onFail]);

  return (
    <div className="orbit-splash" ref={rootRef} role="status" aria-live="polite" aria-label="Loading InnerMap Earth">
      <OrbitLiteScene hidden={liteHidden} />
      <canvas ref={canvasRef} className="orbit-splash-canvas" aria-hidden="true" />
      <div className="orbit-splash-overlay" ref={overlayRef}>
        <div className="orbit-splash-brand">
          <img src="/icons/icon.svg" alt="" width="40" height="40" />
          <h1>InnerMap Earth</h1>
        </div>
        <div className="orbit-splash-bar">
          <span ref={barRef} />
        </div>
        <div className="orbit-splash-status">
          <span ref={statusRef}>{state.step}</span>
          <span className="orbit-splash-pct" ref={pctRef}>
            0%
          </span>
        </div>
      </div>
    </div>
  );
}
