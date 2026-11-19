// Loading screen of InnerMap Earth: deep space with the Milky Way, Earth's glowing horizon in
// the lower right, the name in the centre and a spinner. Everything is drawn on a canvas at
// run time (no photos, works offline). Shown while the 3D code and first imagery load.
import { useEffect, useRef } from 'react';

/** Small deterministic random generator, so the sky looks the same on every visit. */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gauss(rand) {
  // Box-Muller
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function drawSky(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const rand = seeded(20251119);
  const big = Math.max(w, h);

  // Space: near-black with a faint vignette.
  const bg = ctx.createRadialGradient(w * 0.45, h * 0.4, 0, w * 0.45, h * 0.4, big * 0.9);
  bg.addColorStop(0, '#0d1117');
  bg.addColorStop(1, '#020304');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  // Milky Way: a diagonal band of glow, dust and dense small stars.
  const ax = w * 0.08;
  const ay = h * 0.12;
  const bx = w * 0.98;
  const by = h * 0.78;
  const len = Math.hypot(bx - ax, by - ay);
  const nx = -(by - ay) / len;
  const ny = (bx - ax) / len;
  const spread = big * 0.085;
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 90; i += 1) {
    const t = rand();
    const off = gauss(rand) * spread * 0.9;
    const x = ax + (bx - ax) * t + nx * off;
    const y = ay + (by - ay) * t + ny * off;
    const r = big * (0.04 + rand() * 0.09);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const a = 0.025 + rand() * 0.03;
    g.addColorStop(0, `rgba(196, 204, 222, ${a})`);
    g.addColorStop(1, 'rgba(196, 204, 222, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // dark dust lanes along the band
  ctx.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40; i += 1) {
    const t = rand();
    const off = gauss(rand) * spread * 0.35;
    const x = ax + (bx - ax) * t + nx * off;
    const y = ay + (by - ay) * t + ny * off;
    const r = big * (0.015 + rand() * 0.035);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(4, 5, 8, 0.35)');
    g.addColorStop(1, 'rgba(4, 5, 8, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // stars: dense in the band, sparse elsewhere
  const star = (x, y, size, alpha) => {
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, Math.PI * 2);
    ctx.fill();
  };
  const bandStars = Math.round((w * h) / 260);
  for (let i = 0; i < bandStars; i += 1) {
    const t = rand();
    const off = gauss(rand) * spread * 0.75;
    star(ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off, rand() < 0.97 ? 0.45 : 0.9, 0.25 + rand() * 0.6);
  }
  const fieldStars = Math.round((w * h) / 900);
  for (let i = 0; i < fieldStars; i += 1) {
    const bright = rand() < 0.03;
    star(rand() * w, rand() * h, bright ? 1.1 : 0.55, bright ? 0.9 : 0.25 + rand() * 0.5);
  }
  // a few brighter stars with a soft halo
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 14; i += 1) {
    const x = rand() * w;
    const y = rand() * h * 0.8;
    const r = 3 + rand() * 4;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(220, 232, 255, 0.85)');
    g.addColorStop(1, 'rgba(220, 232, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  // Earth: a huge sphere whose horizon rises from the bottom (about a third across) to the
  // right edge (a little below the middle), lit along its edge.
  const cx = w * 0.97;
  const cy = h + big * 0.6;
  const R = big * 0.9;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();
  // surface: lighter near the lit edge, dark towards the night side
  const surface = ctx.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
  surface.addColorStop(0, '#05080c');
  surface.addColorStop(0.7, '#141d24');
  surface.addColorStop(0.93, '#2c3a40');
  surface.addColorStop(1, '#4a5a60');
  ctx.fillStyle = surface;
  ctx.fillRect(0, 0, w, h);
  // land (brown) and cloud (white) texture in the lit band
  // (large, soft, overlapping patches read as continents and haze, not as dots)
  for (let i = 0; i < 120; i += 1) {
    const ang = -Math.PI / 2 - 0.05 - rand() * 1.05;
    const d = R - Math.abs(gauss(rand)) * big * 0.1;
    const x = cx + Math.cos(ang) * d;
    const y = cy + Math.sin(ang) * d;
    const r = big * (0.035 + rand() * 0.09);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    const kind = rand();
    g.addColorStop(0, kind < 0.6 ? 'rgba(150, 118, 86, 0.13)' : kind < 0.85 ? 'rgba(90, 110, 90, 0.1)' : 'rgba(225, 232, 240, 0.09)');
    g.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // blue haze over the land near the horizon
  const inner = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R);
  inner.addColorStop(0, 'rgba(30, 110, 200, 0)');
  inner.addColorStop(0.7, 'rgba(50, 140, 230, 0.22)');
  inner.addColorStop(0.95, 'rgba(110, 200, 255, 0.55)');
  inner.addColorStop(1, 'rgba(190, 235, 255, 0.85)');
  ctx.fillStyle = inner;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();

  // atmosphere: a soft blue glow above the horizon
  ctx.globalCompositeOperation = 'lighter';
  const glow = ctx.createRadialGradient(cx, cy, R, cx, cy, R * 1.05);
  glow.addColorStop(0, 'rgba(140, 215, 255, 0.75)');
  glow.addColorStop(0.12, 'rgba(60, 160, 245, 0.5)');
  glow.addColorStop(0.4, 'rgba(25, 95, 210, 0.2)');
  glow.addColorStop(1, 'rgba(10, 40, 120, 0)');
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
  ctx.arc(cx, cy, R, 0, Math.PI * 2, true);
  ctx.fill('evenodd');
  ctx.globalCompositeOperation = 'source-over';
}

export default function EarthSplash({ leaving = false }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    drawSky(canvas);
    let t;
    const onResize = () => {
      clearTimeout(t);
      t = setTimeout(() => drawSky(canvas), 120);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div className={`earth-splash ${leaving ? 'leaving' : ''}`} role="status" aria-live="polite" aria-label="Loading InnerMap Earth">
      <canvas ref={canvasRef} className="earth-splash-sky" aria-hidden="true" />
      <div className="earth-splash-center">
        <div className="earth-splash-title">
          <img src="/icons/icon.svg" alt="" width="40" height="40" />
          <span>
            InnerMap <span className="earth-splash-light">Earth</span>
          </span>
        </div>
        <span className="earth-splash-spinner" aria-hidden="true" />
      </div>
    </div>
  );
}
