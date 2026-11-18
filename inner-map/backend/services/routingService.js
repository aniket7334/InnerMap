// Routing on the server side.
//
// Online providers (chosen with ROUTING_PROVIDER in .env):
//   osrm        - any OSRM server. Defaults to the FOSSGIS servers at routing.openstreetmap.de
//                 (car, bike, foot; OpenStreetMap data). Their policy: max 1 request/second,
//                 no heavy use, attribution required. Fine for development and light use; for
//                 production run your own OSRM and set OSRM_CAR_URL / OSRM_BIKE_URL / OSRM_FOOT_URL.
//   graphhopper - GraphHopper Directions API (needs GRAPHHOPPER_API_KEY; free tier has a daily limit).
//   local       - Inner Map's own router over data/<name>.routing.json.gz (no external service,
//                 but only covers the area that file was built for).
//
// The offline road graph (data/<name>.routing.json.gz) is also served in pieces so browsers can
// store it and route without any connection.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const config = require('../config/env');
const { HttpError } = require('../middleware/errorHandler');

const USER_AGENT = 'InnerMap/1.0 (self-hosted offline map app)';
const PROFILES = ['car', 'bike', 'foot', 'motorcycle'];
// How far a requested point may be from the nearest road (same idea as the offline router).
const MAX_SNAP_METERS = 500;

// ------------------------------------------------------------------ shared code (ESM)
let sharedPromise;
function shared() {
  if (!sharedPromise) {
    const base = path.join(__dirname, '..', '..', 'shared', 'routing');
    const url = (f) => require('url').pathToFileURL(path.join(base, f)).href;
    sharedPromise = Promise.all([import(url('graph.mjs')), import(url('router.mjs'))]).then(([graph, router]) => ({
      ...graph,
      ...router,
    }));
  }
  return sharedPromise;
}

// ------------------------------------------------------------------ local graph
let graphCache = null;
function loadGraph() {
  const file = config.routingGraphFile;
  if (!fs.existsSync(file)) return null;
  const stat = fs.statSync(file);
  if (!graphCache || graphCache.mtime !== stat.mtimeMs) {
    const graph = JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8'));
    graphCache = { mtime: stat.mtimeMs, graph, size: stat.size, prepared: {}, subsets: new Map() };
  }
  return graphCache;
}

function graphInfo() {
  const c = loadGraph();
  if (!c) return { available: false };
  const g = c.graph;
  return {
    available: true,
    name: g.name,
    bounds: g.bounds,
    source: g.source,
    license: g.license,
    builtAt: g.builtAt,
    junctions: g.nodeId.length,
    roadSegments: g.edgeA.length,
    compressedBytes: c.size,
  };
}

/** gzip-compressed JSON of the graph cut to bounds (cached, small LRU). */
async function graphSubsetGz(bounds) {
  const c = loadGraph();
  if (!c) throw new HttpError(404, 'This server has no offline routing data. See backend/data/README.md.');
  const gb = c.graph.bounds;
  const b = {
    south: Math.max(bounds.south, gb.south),
    west: Math.max(bounds.west, gb.west),
    north: Math.min(bounds.north, gb.north),
    east: Math.min(bounds.east, gb.east),
  };
  if (b.south >= b.north || b.west >= b.east) {
    throw new HttpError(404, 'The requested area is outside the routing data on this server.');
  }
  const key = [b.south, b.west, b.north, b.east].map((v) => v.toFixed(5)).join(',');
  if (!c.subsets.has(key)) {
    const { subsetGraph } = await shared();
    const sub = subsetGraph(c.graph, b);
    const gz = zlib.gzipSync(JSON.stringify(sub), { level: 6 });
    c.subsets.set(key, { gz, edges: sub.edgeA.length, bounds: b });
    if (c.subsets.size > 8) c.subsets.delete(c.subsets.keys().next().value);
  }
  return c.subsets.get(key);
}

async function localRoute(profile, from, to) {
  const c = loadGraph();
  if (!c) throw new HttpError(503, 'Local routing is not configured on this server.');
  const { prepare, route, covers } = await shared();
  if (!covers([c.graph.bounds], from.lat, from.lng) || !covers([c.graph.bounds], to.lat, to.lng)) {
    throw new HttpError(422, 'Start or destination is outside the area covered by this server’s routing data.');
  }
  if (!c.prepared[profile]) c.prepared[profile] = prepare(c.graph, profile);
  const r = route(c.prepared[profile], from, to);
  if (!r.ok) throw new HttpError(422, r.message);
  return {
    provider: 'local',
    providerLabel: 'Inner Map router (OpenStreetMap data on this server)',
    attribution: '© OpenStreetMap contributors',
    distance: r.distance,
    duration: r.duration,
    durationIsEstimate: true,
    geometry: r.geometry,
    steps: r.steps,
  };
}

