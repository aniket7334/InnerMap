// Data for the Earth page's Explore panel (all online, nothing invented):
//  - weather for the place in view: Open-Meteo (free, no key; CC BY 4.0 - credited on the card)
//  - "Search this area": OpenStreetMap places of a kind inside the view (Nominatim, bounded box,
//    at most 1 request per second - the same geocoder and policy as the app's search)
//  - the nearest named city to a point, from the world names the Earth page already has loaded
const GEOCODER_URL = import.meta.env.VITE_GEOCODER_URL || 'https://nominatim.openstreetmap.org/search';
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast';
let lastNominatim = 0;

// ---------------------------------------------------------------- nearest city (offline)
/** Nearest city in the world-names data: { name, lat, lng, km } or null. */
export function nearestCity(worldNames, lat, lng, maxKm = 400, maxRank = 99) {
  if (!worldNames?.cities) return null;
  let best = null;
  const cosLat = Math.cos((lat * Math.PI) / 180);
  for (const [name, clng, clat, rank] of worldNames.cities) {
    if (rank > maxRank) continue;
    const dx = (clng - lng) * cosLat;
    const dy = clat - lat;
    // prefer bigger cities a little: rank 0 (megacity) counts as closer than rank 8
    const d = Math.sqrt(dx * dx + dy * dy) * (1 + rank * 0.04);
    if (!best || d < best.d) best = { name, lat: clat, lng: clng, d };
  }
  if (!best) return null;
  const km = best.d * 111;
  return km <= maxKm ? { name: best.name, lat: best.lat, lng: best.lng, km } : null;
}

// ---------------------------------------------------------------- weather (Open-Meteo)
// WMO weather codes -> text and icon
const WMO = [
  [[0], 'Clear sky', 'sun'],
  [[1], 'Mainly clear', 'sun'],
  [[2], 'Partly cloudy', 'cloudSun'],
  [[3], 'Overcast', 'cloud'],
  [[45, 48], 'Fog', 'fog'],
  [[51, 53, 55, 56, 57], 'Drizzle', 'rain'],
  [[61, 63, 65, 66, 67], 'Rain', 'rain'],
  [[71, 73, 75, 77], 'Snow', 'snow'],
  [[80, 81, 82], 'Rain showers', 'rain'],
  [[85, 86], 'Snow showers', 'snow'],
  [[95, 96, 99], 'Thunderstorm', 'storm'],
];
export function describeWeather(code, isDay) {
  const hit = WMO.find(([codes]) => codes.includes(code));
  const [, text, icon] = hit || [null, 'Weather', 'cloud'];
  return { text, icon: !isDay && (icon === 'sun' || icon === 'cloudSun') ? (icon === 'sun' ? 'moon' : 'cloudMoon') : icon, kind: icon };
}

