// Place search for choosing a city/region to download.
import { isOnline } from '../offline/connectivity';
// Nominatim usage policy: max 1 request per second, no autocomplete, attribution.
// We only search when the user submits the form, and throttle to 1 req/s.
const GEOCODER_URL = import.meta.env.VITE_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
let lastRequest = 0;

export async function searchPlaces(query) {
  const q = query.trim();
  if (!q) return [];
  if (!isOnline()) throw new Error('Place search needs an internet connection (or offline mode is on).');

  const wait = 1100 - (Date.now() - lastRequest);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequest = Date.now();

  const params = new URLSearchParams({ q, format: 'jsonv2', limit: '6', addressdetails: '0' });
  const res = await fetch(`${GEOCODER_URL}?${params}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Place search failed (HTTP ${res.status}).`);
  const results = await res.json();

  return results
    .filter((r) => Array.isArray(r.boundingbox))
    .map((r) => {
      const [south, north, west, east] = r.boundingbox.map(Number);
      return {
        id: r.place_id,
        name: r.display_name,
        type: r.type,
        lat: Number(r.lat),
        lng: Number(r.lon),
        bounds: { south, north, west, east },
      };
    });
}
