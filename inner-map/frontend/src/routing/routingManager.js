// Chooses between online and offline routing and always says which one it used.
//
//   auto    - online provider when the Inner Map server is reachable, otherwise the road data
//             stored on this device. If the online provider fails, the error says so and offers
//             offline routing (it never switches silently).
//   online  - only the online provider.
//   offline - only the downloaded road data.
//
// Offline routes come from real OpenStreetMap road data (one-way streets, access rules) stored
// with a downloaded area. If there is no road path, the user is told - no straight-line fallback.
import { fetchOnlineRoute } from '../services/routingApi';
import { listRoutingData } from '../offline/routingStore';
import { isApiReachable, isOnline } from '../offline/connectivity';
import { directRoute } from './directOsrm';
import { covers } from '../../../shared/routing/router.mjs';

let worker = null;
let seq = 0;
const pending = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./routing.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (ev) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error) p.reject(new Error(ev.data.error));
      else p.resolve(ev.data.result);
    };
    worker.onerror = (ev) => {
      pending.forEach((p) => p.reject(new Error(ev.message || 'Offline routing failed to start.')));
      pending.clear();
      worker = null;
    };
  }
  return worker;
}

function runWorker(payload) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ id, ...payload });
  });
}

/**
 * Start the routing worker once while online, so its code is fetched and cached by the
 * service worker - offline directions then work even if no route was calculated online before.
 */
export function warmUpRouting() {
  try {
    getWorker();
  } catch {
    /* workers unsupported: offline routing will report it when used */
  }
}

export class RouteError extends Error {
  constructor(message, { code, canTryOffline = false, canTryOnline = false } = {}) {
    super(message);
    this.code = code;
    this.canTryOffline = canTryOffline;
    this.canTryOnline = canTryOnline;
  }
}

/** Offline coverage on this device: [{ regionId, bounds, ... }]. */
export async function offlineCoverage(userId) {
  return listRoutingData(userId);
}

async function offlineRoute(userId, profile, from, to) {
  const data = await listRoutingData(userId);
  if (!data.length) {
    throw new RouteError(
      'No offline road data on this device. While online, download an area with “Include road data for offline directions”.',
      { code: 'no-offline-data' }
    );
  }
  const startIn = data.filter((d) => covers([d.bounds], from.lat, from.lng));
  const endIn = data.filter((d) => covers([d.bounds], to.lat, to.lng));
  if (!startIn.length || !endIn.length) {
    const which = !startIn.length && !endIn.length ? 'The start and the destination are' : !startIn.length ? 'The start is' : 'The destination is';
    throw new RouteError(
      `${which} outside the areas with downloaded road data (${data.map((d) => d.name).join(', ')}). Offline directions only work inside them.`,
      { code: 'outside-coverage', canTryOnline: isApiReachable() }
    );
  }
  // Use every stored area that overlaps the trip, merged into one network.
  const lat0 = Math.min(from.lat, to.lat);
  const lat1 = Math.max(from.lat, to.lat);
  const lng0 = Math.min(from.lng, to.lng);
  const lng1 = Math.max(from.lng, to.lng);
  const ids = data
    .filter((d) => d.bounds.south <= lat1 && d.bounds.north >= lat0 && d.bounds.west <= lng1 && d.bounds.east >= lng0)
    .map((d) => d.regionId);
  const r = await runWorker({ regionIds: ids, profile, from, to });
  if (!r.ok) throw new RouteError(r.message, { code: r.reason, canTryOnline: isApiReachable() });
  return {
    mode: 'offline',
    provider: 'device',
    providerLabel: 'Downloaded road data (OpenStreetMap)',
    attribution: '© OpenStreetMap contributors',
    distance: r.distance,
    duration: r.duration,
    durationIsEstimate: true,
    geometry: r.geometry,
    steps: r.steps,
    snapped: r.snapped,
    stats: { ms: r.ms, edges: r.edges },
  };
}

/**
 * Calculate a route. preference: 'auto' | 'online' | 'offline'.
 * Resolves to a route object with `mode` ('online' | 'offline'); rejects with RouteError.
 */
export async function calculateRoute({ userId, profile, from, to, preference = 'auto' }) {
  const serverUp = isApiReachable();
  const internet = isOnline(); // false in offline mode too
  const useOnline = preference === 'online' || (preference === 'auto' && (serverUp || internet));
  if (useOnline) {
    const hasOffline = async () => (userId ? (await listRoutingData(userId)).length > 0 : false);
    if (serverUp) {
      try {
        const r = await fetchOnlineRoute(profile, from, to);
        return { ...r, mode: 'online' };
      } catch (err) {
        const status = err.response?.status;
        // the server went away, or this visitor is not signed in: ask the routing service directly
        if (internet && (!status || status === 401 || status === 403 || status >= 502)) {
          try {
            return { ...(await directRoute(profile, from, to)), mode: 'online' };
          } catch {
            /* report the server's error below */
          }
        }
        const message = err.response?.data?.message || err.message || 'Online routing failed.';
        throw new RouteError(message, { code: 'online-failed', canTryOffline: await hasOffline() });
      }
    }
    // The Inner Map server is not reachable (not running, or the app is hosted without it):
    // the public OpenStreetMap routing service directly from the browser.
    if (internet) {
      try {
        return { ...(await directRoute(profile, from, to)), mode: 'online' };
      } catch (err) {
        throw new RouteError(err.message || 'Online routing failed.', { code: 'online-failed', canTryOffline: await hasOffline() });
      }
    }
    throw new RouteError('Online routing needs an internet connection (offline mode may be on). Downloaded road data can be used instead.', { code: 'offline', canTryOffline: true });
  }
  return offlineRoute(userId, profile, from, to);
}
