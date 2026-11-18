// Search: offline (on-device index of downloaded areas + saved places + coordinates)
// and online (OpenStreetMap Nominatim, on request only - its usage policy forbids
// autocomplete; max 1 request per second; attribution shown in the results).
import { getDB } from '../offline/db';
import { distanceMeters } from '../maps/geo';
import { CATEGORIES, categoryOf, kindLabel } from './categories';

// ---- coordinates ---------------------------------------------------------------------
const DMS = /(\d{1,3})[°\s]+(\d{1,2})['′\s]+(\d{1,2}(?:\.\d+)?)?["″]?\s*([NSEW])/gi;

/** "18.92, 72.83", "18.92N 72.83E", "-33.9 151.2", 18°55'19"N 72°50'4"E -> { lat, lng } or null. */
export function parseCoordinates(text) {
  const t = text.trim();
  const dms = [...t.matchAll(DMS)];
  if (dms.length === 2) {
    const val = (m) => {
      const v = Number(m[1]) + Number(m[2]) / 60 + Number(m[3] || 0) / 3600;
      return /[SW]/i.test(m[4]) ? -v : v;
    };
    const a = dms.find((m) => /[NS]/i.test(m[4]));
    const b = dms.find((m) => /[EW]/i.test(m[4]));
    if (a && b) return valid(val(a), val(b));
  }
  const m = t.match(/^(-?\d{1,2}(?:\.\d+)?)\s*°?\s*([NS])?[\s,;]+(-?\d{1,3}(?:\.\d+)?)\s*°?\s*([EW])?$/i);
  if (!m) return null;
  let lat = Number(m[1]);
  let lng = Number(m[3]);
  if (m[2] && /S/i.test(m[2])) lat = -Math.abs(lat);
  if (m[4] && /W/i.test(m[4])) lng = -Math.abs(lng);
  return valid(lat, lng);
}

function valid(lat, lng) {
  return Math.abs(lat) <= 90 && Math.abs(lng) <= 180 ? { lat, lng } : null;
}

// ---- offline index (cached in memory, reloaded when areas change) ---------------------
let cache = null; // { key, entries, neighbourhoods }

async function loadIndex(regionIds) {
  const key = [...regionIds].sort().join(',');
  if (cache && cache.key === key) return cache;
  const db = await getDB();
  const all = await db.getAll('places');
  const ids = new Set(regionIds);
  const entries = all.filter((e) => e.regions.some((r) => ids.has(r)));
  // Neighbourhoods/towns give results a "near …" location line (the data has no street addresses).
  const neighbourhoods = entries.filter((e) => e.layer === 'places' && ['neighbourhood', 'macrohood', 'locality', 'borough', 'suburb'].includes(e.kind));
  cache = { key, entries, neighbourhoods };
  return cache;
}

if (typeof window !== 'undefined') {
  window.addEventListener('innermap:search-index-changed', () => {
    cache = null;
  });
}

export async function offlineIndexSize(regionIds) {
  return (await loadIndex(regionIds)).entries.length;
}

function nearestArea(entry, neighbourhoods) {
  let best = null;
  let bestD = 4000; // only within 4 km
  for (const n of neighbourhoods) {
    if (n === entry || n.name === entry.name) continue;
    const d = distanceMeters(entry.lat, entry.lng, n.lat, n.lng);
    if (d < bestD) {
      bestD = d;
      best = n;
    }
  }
  return best?.name || null;
}

function score(entry, words, q) {
  const n = entry.nameLower;
  if (!words.every((w) => n.includes(w))) return 0;
  let s = 10;
  if (n === q) s += 100;
  else if (n.startsWith(q)) s += 60;
  else if (n.split(/[\s,()-]+/).some((part) => part.startsWith(words[0]))) s += 30;
  if (entry.layer === 'places') s += { country: 40, region: 35, locality: 30, neighbourhood: 15 }[entry.kind] || 10;
  if (entry.population) s += Math.min(20, Math.log10(entry.population + 1) * 3);
  if (entry.minZoom != null) s += Math.max(0, 16 - entry.minZoom); // more prominent in the data
  return s;
}

/**
 * @param {object} opts { query, category, regionIds, origin: {lat,lng}|null, radiusM, limit }
 * @returns {{ results: Array, indexSize: number }}
 */
export async function searchOffline({ query = '', category = 'all', regionIds = [], origin = null, radiusM = null, limit = 30 }) {
  const { entries, neighbourhoods } = await loadIndex(regionIds);
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const out = [];
  for (const e of entries) {
    if (category !== 'all' && e.category !== category) continue;
    // Browsing a category: more prominent features first (lower min_zoom in the data).
    const s = words.length ? score(e, words, q) : 1 + Math.max(0, 16 - (e.minZoom ?? 16)) + (e.population ? Math.log10(e.population + 1) : 0);
    if (!s) continue;
    const distance = origin ? distanceMeters(origin.lat, origin.lng, e.lat, e.lng) : null;
    if (radiusM && (distance == null || distance > radiusM)) continue;
    out.push({ e, s, distance });
  }
  // With a text query: best match first (nearer wins ties). Category browsing: nearest first.
  out.sort((a, b) =>
    words.length ? b.s - a.s || (a.distance ?? 0) - (b.distance ?? 0) : (a.distance ?? Infinity) - (b.distance ?? Infinity) || b.s - a.s
  );
  // Long streets are stored once per ~1 km: show each street name once (the nearest part).
  // A point of interest on a tile edge can be stored twice: drop same name+kind within ~150 m.
  const seen = new Set();
  const shown = [];
  const results = [];
  for (const { e, distance } of out) {
    const dup = `${e.layer}|${e.kind}|${e.nameLower}`;
    if ((e.layer === 'roads' || e.layer === 'water' || e.layer === 'places') && seen.has(dup)) continue;
    if (e.layer === 'pois' && shown.some((o) => o.nameLower === e.nameLower && o.kind === e.kind && distanceMeters(o.lat, o.lng, e.lat, e.lng) < 150)) continue;
    seen.add(dup);
    shown.push(e);
    results.push({
      id: e.key,
      source: 'offline',
      name: e.name,
      category: e.category,
      type: kindLabel(e.kind),
      address: e.layer === 'places' && e.kind !== 'neighbourhood' ? null : nearestArea(e, neighbourhoods),
      lat: e.lat,
      lng: e.lng,
      distance,
      zoom: e.layer === 'places' ? { country: 5, region: 7, locality: 12 }[e.kind] || 15 : 17,
    });
    if (results.length >= limit) break;
  }
  return { results, indexSize: entries.length };
}

/** Saved places of this user (always on the device). */
export function searchSaved(locations, query, origin) {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return locations
    .filter((l) => (l.name || '').toLowerCase().includes(q))
    .map((l) => ({
      id: `saved-${l.localId ?? l.id}`,
      source: 'saved',
      name: l.name,
      category: 'saved',
      type: 'Saved place',
      lat: l.latitude,
      lng: l.longitude,
      distance: origin ? distanceMeters(origin.lat, origin.lng, l.latitude, l.longitude) : null,
      zoom: 17,
    }));
}

// ---- online (Nominatim) ----------------------------------------------------------------
const GEOCODER_URL = import.meta.env.VITE_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
let lastRequest = 0;

/** Category search words Nominatim understands ("special phrases"). */
const ONLINE_PHRASE = {
  restaurants: 'restaurant',
  hotels: 'hotel',
  hospitals: 'hospital',
  fuel: 'fuel',
  shopping: 'shop',
  grocery: 'supermarket',
  atm: 'atm',
  banks: 'bank',
  schools: 'school',
  colleges: 'college',
  government: 'townhall',
  transport: 'station',
};

function onlineCategory(r) {
  // Nominatim gives OSM class/type, e.g. amenity=restaurant, shop=supermarket, place=city.
  if (r.category === 'place' || r.category === 'boundary') return 'places';
  if (r.category === 'highway') return 'streets';
  return categoryOf('pois', r.type) === 'other' && r.category === 'shop' ? 'shopping' : categoryOf('pois', r.type);
}

/**
 * Online search. With a category and an origin, searches near the origin (viewbox ~10 km).
 * Throws a readable error when offline or on HTTP errors (e.g. 429 rate limit).
 */
export async function searchOnline({ query = '', category = 'all', origin = null }) {
  if (!navigator.onLine) throw new Error('Online search needs an internet connection.');
  let q = query.trim();
  if (!q && category !== 'all') q = ONLINE_PHRASE[category] || '';
  else if (q && category !== 'all' && ONLINE_PHRASE[category]) q = `${ONLINE_PHRASE[category]} ${q}`;
  if (!q) return [];
  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '10', addressdetails: '1' });
  if (origin && category !== 'all') {
    const d = 0.1; // about 10 km
    params.set('viewbox', `${origin.lng - d},${origin.lat + d},${origin.lng + d},${origin.lat - d}`);
    params.set('bounded', '1');
  }
  const res = await fetch(`${GEOCODER_URL}?${params}`, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('The online search service is busy (rate limit). Try again in a minute.');
  if (!res.ok) throw new Error(`Online search failed (HTTP ${res.status}).`);
  const data = await res.json();
  return data.map((r) => {
    const lat = Number(r.lat);
    const lng = Number(r.lon);
    const bb = Array.isArray(r.boundingbox) ? r.boundingbox.map(Number) : null;
    const parts = r.display_name.split(',').map((s) => s.trim());
    return {
      id: `osm-${r.osm_type}-${r.osm_id}`,
      source: 'online',
      name: r.name || parts[0],
      category: onlineCategory(r),
      type: kindLabel(r.type),
      address: parts.slice(r.name ? 1 : 1, 5).join(', '),
      lat,
      lng,
      bounds: bb ? { south: bb[0], north: bb[1], west: bb[2], east: bb[3] } : null,
      distance: origin ? distanceMeters(origin.lat, origin.lng, lat, lng) : null,
    };
  });
}

export const SEARCH_CATEGORIES = CATEGORIES;
