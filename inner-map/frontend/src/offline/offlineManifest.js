// What the Inner Map server offers for offline use (GET /api/offline/manifest): its map areas
// with the time their data last changed, and its offline road data. Fetched while online and
// remembered on this device, so the Offline mode screen can still say - with no connection -
// which downloaded maps had newer data the last time we checked.
import { isOfflineMode } from './connectivity';

const KEY = 'innermap.offline-manifest';
const URL = `${import.meta.env.VITE_API_URL || '/api'}/offline/manifest`;

/** The last manifest seen on this device: { data, at } or null. */
export function getCachedManifest() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) || 'null');
    return v?.data ? v : null;
  } catch {
    return null;
  }
}

/** Ask the server (never in offline mode). Resolves to { data, at } or the cached one. */
export async function refreshManifest() {
  if (isOfflineMode() || !navigator.onLine) return getCachedManifest();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(URL, { cache: 'no-store', signal: ctrl.signal });
    if (!res.ok) return getCachedManifest();
    const out = { data: await res.json(), at: Date.now() };
    try {
      localStorage.setItem(KEY, JSON.stringify(out));
    } catch {
      /* storage full or private window: still returned */
    }
    return out;
  } catch {
    return getCachedManifest();
  } finally {
    clearTimeout(t);
  }
}

const overlaps = (a, b) => a && b && a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;

/**
 * Downloaded street-map areas whose server data changed after they were downloaded.
 * -> Set of region ids. Only vector (Inner Map server) maps have a version to compare.
 */
export function regionsWithUpdates(regions, manifest) {
  const areas = manifest?.data?.maps?.areas || [];
  const out = new Set();
  for (const r of regions) {
    if (r.kind !== 'vector' || !r.createdAt) continue;
    if (areas.some((a) => a.updatedAt && a.updatedAt > r.createdAt && overlaps(a.bounds, r.bounds))) out.add(r.id);
  }
  return out;
}

/** Whether the server has offline road data for (part of) an area. */
export function routingCovers(manifest, bounds) {
  const g = manifest?.data?.routing;
  return Boolean(g?.available && overlaps(g.bounds, bounds));
}
