// Road-network router (A* over the graph from graph.mjs). Runs in the browser (Web Worker,
// fully offline) and in Node (backend "local" provider). It never invents a straight line:
// if the two points are not connected by usable roads, it reports that.
import { PROFILES, CLASSES, FOOT_SPEED, BIKE_SPEED, MAX_CAR_SPEED, MOTO_MAX_SPEED } from './profiles.mjs';
import { haversine } from './graph.mjs';

const E6 = 1e6;
const CELL = 0.002; // ~220 m spatial index cells
export const MAX_SNAP_METERS = 400;

class MinHeap {
  constructor() {
    this.keys = [];
    this.vals = [];
  }
  get size() {
    return this.keys.length;
  }
  push(k, v) {
    const keys = this.keys;
    const vals = this.vals;
    let i = keys.length;
    keys.push(k);
    vals.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= k) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = k;
    vals[i] = v;
  }
  pop() {
    const keys = this.keys;
    const vals = this.vals;
    const topV = vals[0];
    const topK = keys[0];
    const lastK = keys.pop();
    const lastV = vals.pop();
    if (keys.length) {
      let i = 0;
      const n = keys.length;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c += 1;
        if (keys[c] >= lastK) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastK;
      vals[i] = lastV;
    }
    return [topK, topV];
  }
}

/** Points of edge e from A to B as [[lat, lon], ...]. */
export function edgePoints(g, e) {
  const pts = [[g.nodeLat[g.edgeA[e]] / E6, g.nodeLon[g.edgeA[e]] / E6]];
  for (let k = g.shapeOff[e]; k < g.shapeOff[e + 1]; k += 2) pts.push([g.shape[k] / E6, g.shape[k + 1] / E6]);
  pts.push([g.nodeLat[g.edgeB[e]] / E6, g.nodeLon[g.edgeB[e]] / E6]);
  return pts;
}

function speedOf(g, e, profile) {
  if (profile === 'foot') return FOOT_SPEED;
  if (profile === 'bike') return BIKE_SPEED;
  if (profile === 'motorcycle') return Math.min(MOTO_MAX_SPEED, g.edgeSpeed[e] || 15);
  return g.edgeSpeed[e] || 15;
}

/**
 * Prepare a graph for one travel mode: adjacency lists (forward star) with travel times,
 * and a spatial index of every road point the mode may use.
 */
export function prepare(g, profile) {
  const p = PROFILES[profile];
  if (!p) throw new Error(`Unknown travel mode: ${profile}`);
  if (!(g.profiles || ['car', 'bike', 'foot']).includes(profile)) {
    const err = new Error('This road data was made before motorcycle routing existed. Update the road data of this area (Offline maps) to route by motorcycle.');
    err.code = 'profile-unsupported';
    throw err;
  }
  const n = g.nodeId.length;
  const m = g.edgeA.length;
  const deg = new Uint32Array(n + 1);
  const allowed = new Uint8Array(m); // bit 1 = A->B, bit 2 = B->A
  for (let e = 0; e < m; e += 1) {
    const f = g.edgeFlags[e];
    let a = 0;
    if (f & p.fwd) a |= 1;
    if (f & p.bwd) a |= 2;
    allowed[e] = a;
    if (a & 1) deg[g.edgeA[e]] += 1;
    if (a & 2) deg[g.edgeB[e]] += 1;
  }
  const off = new Uint32Array(n + 1);
  for (let i = 0; i < n; i += 1) off[i + 1] = off[i] + deg[i];
  const to = new Uint32Array(off[n]);
  const via = new Uint32Array(off[n]);
  const dir = new Uint8Array(off[n]); // 0 = traversed A->B, 1 = B->A
  const cost = new Float32Array(off[n]);
  const fill = off.slice(0, n);
  for (let e = 0; e < m; e += 1) {
    const t = (g.edgeLen[e] / 10 / (speedOf(g, e, profile) / 3.6));
    if (allowed[e] & 1) {
      const k = fill[g.edgeA[e]]++;
      to[k] = g.edgeB[e];
      via[k] = e;
      dir[k] = 0;
      cost[k] = t;
    }
    if (allowed[e] & 2) {
      const k = fill[g.edgeB[e]]++;
      to[k] = g.edgeA[e];
      via[k] = e;
      dir[k] = 1;
      cost[k] = t;
    }
  }

  // Spatial index over road points: cell -> [edge, pointIndex, edge, pointIndex, ...]
  const grid = new Map();
  for (let e = 0; e < m; e += 1) {
    if (!allowed[e]) continue;
    const pts = edgePoints(g, e);
    for (let k = 0; k < pts.length; k += 1) {
      const key = `${Math.floor(pts[k][0] / CELL)}:${Math.floor(pts[k][1] / CELL)}`;
      let list = grid.get(key);
      if (!list) grid.set(key, (list = []));
      list.push(e, k);
    }
  }
  const maxSpeed = profile === 'foot' ? FOOT_SPEED : profile === 'bike' ? BIKE_SPEED : profile === 'motorcycle' ? MOTO_MAX_SPEED : MAX_CAR_SPEED;
  return { g, profile, off, to, via, dir, cost, allowed, grid, maxSpeed };
}

