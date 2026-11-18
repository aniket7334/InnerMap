// Web-Mercator ("slippy map") tile maths used by every XYZ tile server.
// https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames

const MAX_LAT = 85.05112878;

const clampLat = (lat) => Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));

export function lon2tile(lon, z) {
  const n = 2 ** z;
  return Math.min(n - 1, Math.max(0, Math.floor(((lon + 180) / 360) * n)));
}

export function lat2tile(lat, z) {
  const n = 2 ** z;
  const rad = (clampLat(lat) * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
  return Math.min(n - 1, Math.max(0, y));
}

/** Inclusive tile index range covering bounds at zoom z. */
export function tileRange(bounds, z) {
  return {
    z,
    xMin: lon2tile(bounds.west, z),
    xMax: lon2tile(bounds.east, z),
    // Tile y grows southwards, so north gives the smaller index.
    yMin: lat2tile(bounds.north, z),
    yMax: lat2tile(bounds.south, z),
  };
}

export function countTiles(bounds, zoomMin, zoomMax) {
  let total = 0;
  for (let z = zoomMin; z <= zoomMax; z += 1) {
    const r = tileRange(bounds, z);
    total += (r.xMax - r.xMin + 1) * (r.yMax - r.yMin + 1);
  }
  return total;
}

/** Lazily yields every {z,x,y} inside bounds for the zoom range (low zooms first). */
export function* iterateTiles(bounds, zoomMin, zoomMax) {
  for (let z = zoomMin; z <= zoomMax; z += 1) {
    const r = tileRange(bounds, z);
    for (let x = r.xMin; x <= r.xMax; x += 1) {
      for (let y = r.yMin; y <= r.yMax; y += 1) yield { z, x, y };
    }
  }
}

export function tileKey(layerId, z, x, y) {
  return `${layerId}/${z}/${x}/${y}`;
}

/** Normalise a Leaflet LatLngBounds (or plain object) into {south, west, north, east}. */
export function toBoundsObject(b) {
  if (typeof b.getSouth === 'function') {
    return {
      south: Math.max(-MAX_LAT, b.getSouth()),
      west: Math.max(-180, b.getWest()),
      north: Math.min(MAX_LAT, b.getNorth()),
      east: Math.min(180, b.getEast()),
    };
  }
  return { south: b.south, west: b.west, north: b.north, east: b.east };
}

/** Square bounds of radiusKm around a point. */
export function boundsAround(lat, lng, radiusKm) {
  const dLat = radiusKm / 110.574;
  const dLng = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180) || 1e-6);
  return {
    south: Math.max(-MAX_LAT, lat - dLat),
    north: Math.min(MAX_LAT, lat + dLat),
    west: Math.max(-180, lng - dLng),
    east: Math.min(180, lng + dLng),
  };
}

/** Rough area of bounds in km² (for display). */
export function boundsAreaKm2(b) {
  const midLat = ((b.north + b.south) / 2) * (Math.PI / 180);
  return Math.abs((b.north - b.south) * 110.574 * (b.east - b.west) * 111.32 * Math.cos(midLat));
}

export function boundsIntersect(a, b) {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}

/** Overlap of two bounds, or null if they do not overlap. */
export function boundsIntersection(a, b) {
  if (!boundsIntersect(a, b)) return null;
  return {
    south: Math.max(a.south, b.south),
    west: Math.max(a.west, b.west),
    north: Math.min(a.north, b.north),
    east: Math.min(a.east, b.east),
  };
}

export function boundsContains(b, lat, lng) {
  return lat >= b.south && lat <= b.north && lng >= b.west && lng <= b.east;
}
