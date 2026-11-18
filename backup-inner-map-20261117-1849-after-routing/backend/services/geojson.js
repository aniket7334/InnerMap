// Server-side validation of geographical features sent by the app.
// Geometry is GeoJSON in WGS84 ([longitude, latitude] or [lon, lat, altitude]).
const { HttpError } = require('../middleware/errorHandler');

const TYPES = ['Point', 'LineString', 'Polygon', 'MultiPoint', 'MultiLineString', 'MultiPolygon'];
const MAX_VERTICES = 100000; // per feature
const MAX_NAME = 255;
const MAX_DESCRIPTION = 5000;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function checkPosition(p) {
  if (!Array.isArray(p) || p.length < 2 || p.length > 3) return 'a position must be [lon, lat] or [lon, lat, alt]';
  const [lon, lat, alt] = p;
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) return 'longitude out of range';
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) return 'latitude out of range';
  if (alt !== undefined && (typeof alt !== 'number' || !Number.isFinite(alt))) return 'altitude must be a number';
  return null;
}

/** Walks nested coordinate arrays to `depth`, checking positions; returns [error, vertexCount]. */
function walk(coords, depth, minLen) {
  if (depth === 0) return [checkPosition(coords), 1];
  if (!Array.isArray(coords)) return ['coordinates must be arrays', 0];
  if (depth === 1 && coords.length < minLen) return [`needs at least ${minLen} positions`, 0];
  let count = 0;
  for (const c of coords) {
    const [err, n] = walk(c, depth - 1, minLen);
    if (err) return [err, 0];
    count += n;
    if (count > MAX_VERTICES) return [`more than ${MAX_VERTICES} vertices`, 0];
  }
  return [null, count];
}

function checkGeometry(g) {
  if (!g || typeof g !== 'object' || !TYPES.includes(g.type)) {
    return `geometry type must be one of ${TYPES.join(', ')}`;
  }
  const spec = {
    Point: [0, 1],
    MultiPoint: [1, 1],
    LineString: [1, 2],
    MultiLineString: [2, 2],
    Polygon: [2, 4],
    MultiPolygon: [3, 4],
  }[g.type];
  const [err] = walk(g.coordinates, spec[0], spec[1]);
  return err ? `${g.type}: ${err}` : null;
}

function cleanStyle(s) {
  if (!s || typeof s !== 'object') return null;
  const out = {};
  if (COLOR_RE.test(s.stroke || '')) out.stroke = s.stroke;
  if (COLOR_RE.test(s.fill || '')) out.fill = s.fill;
  if (COLOR_RE.test(s.markerColor || '')) out.markerColor = s.markerColor;
  const num = (v, lo, hi) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  const sw = num(s.strokeWidth, 0, 50);
  const so = num(s.strokeOpacity, 0, 1);
  const fo = num(s.fillOpacity, 0, 1);
  if (sw !== undefined) out.strokeWidth = sw;
  if (so !== undefined) out.strokeOpacity = so;
  if (fo !== undefined) out.fillOpacity = fo;
  return Object.keys(out).length ? out : null;
}

/** Validate + normalise one feature; throws HttpError(400) with the feature index. */
function normalizeFeature(f, index = 0) {
  if (!f || typeof f !== 'object') throw new HttpError(400, `Feature ${index}: must be an object`);
  const err = checkGeometry(f.geometry);
  if (err) throw new HttpError(400, `Feature ${index}: ${err}`);
  const name = typeof f.name === 'string' ? f.name.trim().slice(0, MAX_NAME) : null;
  const description = typeof f.description === 'string' ? f.description.trim().slice(0, MAX_DESCRIPTION) : null;
  return {
    name: name || null,
    description: description || null,
    geometryType: f.geometry.type,
    geometry: { type: f.geometry.type, coordinates: f.geometry.coordinates },
    style: cleanStyle(f.style),
  };
}

function normalizeFeatures(list, max) {
  if (!Array.isArray(list)) throw new HttpError(400, 'features must be an array');
  if (list.length > max) throw new HttpError(400, `At most ${max} features per request`);
  return list.map((f, i) => normalizeFeature(f, i));
}

module.exports = { normalizeFeature, normalizeFeatures, checkGeometry, cleanStyle, TYPES };