/** Nearest usable road point to (lat, lon): { edge, k, lat, lon, dist } or null. */
export function snap(r, lat, lon, maxMeters = MAX_SNAP_METERS) {
  const ci = Math.floor(lat / CELL);
  const cj = Math.floor(lon / CELL);
  let best = null;
  const rings = Math.ceil(maxMeters / 200) + 1;
  for (let ring = 0; ring <= rings; ring += 1) {
    for (let di = -ring; di <= ring; di += 1) {
      for (let dj = -ring; dj <= ring; dj += 1) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
        const list = r.grid.get(`${ci + di}:${cj + dj}`);
        if (!list) continue;
        for (let x = 0; x < list.length; x += 2) {
          const e = list[x];
          const k = list[x + 1];
          const pts = edgePoints(r.g, e);
          const d = haversine(lat, lon, pts[k][0], pts[k][1]);
          if (!best || d < best.dist) best = { edge: e, k, lat: pts[k][0], lon: pts[k][1], dist: d, pts };
        }
      }
    }
    // Stop once the found point is closer than anything in the next ring could be.
    if (best && best.dist < ring * CELL * 111000 * 0.9) break;
  }
  return best && best.dist <= maxMeters ? best : null;
}

function prefixLengths(pts) {
  const acc = [0];
  for (let i = 1; i < pts.length; i += 1) acc.push(acc[i - 1] + haversine(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]));
  return acc;
}

function bearing(a, b) {
  const r = Math.PI / 180;
  const y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];
function turnText(delta) {
  const d = ((delta + 540) % 360) - 180; // -180..180, positive = right
  const a = Math.abs(d);
  if (a < 20) return 'Continue';
  const side = d > 0 ? 'right' : 'left';
  if (a < 60) return `Bear ${side}`;
  if (a < 135) return `Turn ${side}`;
  return `Make a sharp ${side}`;
}

function roadLabel(g, e) {
  const n = g.names[g.edgeName[e]];
  if (n) return n;
  const cls = CLASSES[g.edgeCls[e]];
  return {
    footway: 'the footpath', path: 'the path', pedestrian: 'the pedestrian street', steps: 'the steps',
    cycleway: 'the cycle path', service: 'the service road', track: 'the track',
  }[cls] || 'the road';
}

/** Road identity for grouping: "Nanabhai Moos Marg (Upper Colaba Road)" = "Nanabhai Moos Marg". */
function roadKey(g, e) {
  const n = g.names[g.edgeName[e]];
  return n ? n.replace(/\s*\([^)]*\)\s*$/, '').toLowerCase() : `#${g.edgeCls[e]}`;
}

