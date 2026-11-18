// Small geographic helpers.

/** Great-circle distance in metres (haversine). */
export function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function formatCoord(value, digits = 6) {
  return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '-';
}

export function formatLatLng(lat, lng, digits = 6) {
  if (typeof lat !== 'number' || typeof lng !== 'number') return '-';
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(digits)}° ${ns}, ${Math.abs(lng).toFixed(digits)}° ${ew}`;
}

export function formatDistance(m) {
  if (typeof m !== 'number' || !Number.isFinite(m)) return '-';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
}

/** Length of a [lon, lat] path in metres. */
export function lineLengthMeters(coords) {
  let total = 0;
  for (let i = 1; i < coords.length; i += 1) {
    total += distanceMeters(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]);
  }
  return total;
}

/** Area of a closed [lon, lat] ring in m² (spherical excess approximation, good for maps). */
export function ringAreaM2(ring) {
  const R = 6371008.8;
  const rad = (d) => (d * Math.PI) / 180;
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    sum += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)));
  }
  return Math.abs((sum * R * R) / 2);
}

/** Polygon area (outer ring minus holes) in m². */
export function polygonAreaM2(rings) {
  return rings.reduce((a, ring, i) => a + (i === 0 ? 1 : -1) * ringAreaM2(ring), 0);
}

export function formatArea(m2) {
  if (typeof m2 !== 'number' || !Number.isFinite(m2)) return '-';
  if (m2 < 10000) return `${Math.round(m2)} m²`;
  if (m2 < 1e6) return `${(m2 / 10000).toFixed(2)} ha`;
  return `${(m2 / 1e6).toFixed(m2 < 1e7 ? 2 : 1)} km²`;
}

/** Short measurement text for any GeoJSON geometry. */
export function describeGeometry(g) {
  switch (g?.type) {
    case 'Point':
      return `${formatCoord(g.coordinates[1], 5)}, ${formatCoord(g.coordinates[0], 5)}`;
    case 'MultiPoint':
      return `${g.coordinates.length} points`;
    case 'LineString':
      return `Length ${formatDistance(lineLengthMeters(g.coordinates))}`;
    case 'MultiLineString':
      return `Length ${formatDistance(g.coordinates.reduce((s, l) => s + lineLengthMeters(l), 0))}`;
    case 'Polygon':
      return `Area ${formatArea(polygonAreaM2(g.coordinates))}`;
    case 'MultiPolygon':
      return `Area ${formatArea(g.coordinates.reduce((s, p) => s + polygonAreaM2(p), 0))}`;
    default:
      return '';
  }
}

// Default view used before we know where the user is: the whole world.
export const WORLD_VIEW = { center: [20, 0], zoom: 2 };
