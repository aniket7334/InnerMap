// Light version of the "Orbit" loading screen - same look, no 3D graphics needed: a turning
// Earth (CSS, the bundled NASA image), atmosphere glow, a satellite on a tilted orbit, the name
// and the real progress. Used on devices without 3D / with little memory / "reduce motion", and as
// the first frame while the 3D version downloads (that one then fades in over this scene).
import { useEffect, useRef, useState } from 'react';
import { useSplashState, MIN_SHOW_MS, stepFor } from './splashState';

function useGlobeSize() {
  const get = () => Math.round(Math.min(window.innerHeight * 0.5, window.innerWidth * 0.56));
  const [d, setD] = useState(get);
  useEffect(() => {
    const onResize = () => setD(get());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return d;
}

/** Stars, the turning Earth and the orbit - the background of both loading screens. */
export function OrbitLiteScene({ hidden = false }) {
  const d = useGlobeSize();
  const rx = d * 0.8;
  const ry = d * 0.25;
  const tilt = -16; // degrees
  const t = (tilt * Math.PI) / 180;
  const x0 = (-rx * Math.cos(t)).toFixed(1);
  const y0 = (-rx * Math.sin(t)).toFixed(1);
  const x1 = (rx * Math.cos(t)).toFixed(1);
  const y1 = (rx * Math.sin(t)).toFixed(1);
  // orbit ellipse around the Earth's centre: front half (below) first, then the back half
  const front = `M ${x0},${y0} A ${rx} ${ry} ${tilt} 0 0 ${x1},${y1}`;
  const back = `M ${x1},${y1} A ${rx} ${ry} ${tilt} 0 0 ${x0},${y0}`;
  const box = Math.ceil(rx + 12);
  const svg = (pathD, cls) => (
    <svg className={cls} width={box * 2} height={box * 2} viewBox={`${-box} ${-box} ${box * 2} ${box * 2}`} style={{ left: -box, top: -box }}>
      <path d={pathD} />
    </svg>
  );
  return (
    <div className={`orbit-lite ${hidden ? 'hidden' : ''}`} style={{ '--d': `${d}px` }} aria-hidden="true">
      <div className="orbit-lite-stars" />
      <div className="orbit-lite-system">
        {svg(back, 'orbit-lite-ring back')}
        <div className="orbit-lite-globe" />
        {svg(front, 'orbit-lite-ring front')}
        <span className="orbit-lite-sat" style={{ offsetPath: `path("${front} A ${rx} ${ry} ${tilt} 0 0 ${x0},${y0}")` }} />
      </div>
    </div>
  );
}

export default function OrbitSplashLite() {
  const s = useSplashState();
  const [shown, setShown] = useState(0);
  const start = useRef(performance.now());
  // the real progress, with a gentle creep while the 3D code downloads
  useEffect(() => {
    if (s.phase !== 'loading') {
      setShown(1);
      return undefined;
    }
    const id = setInterval(() => {
      const now = performance.now();
      const creep = Math.min((now - start.current) / 14000, 0.3);
      const paced = Math.min(1, (now - s.startedAt) / MIN_SHOW_MS['2d']);
      setShown((v) => Math.max(v, Math.min(paced, Math.max(s.progress, creep) + 0.25, 0.97)));
    }, 200);
    return () => clearInterval(id);
  }, [s.phase, s.progress]);
  const pct = Math.round(shown * 100);
  return (
    <div className={`orbit-splash lite ${s.phase !== 'loading' ? 'leaving' : ''}`} role="status" aria-live="polite" aria-label="Loading InnerMap Earth">
      <OrbitLiteScene />
      <div className="orbit-splash-overlay">
        <div className="orbit-splash-brand">
          <img src="/icons/icon.svg" alt="" width="40" height="40" />
          <h1>InnerMap Earth</h1>
        </div>
        <div className="orbit-splash-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
        <div className="orbit-splash-status">
          <span>{s.phase === 'loading' ? stepFor(Math.min(shown, 0.99)) : 'Ready'}</span>
          <span className="orbit-splash-pct">{pct}%</span>
        </div>
      </div>
    </div>
  );
}
