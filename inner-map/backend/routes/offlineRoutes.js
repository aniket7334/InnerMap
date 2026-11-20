// What this server offers for offline use, in one small answer - read by the app's Offline
// mode screen while online (and remembered on the device) to show which downloaded maps have
// newer data on the server, and whether offline directions can be downloaded.
//
// GET /api/offline/manifest -> {
//   generatedAt,
//   maps:    { available, areas: [{ id, name, bounds, maxZoom, bytes, updatedAt }] },
//   routing: { available, name, bounds, builtAt, roadSegments, bytes },
//   globe:   { imagery, terrain }   local 3D-globe datasets (true / false)
// }
// Public, like /tiles/vector/metadata: map coverage is not user data.
const fs = require('fs');
const path = require('path');
const router = require('express').Router();
const config = require('../config/env');
const pmtiles = require('../services/pmtilesService');
const routing = require('../services/routingService');
const { areaNames } = require('../services/areaService');
const { asyncHandler } = require('../middleware/errorHandler');

router.get(
  '/manifest',
  asyncHandler(async (_req, res) => {
    const info = await pmtiles.getInfo(config.vectorTilesFile, config.vectorAreasDir, areaNames()).catch(() => ({ available: false, areas: [] }));
    let graph = { available: false };
    try {
      graph = routing.graphInfo();
    } catch {
      /* no routing data on this server */
    }
    const exists = (p) => fs.existsSync(path.join(config.globeDataDir, p));
    res.set('Cache-Control', 'no-cache');
    res.json({
      generatedAt: new Date().toISOString(),
      maps: {
        available: Boolean(info.available !== false && info.areas?.length),
        areas: (info.areas || []).map((a) => ({ id: a.id, name: a.name, bounds: a.bounds, maxZoom: a.maxZoom, bytes: a.bytes, updatedAt: a.updatedAt || null })),
      },
      routing: graph.available
        ? { available: true, name: graph.name, bounds: graph.bounds, builtAt: graph.builtAt || null, roadSegments: graph.roadSegments, bytes: graph.compressedBytes }
        : { available: false },
      globe: { imagery: exists('imagery/info.json'), terrain: exists('terrain/layer.json') },
    });
  })
);

module.exports = router;