/** Turn the list of traversed edges into readable steps. */
function instructions(g, legs, startPt, endPt) {
  const steps = [];
  let i = 0;
  while (i < legs.length) {
    const key = roadKey(g, legs[i].e);
    let j = i;
    let dist = 0;
    // Group consecutive edges on the same road (unnamed roads are grouped by class).
    while (j < legs.length && roadKey(g, legs[j].e) === key) {
      dist += legs[j].len;
      j += 1;
    }
    const first = legs[i].pts;
    const label = roadLabel(g, legs[i].e);
    let text;
    if (i === 0) {
      const b = bearing(first[0], first[Math.min(1, first.length - 1)]);
      text = `Head ${COMPASS[Math.round(b / 45) % 8]} on ${label}`;
    } else {
      const prev = legs[i - 1].pts;
      const inB = bearing(prev[Math.max(0, prev.length - 2)], prev[prev.length - 1]);
      const outB = bearing(first[0], first[Math.min(1, first.length - 1)]);
      const t = turnText(outB - inB);
      text = t === 'Continue' ? `Continue onto ${label}` : `${t} onto ${label}`;
    }
    steps.push({ text, distance: Math.round(dist), lat: first[0][0], lng: first[0][1] });
    i = j;
  }
  steps.push({ text: 'Arrive at your destination', distance: 0, lat: endPt[0], lng: endPt[1] });
  if (startPt) steps[0].lat = startPt[0];
  return steps;
}

/**
 * Route from (fromLat, fromLon) to (toLat, toLon).
 * Returns { ok: true, distance, duration, geometry: [[lat,lon]...], steps, snapped } or
 * { ok: false, reason, message }.
 */