const weatherCache = new Map(); // key -> { at, promise }
/** Current weather and today's range at a point. */
export function fetchWeather(lat, lng) {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.at < 10 * 60 * 1000) return hit.promise;
  const params = new URLSearchParams({
    latitude: lat.toFixed(3),
    longitude: lng.toFixed(3),
    current: 'temperature_2m,apparent_temperature,weather_code,is_day,relative_humidity_2m,wind_speed_10m',
    daily: 'temperature_2m_max,temperature_2m_min',
    timezone: 'auto',
    forecast_days: '1',
  });
  const promise = fetch(`${WEATHER_URL}?${params}`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Weather service answered ${r.status}`))))
    .then((d) => {
      const c = d.current;
      return {
        temp: c.temperature_2m,
        feels: c.apparent_temperature,
        code: c.weather_code,
        isDay: c.is_day === 1,
        humidity: c.relative_humidity_2m,
        wind: c.wind_speed_10m,
        max: d.daily?.temperature_2m_max?.[0],
        min: d.daily?.temperature_2m_min?.[0],
        units: { temp: d.current_units?.temperature_2m || '°C', wind: d.current_units?.wind_speed_10m || 'km/h' },
      };
    })
    .catch((err) => {
      weatherCache.delete(key);
      throw err;
    });
  weatherCache.set(key, { at: Date.now(), promise });
  return promise;
}

// ---------------------------------------------------------------- search this area (Nominatim)
export const AREA_CATEGORIES = [
  { id: 'food', label: 'Food', icon: 'food', color: '#e8453c', q: 'restaurant' },
  { id: 'hotels', label: 'Hotels', icon: 'bed', color: '#8e5cf7', q: 'hotel' },
  { id: 'bars', label: 'Bars', icon: 'glass', color: '#2e9d5b', q: 'bar' },
  { id: 'coffee', label: 'Coffee', icon: 'coffee', color: '#1a73e8', q: 'cafe' },
  { id: 'fuel', label: 'Petrol', icon: 'fuel', color: '#00a3bf', q: 'fuel' },
  { id: 'hospitals', label: 'Hospitals', icon: 'medical', color: '#d81b60', q: 'hospital' },
  { id: 'shops', label: 'Shops', icon: 'bag', color: '#ef6c00', q: 'shop' },
  { id: 'more', label: 'All places', icon: 'dots', color: '#13a89e' },
];
export const MORE_CATEGORIES = [
  { id: 'atm', label: 'ATMs', icon: 'atm', color: '#2e7d32', q: 'atm' },
  { id: 'banks', label: 'Banks', icon: 'atm', color: '#546e7a', q: 'bank' },
  { id: 'pharmacy', label: 'Pharmacies', icon: 'medical', color: '#c2185b', q: 'pharmacy' },
  { id: 'grocery', label: 'Grocery', icon: 'cart', color: '#7cb342', q: 'supermarket' },
  { id: 'parks', label: 'Parks', icon: 'tree', color: '#2e7d32', q: 'park' },
  { id: 'museums', label: 'Museums', icon: 'landmark', color: '#b8860b', q: 'museum' },
  { id: 'worship', label: 'Temples', icon: 'landmark', color: '#8e5cf7', q: 'temple' },
  { id: 'transit', label: 'Stations', icon: 'train', color: '#1a73e8', q: 'railway station' },
  { id: 'schools', label: 'Schools', icon: 'school', color: '#5c6bc0', q: 'school' },
  { id: 'colleges', label: 'Colleges', icon: 'school', color: '#3949ab', q: 'college' },
  { id: 'police', label: 'Police', icon: 'shield', color: '#455a64', q: 'police' },
  { id: 'parking', label: 'Parking', icon: 'car', color: '#1565c0', q: 'parking' },
];

const distanceKm = (a, b) => {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/**
 * Places of a kind in the view. box: { west, south, east, north } (clamped to ~1° around centre).
 * -> [{ id, name, type, address, lat, lng, km }] nearest to the centre first.
 */
export async function searchArea(cat, box, center) {
  if (!navigator.onLine) throw new Error('Searching the area needs an internet connection.');
  const half = 0.5;
  const w = Math.max(box.west, center.lng - half);
  const e = Math.min(box.east, center.lng + half);
  const s = Math.max(box.south, center.lat - half);
  const n = Math.min(box.north, center.lat + half);
  const wait = 1100 - (Date.now() - lastNominatim);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const params = new URLSearchParams({ q: cat.q, format: 'jsonv2', limit: '20', addressdetails: '1', viewbox: `${w},${n},${e},${s}`, bounded: '1' });
  const res = await fetch(`${GEOCODER_URL}?${params}`, { headers: { Accept: 'application/json' } });
  if (res.status === 429) throw new Error('The search service is busy. Try again in a minute.');
  if (!res.ok) throw new Error(`Search failed (HTTP ${res.status}).`);
  const data = await res.json();
  return data
    .map((r) => {
      const lat = Number(r.lat);
      const lng = Number(r.lon);
      const a = r.address || {};
      const parts = r.display_name.split(',').map((x) => x.trim());
      return {
        id: `${r.osm_type}-${r.osm_id}`,
        name: r.name || parts[0],
        type: (r.type || '').replace(/_/g, ' '),
        address: [a.road, a.suburb || a.neighbourhood, a.city || a.town || a.village].filter(Boolean).slice(0, 2).join(', ') || parts.slice(1, 3).join(', '),
        lat,
        lng,
        km: distanceKm(center, { lat, lng }),
      };
    })
    .filter((r) => r.name)
    .sort((a, b) => a.km - b.km);
}

export const formatKm = (km) => (km < 1 ? `${Math.round(km * 1000)} m` : km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`);