// ------------------------------------------------------------------ OSRM
// OSRM allows at most one request per second on the FOSSGIS servers: serialize calls.
let lastCall = 0;
let queue = Promise.resolve();
function throttle(fn) {
  const run = queue.then(async () => {
    const wait = 1100 - (Date.now() - lastCall);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastCall = Date.now();
    return fn();
  });
  queue = run.catch(() => {});
  return run;
}

const OSRM_DEFAULTS = {
  car: 'https://routing.openstreetmap.de/routed-car',
  bike: 'https://routing.openstreetmap.de/routed-bike',
  foot: 'https://routing.openstreetmap.de/routed-foot',
};

function osrmText(step) {
  const m = step.maneuver || {};
  const name = step.name || step.ref || '';
  const onto = name ? ` onto ${name}` : '';
  const mod = m.modifier ? m.modifier.replace('slight', 'slight').replace('sharp', 'sharp') : '';
  switch (m.type) {
    case 'depart':
      return `Head ${['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][Math.round((m.bearing_after || 0) / 45) % 8]}${name ? ` on ${name}` : ''}`;
    case 'arrive':
      return 'Arrive at your destination';
    case 'roundabout':
    case 'rotary':
      return `Enter the roundabout and take exit ${m.exit || ''}${onto}`.replace('  ', ' ');
    case 'merge':
      return `Merge${mod ? ` ${mod}` : ''}${onto}`;
    case 'on ramp':
      return `Take the ramp${mod ? ` on the ${mod}` : ''}${onto}`;
    case 'off ramp':
      return `Take the exit${mod ? ` on the ${mod}` : ''}${onto}`;
    case 'fork':
      return `Keep ${mod || 'straight'} at the fork${onto}`;
    case 'end of road':
      return `At the end of the road, turn ${mod || ''}${onto}`;
    case 'continue':
    case 'new name':
      if (mod === 'uturn') return `Make a U-turn${onto}`;
      return `Continue${mod && mod !== 'straight' ? ` ${mod}` : ''}${onto}`;
    default:
      if (mod === 'straight') return `Continue straight${onto}`;
      if (mod === 'uturn') return `Make a U-turn${onto}`;
      return `Turn ${mod || ''}${onto}`.replace('  ', ' ');
  }
}

async function osrmRoute(profile, from, to) {
  const base = (config.routing.osrm[profile] || OSRM_DEFAULTS[profile]).replace(/\/$/, '');
  const url =
    `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}` +
    '?overview=full&geometries=geojson&steps=true&alternatives=false';
  const res = await throttle(() =>
    fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(20000) })
  );
  const data = await res.json().catch(() => ({}));
  if (data.code === 'NoRoute' || data.code === 'NoSegment') {
    throw new HttpError(422, 'The online routing service found no route between these points.');
  }
  if (!res.ok || data.code !== 'Ok' || !data.routes?.length) {
    throw new HttpError(502, `The online routing service failed (${data.code || `HTTP ${res.status}`}).`);
  }
  // OSRM moves each point to the nearest road however far away it is. Refuse instead of
  // returning a route that starts or ends somewhere the user did not ask for.
  const [wStart, wEnd] = data.waypoints || [];
  for (const [w, label] of [
    [wStart, 'starting point'],
    [wEnd, 'destination'],
  ]) {
    if (w && w.distance > MAX_SNAP_METERS) {
      throw new HttpError(
        422,
        `The ${label} is ${w.distance >= 1000 ? `${(w.distance / 1000).toFixed(1)} km` : `${Math.round(w.distance)} m`} from the nearest road usable for this travel mode. Choose a point on or near a road.`
      );
    }
  }
  const r = data.routes[0];
  const steps = r.legs.flatMap((leg) =>
    leg.steps.map((s) => ({
      text: osrmText(s),
      distance: Math.round(s.distance),
      lat: s.maneuver.location[1],
      lng: s.maneuver.location[0],
    }))
  );
  const fossgis = base.includes('routing.openstreetmap.de');
  return {
    provider: 'osrm',
    providerLabel: fossgis ? 'OSRM (FOSSGIS routing.openstreetmap.de)' : 'OSRM',
    attribution: '© OpenStreetMap contributors' + (fossgis ? ' · routing by FOSSGIS e.V. OSRM servers' : ''),
    distance: Math.round(r.distance),
    duration: Math.round(r.duration),
    durationIsEstimate: false,
    geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    steps,
  };
}

