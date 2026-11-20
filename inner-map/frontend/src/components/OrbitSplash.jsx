// "Orbit" loading screen of InnerMap Earth (3D): a sunlit, slowly turning Earth with city lights
// on the night side and a blue atmosphere rim, a satellite circling on a tilted orbit with a
// fading trail, the name, and a progress bar driven by the real loading steps. When the globe is
// ready the camera moves until this Earth matches the real globe's view and the loading screen
// fades away over it. Earth images: NASA Blue Marble / Black Marble (public domain), in /textures.
//
// Smoothness: the 3D scene (orbitScene.js) runs in a Web Worker on an OffscreenCanvas, so the
// globe's heavy start-up on the main thread cannot make it stutter. Browsers without
// OffscreenCanvas run the same scene on the main thread. The text and bar animate on the
// browser's compositor (transform / opacity), also independent of the main thread.
import { useEffect, useRef, useState } from 'react';
import { useSplashState } from './splashState';
import { OrbitLiteScene } from './OrbitSplashLite';

const FADE_MS = 700;

function pixelRatio() {
  // sharp but not more: at most 1.5x the CSS pixels (1x on small-memory / few-core devices)
  const modest = (navigator.deviceMemory && navigator.deviceMemory <= 4) || (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
  return { dpr: Math.min(window.devicePixelRatio || 1, modest ? 1 : 1.5), modest: Boolean(modest) };
}

const sceneState = (s) => ({ phase: s.phase, progress: s.progress, handover: s.handover, startedAgo: performance.now() - s.startedAt });

export default function OrbitSplash({ onDone, onFail }) {
  const state = useSplashState();
  const rootRef = useRef(null);
  const holderRef = useRef(null);
  const barRef = useRef(null);
  const pctRef = useRef(null);
  const statusRef = useRef(null);
  const overlayRef = useRef(null);
  const sendRef = useRef(null); // sends the page's loading state to the scene
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const failRef = useRef(onFail);
  failRef.current = onFail;
  const latestRef = useRef(state);
  latestRef.current = state;
  // the light scene shows underneath until the 3D Earth has faded in
  const [liteHidden, setLiteHidden] = useState(false);

  useEffect(() => {
    // the canvas is made here (not by React): an OffscreenCanvas can be handed over only once,
    // and React's development StrictMode runs this effect twice
    const canvas = document.createElement('canvas');
    canvas.className = 'orbit-splash-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    holderRef.current.appendChild(canvas);
    const reduceMotion = Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    const { dpr, modest } = pixelRatio();
    let finished = false;
    let fadeTimer = 0;

    const onEvent = (ev) => {
      if (ev.type === 'progress') {
        if (barRef.current) barRef.current.style.transform = `scaleX(${ev.pct / 100})`;
        if (pctRef.current) pctRef.current.textContent = `${ev.pct}%`;
        if (statusRef.current) statusRef.current.textContent = ev.step;
      } else if (ev.type === 'revealed') {
        setLiteHidden(true);
      } else if (ev.type === 'handoverStart') {
        overlayRef.current?.classList.add('out');
      } else if (ev.type === 'handoverEnd') {
        rootRef.current?.classList.add('fading');
        fadeTimer = setTimeout(() => {
          if (!finished) {
            finished = true;
            doneRef.current?.();
          }
        }, FADE_MS);
      } else if (ev.type === 'stats') {
        (window.__innerMapSplashStats ||= []).push(ev); // diagnostics
      } else if (ev.type === 'slow' || ev.type === 'fail') {
        failRef.current?.(); // too heavy / not possible here: the light version takes over
      }
    };

    let cleanup;
    if (typeof Worker !== 'undefined' && typeof canvas.transferControlToOffscreen === 'function') {
      // ---- preferred: the scene runs in a background worker
      const worker = new Worker(new URL('./orbit.worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = (e) => onEvent(e.data);
      worker.onerror = () => onEvent({ type: 'fail' });
      const offscreen = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: offscreen, width: window.innerWidth, height: window.innerHeight, dpr, modest, reduceMotion }, [offscreen]);
      sendRef.current = (s) => worker.postMessage({ type: 'state', s: sceneState(s) });
      const onResize = () => worker.postMessage({ type: 'resize', width: window.innerWidth, height: window.innerHeight, dpr: pixelRatio().dpr });
      window.addEventListener('resize', onResize);
      cleanup = () => {
        window.removeEventListener('resize', onResize);
        worker.postMessage({ type: 'dispose' });
        setTimeout(() => worker.terminate(), 500);
      };
    } else {
      // ---- fallback: the same scene on the main thread (three.js loaded only in this case)
      let raf = 0;
      let scene = null;
      let stopped = false;
      const onResize = () => scene?.resize(window.innerWidth, window.innerHeight, pixelRatio().dpr);
      Promise.all([import('three'), import('./orbitScene')])
        .then(([{ SRGBColorSpace, TextureLoader }, { createOrbitScene }]) => {
          if (stopped) return;
          const loader = new TextureLoader();
          const loadTexture = (url, srgb) =>
            new Promise((resolve, reject) =>
              loader.load(
                url,
                (t) => {
                  if (srgb) t.colorSpace = SRGBColorSpace;
                  resolve(t);
                },
                undefined,
                reject
              )
            );
          scene = createOrbitScene({ canvas, width: window.innerWidth, height: window.innerHeight, dpr, modest, reduceMotion, loadTexture, emit: onEvent });
          const loop = (now) => {
            scene.frame(now);
            raf = requestAnimationFrame(loop);
          };
          raf = requestAnimationFrame(loop);
          sendRef.current = (s) => scene.setState(sceneState(s), performance.now());
          sendRef.current(latestRef.current);
          window.addEventListener('resize', onResize);
        })
        .catch(() => onEvent({ type: 'fail' }));
      cleanup = () => {
        stopped = true;
        cancelAnimationFrame(raf);
        window.removeEventListener('resize', onResize);
        scene?.dispose();
      };
    }
    sendRef.current?.(state);
    return () => {
      clearTimeout(fadeTimer);
      sendRef.current = null;
      cleanup?.();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the page's loading progress -> the scene
  useEffect(() => {
    sendRef.current?.(state);
    // the globe gave up (error): just go away
    if (state.phase === 'gone') doneRef.current?.();
  }, [state]);

  return (
    <div className="orbit-splash" ref={rootRef} role="status" aria-live="polite" aria-label="Loading InnerMap Earth">
      <OrbitLiteScene hidden={liteHidden} />
      <div className="orbit-splash-holder" ref={holderRef} />
      <div className="orbit-splash-overlay" ref={overlayRef}>
        <div className="orbit-splash-brand">
          <img src="/icons/icon.svg" alt="" width="40" height="40" />
          <h1>InnerMap Earth</h1>
        </div>
        <div className="orbit-splash-bar">
          <span ref={barRef} />
        </div>
        <div className="orbit-splash-status">
          <span ref={statusRef}>Starting the 3D engine</span>
          <span className="orbit-splash-pct" ref={pctRef}>
            0%
          </span>
        </div>
      </div>
    </div>
  );
}
