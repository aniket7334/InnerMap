// GET /tiles/vector/metadata        -> coverage (areas, bounds, zooms, attribution) of the local archives
// GET /tiles/vector/:z/:x/:y.mvt    -> one Mapbox Vector Tile (204 = no data for that tile)
//
// These are public (no JWT) on purpose: map tiles are not user data, and Leaflet must be
// able to show the basemap on the login screen too.
const router = require('express').Router();
const config = require('../config/env');
const pmtiles = require('../services/pmtilesService');
const { areaNames } = require('../services/areaService');
const { asyncHandler } = require('../middleware/errorHandler');

router.get(
  '/metadata',
  asyncHandler(async (_req, res) => {
    const info = await pmtiles.getInfo(config.vectorTilesFile, config.vectorAreasDir, areaNames());
    res.set('Cache-Control', 'no-cache');
    res.json(info);
  })
);

router.get(
  '/:z/:x/:y.mvt',
  asyncHandler(async (req, res) => {
    const z = Number(req.params.z);
    const x = Number(req.params.x);
    const y = Number(req.params.y);
    const n = 2 ** z;
    if (![z, x, y].every(Number.isInteger) || z < 0 || z > 22 || x < 0 || y < 0 || x >= n || y >= n) {
      return res.status(400).json({ message: 'Invalid tile coordinates' });
    }
    const tile = await pmtiles.getTile(config.vectorTilesFile, config.vectorAreasDir, z, x, y);
    // 204 = "valid tile address, but no archive has data there" (outside the extracted areas).
    // Not cached for long: the area may be prepared later.
    if (!tile) return res.status(204).set('Cache-Control', 'no-cache').end();
    res.set({
      'Content-Type': 'application/vnd.mapbox-vector-tile',
      'Cache-Control': 'public, max-age=86400',
    });
    return res.send(tile);
  })
);

module.exports = router;