// ------------------------------------------------------------------ GraphHopper
async function graphhopperRoute(profile, from, to) {
  const key = config.routing.graphhopperKey;
  if (!key) throw new HttpError(503, 'GRAPHHOPPER_API_KEY is not set.');
  const vehicle = { car: 'car', bike: 'bike', foot: 'foot' }[profile];
  const params = new URLSearchParams({
    profile: vehicle,
    points_encoded: 'false',
    instructions: 'true',
    locale: 'en',
    key,
  });
  params.append('point', `${from.lat},${from.lng}`);
  params.append('point', `${to.lat},${to.lng}`);
  const res = await fetch(`https://graphhopper.com/api/1/route?${params}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.paths?.length) {
    const msg = data.message || `HTTP ${res.status}`;
    throw new HttpError(res.status === 400 ? 422 : 502, `GraphHopper: ${msg}`);
  }
  const p = data.paths[0];
  const coords = p.points.coordinates;
  return {
    provider: 'graphhopper',
    providerLabel: 'GraphHopper Directions API',
    attribution: '© OpenStreetMap contributors · GraphHopper',
    distance: Math.round(p.distance),
    duration: Math.round(p.time / 1000),
    durationIsEstimate: false,
    geometry: coords.map(([lng, lat]) => [lat, lng]),
    steps: p.instructions.map((ins) => ({
      text: ins.text,
      distance: Math.round(ins.distance),
      lat: coords[ins.interval[0]][1],
      lng: coords[ins.interval[0]][0],
    })),
  };
}

// ------------------------------------------------------------------ public API
function onlineInfo() {
  const provider = config.routing.provider;
  const labels = {
    osrm: config.routing.osrm.car ? 'OSRM (self-hosted)' : 'OSRM (FOSSGIS routing.openstreetmap.de)',
    graphhopper: 'GraphHopper Directions API',
    local: 'Inner Map router (this server)',
  };
  return { provider, label: labels[provider] || provider, profiles: PROFILES };
}

/**
 * Motorcycle routing. Public OSRM servers and the hosted GraphHopper API have no motorcycle
 * profile, so: a configured OSRM motorcycle server -> else Inner Map's own router (OSM
 * motorcycle restrictions, inside its road data) -> else a CAR route, clearly marked as such.
 */
async function motorcycleRoute(from, to) {
  if (config.routing.osrm.motorcycle) {
    const r = await osrmRoute('motorcycle', from, to);
    return { ...r, providerLabel: `${r.providerLabel} (motorcycle profile)` };
  }
  const c = loadGraph();
  let localError = null;
  if (c) {
    try {
      const r = await localRoute('motorcycle', from, to);
      return { ...r, profileNote: 'Motorcycle route on OpenStreetMap data (two-wheeler restrictions such as banned expressways are respected).' };
    } catch (err) {
      localError = err;
      // A real "no route" inside the data must not be replaced by a car route.
      if (err.status === 422 && !/outside the area/.test(err.message)) throw err;
    }
  }
  const car = config.routing.provider === 'graphhopper' ? await graphhopperRoute('car', from, to) : await osrmRoute('car', from, to);
  return {
    ...car,
    profileFallback: 'car',
    profileNote:
      'No motorcycle routing is available here online, so this is a CAR route. It may use roads where two-wheelers are not allowed (e.g. some expressways and sea links). ' +
      (localError ? 'Motorcycle routing works inside the Inner Map road-data area.' : ''),
  };
}

async function onlineRoute(profile, from, to) {
  if (!PROFILES.includes(profile)) throw new HttpError(400, 'profile must be car, bike, foot or motorcycle');
  if (profile === 'motorcycle' && config.routing.provider !== 'local') return motorcycleRoute(from, to);
  switch (config.routing.provider) {
    case 'graphhopper':
      return graphhopperRoute(profile, from, to);
    case 'local':
      return localRoute(profile, from, to);
    case 'osrm':
    default:
      return osrmRoute(profile, from, to);
  }
}

module.exports = { onlineInfo, onlineRoute, localRoute, graphInfo, graphSubsetGz, PROFILES };
