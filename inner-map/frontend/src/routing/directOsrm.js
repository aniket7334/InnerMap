// Online routing straight from the browser to the public OpenStreetMap routing service (FOSSGIS
// OSRM at routing.openstreetmap.de - the same service the Inner Map server uses by default).
// Used when the Inner Map server cannot be reached (it is not running, or the app is hosted
// without it, e.g. a static deployment), so online directions keep working with internet.
// Mirrors backend/services/routingService.js: same request, step texts and safety checks;
// at most one request per second (the service's usage policy).
const BASE = {
  car: 'https://routing.openstreetmap.de/routed-car',
  bike: 'https://routing.openstreetmap.de/routed-bike',
  foot: 'https://routing.openstreetmap.de/routed-foot',
};
const MAX_SNAP_METERS = 500;
const COMPASS = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

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

function stepText(step) {
  const m = step.maneuver || {};
  const name = step.name || step.ref || '';
  const onto = name ? ` onto ${name}` : '';
  const mod = m.modifier || '';
  switch (m.type) {
    case 'depart':
      return `Head ${COMPASS[Math.round((m.bearing_after || 0) / 45) % 8]}${name ? ` on ${name}` : ''}`;
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

/** Route like the server's online route: { distance, duration, geometry, steps, ... }. Throws Error with a readable message. */
export async function directRoute(profile, from, to) {
  const motorcycle = profile === 'motorcycle';
  const base = BASE[motorcycle ? 'car' : profile] || BASE.car;
  const url = `${base}/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson&steps=true&alternatives=false`;
  let res;
  try {
    res = await throttle(() => fetch(url, { signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined }));
  } catch {
    throw new Error('The online routing service could not be reached. Check the internet connection.');
  }
  const data = await res.json().catch(() => ({}));
  if (data.code === 'NoRoute' || data.code === 'NoSegment') throw new Error('The online routing service found no route between these points.');
  if (res.status === 429) throw new Error('The online routing service is busy. Try again in a minute.');
  if (!res.ok || data.code !== 'Ok' || !data.routes?.length) throw new Error(`The online routing service failed (${data.code || `HTTP ${res.status}`}).`);
  // OSRM moves each point to the nearest road however far away: refuse far-off points instead
  const [wStart, wEnd] = data.waypoints || [];
  for (const [w, label] of [
    [wStart, 'starting point'],
    [wEnd, 'destination'],
  ]) {
    if (w && w.distance > MAX_SNAP_METERS) {
      throw new Error(
        `The ${label} is ${w.distance >= 1000 ? `${(w.distance / 1000).toFixed(1)} km` : `${Math.round(w.distance)} m`} from the nearest road usable for this travel mode. Choose a point on or near a road.`
      );
    }
  }
  const r = data.routes[0];
  const route = {
    provider: 'osrm',
    providerLabel: 'OSRM (FOSSGIS routing.openstreetmap.de)',
    attribution: '© OpenStreetMap contributors · routing by FOSSGIS e.V. OSRM servers',
    distance: Math.round(r.distance),
    duration: Math.round(r.duration),
    durationIsEstimate: false,
    geometry: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    steps: r.legs.flatMap((leg) =>
      leg.steps.map((s) => ({ text: stepText(s), distance: Math.round(s.distance), lat: s.maneuver.location[1], lng: s.maneuver.location[0] }))
    ),
    direct: true,
  };
  if (motorcycle) {
    // the public service has no motorcycle profile (same rule as the server)
    route.profileFallback = 'car';
    route.profileNote =
      'No motorcycle routing is available online without the Inner Map server, so this is a CAR route. It may use roads where two-wheelers are not allowed (e.g. some expressways and sea links).';
  }
  return route;
}
