// GET /api/routing/info                 online provider + offline routing data available here
// GET /api/routing/route?profile=car&from=lat,lng&to=lat,lng   online route (via the provider)
// GET /api/routing/graph?south=&west=&north=&east=             road graph for offline routing (gzip JSON)
// GET /api/routing/areas                road data of each map area (ready / building / missing)
// POST /api/routing/areas/:id/build     build the road data of a map area now
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const routing = require('../services/routingService');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler, HttpError } = require('../middleware/errorHandler');

router.use(requireAuth);

function parsePoint(v, label) {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(String(v || ''));
  if (!m) throw new HttpError(400, `${label} must be "lat,lng"`);
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new HttpError(400, `${label} is out of range`);
  return { lat, lng };
}

// Protect the shared online provider: at most 30 route requests per user per minute.
const routeLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  keyGenerator: (req) => `u${req.user.id}`,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { message: 'Too many route requests. Wait a minute and try again.' },
});

router.get('/areas', (_req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ areas: require('../services/roadDataService').list() });
});

router.post('/areas/:id/build', (req, res) => {
  const out = require('../services/roadDataService').requestBuild(String(req.params.id), { manual: true });
  if (out.error) return res.status(out.status || 400).json({ message: out.error });
  return res.status(202).json(out);
});

router.get('/info', (_req, res) => {
  res.json({ online: routing.onlineInfo(), offline: routing.graphInfo() });
});

router.get(
  '/route',
  routeLimiter,
  asyncHandler(async (req, res) => {
    const from = parsePoint(req.query.from, 'from');
    const to = parsePoint(req.query.to, 'to');
    const profile = String(req.query.profile || 'car');
    res.json({ route: await routing.onlineRoute(profile, from, to) });
  })
);

router.get(
  '/graph',
  asyncHandler(async (req, res) => {
    const b = ['south', 'west', 'north', 'east'].map((k) => Number(req.query[k]));
    if (b.some((v) => !Number.isFinite(v))) throw new HttpError(400, 'south, west, north and east are required');
    const [south, west, north, east] = b;
    if (south >= north || west >= east) throw new HttpError(400, 'Invalid bounds');
    if ((north - south) * (east - west) > 4) throw new HttpError(400, 'Area too large for one download');
    const sub = await routing.graphSubsetGz({ south, west, north, east });
    res.set({
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Cache-Control': 'private, max-age=3600',
      'X-Road-Segments': String(sub.edges),
    });
    res.send(sub.gz);
  })
);

module.exports = router;
