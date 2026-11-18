// Small, dependency-free request validators. Each rule returns an error string or null.
const { HttpError } = require('./errorHandler');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STATUSES = ['pending', 'downloading', 'completed', 'partial', 'failed', 'cancelled'];

const rules = {
  name: (v) =>
    typeof v === 'string' && v.trim().length >= 2 && v.trim().length <= 100 ? null : 'Name must be 2-100 characters',
  email: (v) =>
    typeof v === 'string' && v.length <= 191 && EMAIL_RE.test(v.trim()) ? null : 'A valid email is required',
  password: (v) =>
    typeof v === 'string' && v.length >= 8 && v.length <= 72 ? null : 'Password must be 8-72 characters',
  requiredString: (v) => (typeof v === 'string' && v.length > 0 ? null : 'This field is required'),
  boolean: (v) => (typeof v === 'boolean' ? null : 'Must be true or false'),
  locationName: (v) =>
    typeof v === 'string' && v.trim().length >= 1 && v.trim().length <= 100
      ? null
      : 'Location name must be 1-100 characters',
  latitude: (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= -90 && v <= 90 ? null : 'Latitude must be between -90 and 90',
  longitude: (v) =>
    typeof v === 'number' && Number.isFinite(v) && v >= -180 && v <= 180
      ? null
      : 'Longitude must be between -180 and 180',
  zoom: (v) => (Number.isInteger(v) && v >= 0 && v <= 22 ? null : 'Zoom must be an integer 0-22'),
  bytes: (v) => (Number.isInteger(v) && v >= 0 ? null : 'Must be a non-negative integer'),
  downloadStatus: (v) => (STATUSES.includes(v) ? null : 'Invalid download status'),
  providerId: (v) =>
    typeof v === 'string' && /^[a-z0-9-]{2,50}$/.test(v) ? null : 'Map provider must be a short lowercase id',
  bounds: (v) => {
    if (!v || typeof v !== 'object') return 'Region bounds are required';
    const { south, west, north, east } = v;
    if (![south, west, north, east].every((n) => typeof n === 'number' && Number.isFinite(n))) {
      return 'Region bounds must contain numeric south, west, north, east';
    }
    if (south < -90 || north > 90 || south >= north) return 'Invalid latitude bounds';
    if (west < -180 || east > 180 || west >= east) return 'Invalid longitude bounds';
    return null;
  },
};

/**
 * Middleware factory: validates req.body against
 *   { field: 'ruleName' }  or  { field: ['ruleName', { optional: true }] }
 */
function validateBody(schema) {
  return (req, _res, next) => {
    const body = req.body || {};
    const errors = {};
    for (const [field, spec] of Object.entries(schema)) {
      const [ruleName, opts = {}] = Array.isArray(spec) ? spec : [spec];
      const value = body[field];
      if ((value === undefined || value === null) && opts.optional) continue;
      const msg = rules[ruleName](value);
      if (msg) errors[field] = msg;
    }
    if (Object.keys(errors).length) return next(new HttpError(400, 'Validation failed', errors));
    return next();
  };
}

function parseIdParam(req, _res, next) {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return next(new HttpError(400, 'Invalid id'));
  req.params.id = id;
  return next();
}

module.exports = { validateBody, parseIdParam, rules };
