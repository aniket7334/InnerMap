// Offline map areas for more cities.
// GET  /api/map-areas          -> { areas, jobs }   areas the server has map data for
// POST /api/map-areas          -> { job } | { existing }   prepare map data for { name, bounds }
// GET  /api/map-areas/jobs/:id -> { job }           progress of a preparation
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const areas = require('../services/areaService');

// Each preparation downloads a city's map data once: a few per user per hour is plenty.
const prepareLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: (req) => `u${req.user?.id}`,
  message: { message: 'Too many map areas requested. Please try again later.' },
});

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.json(await areas.listAreas());
  })
);

router.post(
  '/',
  requireAuth,
  prepareLimiter,
  asyncHandler(async (req, res) => {
    const out = await areas.requestArea({ name: req.body?.name, bounds: req.body?.bounds, userId: req.user.id });
    if (out.error) return res.status(out.status || 400).json({ message: out.error });
    if (out.existing) return res.json({ existing: out.existing });
    return res.status(202).json({ job: out.job });
  })
);

router.get(
  '/jobs/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const job = areas.getJob(req.params.id);
    if (!job) return res.status(404).json({ message: 'Unknown job (the server may have restarted).' });
    res.set('Cache-Control', 'no-store');
    return res.json({ job });
  })
);

module.exports = router;