export function route(r, from, to) {
  const s = snap(r, from.lat, from.lng);
  if (!s) return { ok: false, reason: 'start-off-road', message: `The starting point is more than ${MAX_SNAP_METERS} m from any road in the downloaded data.` };
  const t = snap(r, to.lat, to.lng);
  if (!t) return { ok: false, reason: 'end-off-road', message: `The destination is more than ${MAX_SNAP_METERS} m from any road in the downloaded data.` };

  const { g, off, to: adjTo, via, dir, cost, allowed, maxSpeed } = r;
  const n = g.nodeId.length;
  const ms = maxSpeed / 3.6;
  const timeOf = (e, meters) => meters / (speedOf(g, e, r.profile) / 3.6);

  // Start: from the snapped point we can drive towards B (if A->B allowed) and/or towards A.
  const sAcc = prefixLengths(s.pts);
  const sLen = sAcc[sAcc.length - 1];
  const tAcc = prefixLengths(t.pts);
  const tLen = tAcc[tAcc.length - 1];

  // Same edge, reachable directly along it.
  let direct = null;
  if (s.edge === t.edge) {
    const forward = t.k >= s.k;
    const okDir = forward ? allowed[s.edge] & 1 : allowed[s.edge] & 2;
    if (okDir) {
      const meters = Math.abs(tAcc[t.k] - sAcc[s.k]);
      const pts = forward ? s.pts.slice(s.k, t.k + 1) : s.pts.slice(t.k, s.k + 1).reverse();
      direct = { time: timeOf(s.edge, meters), meters, pts };
    }
  }

  const gScore = new Float64Array(n).fill(Infinity);
  const prevK = new Int32Array(n).fill(-1); // adjacency slot used to reach node
  const heap = new MinHeap();
  const h = (i) => haversine(g.nodeLat[i] / E6, g.nodeLon[i] / E6, t.lat, t.lon) / ms;
  const seed = (node, time) => {
    if (time < gScore[node]) {
      gScore[node] = time;
      heap.push(time + h(node), node);
    }
  };
  if (allowed[s.edge] & 1) seed(g.edgeB[s.edge], timeOf(s.edge, sLen - sAcc[s.k]));
  if (allowed[s.edge] & 2) seed(g.edgeA[s.edge], timeOf(s.edge, sAcc[s.k]));

  // Finish: reach the target point from A (needs A->B) or from B (needs B->A).
  const endA = allowed[t.edge] & 1 ? timeOf(t.edge, tAcc[t.k]) : Infinity;
  const endB = allowed[t.edge] & 2 ? timeOf(t.edge, tLen - tAcc[t.k]) : Infinity;
  const tA = g.edgeA[t.edge];
  const tB = g.edgeB[t.edge];

  let best = direct ? direct.time : Infinity;
  let bestNode = -1;
  let settled = 0;
  while (heap.size) {
    const [f, u] = heap.pop();
    if (f >= best) break;
    const gu = gScore[u];
    if (f > gu + h(u) + 1e-6) continue; // stale entry
    settled += 1;
    if (u === tA && gu + endA < best) {
      best = gu + endA;
      bestNode = u;
    }
    if (u === tB && gu + endB < best) {
      best = gu + endB;
      bestNode = u;
    }
    for (let k = off[u]; k < off[u + 1]; k += 1) {
      const v = adjTo[k];
      const ng = gu + cost[k];
      if (ng < gScore[v]) {
        gScore[v] = ng;
        prevK[v] = k;
        heap.push(ng + h(v), v);
      }
    }
  }

  if (best === Infinity) {
    return {
      ok: false,
      reason: 'no-route',
      message: 'No route was found: these points are not connected by roads usable in this travel mode within the downloaded data (one-way streets, private roads or a missing connection).',
    };
  }

  // Assemble the path.
  let geometry;
  let meters;
  let legs = [];
  if (bestNode === -1) {
    geometry = direct.pts;
    meters = direct.meters;
    legs = [{ e: s.edge, len: meters, pts: direct.pts }];
  } else {
    const chain = [];
    let u = bestNode;
    while (prevK[u] !== -1) {
      const k = prevK[u];
      chain.push(k);
      // the node we came from: the other end of the edge
      const e = via[k];
      u = dir[k] === 0 ? g.edgeA[e] : g.edgeB[e];
    }
    chain.reverse();
    const firstNode = chain.length ? (dir[chain[0]] === 0 ? g.edgeA[via[chain[0]]] : g.edgeB[via[chain[0]]]) : bestNode;
    // first partial edge (from the snapped start to firstNode)
    const startPts = firstNode === g.edgeB[s.edge] && allowed[s.edge] & 1 ? s.pts.slice(s.k) : s.pts.slice(0, s.k + 1).reverse();
    legs.push({ e: s.edge, len: prefixLengths(startPts).pop(), pts: startPts });
    for (const k of chain) {
      const e = via[k];
      const pts = dir[k] === 0 ? edgePoints(g, e) : edgePoints(g, e).reverse();
      legs.push({ e, len: g.edgeLen[e] / 10, pts });
    }
    const endPts = bestNode === tA ? t.pts.slice(0, t.k + 1) : t.pts.slice(t.k).reverse();
    legs.push({ e: t.edge, len: prefixLengths(endPts).pop(), pts: endPts });
    legs = legs.filter((l) => l.pts.length > 1 || l.len > 0);
    geometry = [];
    for (const l of legs) for (const p of l.pts) {
      const last = geometry[geometry.length - 1];
      if (!last || last[0] !== p[0] || last[1] !== p[1]) geometry.push(p);
    }
    meters = legs.reduce((sum, l) => sum + l.len, 0);
  }

  return {
    ok: true,
    distance: Math.round(meters),
    duration: Math.round(best),
    geometry,
    steps: instructions(g, legs, [s.lat, s.lon], [t.lat, t.lon]),
    snapped: { start: { lat: s.lat, lng: s.lon, offset: Math.round(s.dist) }, end: { lat: t.lat, lng: t.lon, offset: Math.round(t.dist) } },
    settled,
  };
}

/** True if (lat, lng) lies inside any of the bounds. */
export function covers(boundsList, lat, lng) {
  return boundsList.some((b) => lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east);
}
