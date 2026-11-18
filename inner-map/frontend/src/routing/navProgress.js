// Turn-by-turn progress along a calculated route, from real GPS fixes.
//   prepareNav(route)  -> route geometry with cumulative distances + each step's position on it
//   progressAt(nav, p) -> how far along the route you are, how far you are from it (off-route),
//                         remaining distance/time and the next instruction
// Remaining time is the route's own duration scaled to the distance still to go (the same
// estimate the route was calculated with; no live traffic).
import { distanceMeters } from '../maps/geo';

const M_PER_DEG_LAT = 111320;

/** Closest point on segment a-b to p (local metric projection; fine for short segments). */
function project(p, a, b) {
  const kx = Math.cos((p.lat * Math.PI) / 180) * M_PER_DEG_LAT;
  const ax = a[1] * kx;
  const ay = a[0] * M_PER_DEG_LAT;
  const bx = b[1] * kx;
  const by = b[0] * M_PER_DEG_LAT;
  const px = p.lng * kx;
  const py = p.lat * M_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return { t, dist: Math.hypot(px - qx, py - qy) };
}

export function prepareNav(route) {
  const g = route.geometry;
  const cum = [0];
  for (let i = 1; i < g.length; i += 1) cum.push(cum[i - 1] + distanceMeters(g[i - 1][0], g[i - 1][1], g[i][0], g[i][1]));
  const total = cum[cum.length - 1] || 1;
  const along = (pt, fromIndex = 0) => {
    let best = { d: Infinity, s: 0, i: 0 };
    for (let i = Math.max(0, fromIndex); i < g.length - 1; i += 1) {
      const q = project(pt, g[i], g[i + 1]);
      if (q.dist < best.d) best = { d: q.dist, s: cum[i] + q.t * (cum[i + 1] - cum[i]), i };
    }
    return best;
  };
  // Each step's position along the line (steps are in order, so search forward).
  let from = 0;
  const steps = (route.steps || []).map((s) => {
    const a = along({ lat: s.lat, lng: s.lng }, from);
    from = a.i;
    return { ...s, at: a.s };
  });
  return { route, g, cum, total, steps, along };
}

/**
 * @param nav  result of prepareNav
 * @param pos  { lat, lng, accuracy }
 */
export function progressAt(nav, pos) {
  const a = nav.along(pos);
  const done = Math.min(nav.total, a.s);
  const remaining = Math.max(0, nav.total - done);
  const ratio = nav.total ? remaining / nav.total : 0;
  const next = nav.steps.find((s) => s.at > done + 8) || null;
  return {
    offRoute: a.d, // metres between you and the route line
    done,
    remaining,
    remainingTime: (nav.route.duration || 0) * ratio,
    next,
    toNext: next ? Math.max(0, next.at - done) : remaining,
    arrived: remaining < 25,
  };
}

/** Off route: clearly away from the line, judged against the GPS accuracy. */
export function isOffRoute(progress, accuracy) {
  const allowance = Math.max(40, Math.min(150, (accuracy || 30) * 1.5));
  return progress.offRoute > allowance;
}
