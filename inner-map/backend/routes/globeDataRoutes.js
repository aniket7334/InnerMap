// Optional local datasets for the 3D globe (served from backend/globe-data):
//   imagery/  XYZ (or TMS) raster tiles + info.json   -> draped on the globe
//   terrain/  Cesium quantized-mesh tiles + layer.json -> real 3D relief
// Neither is required: without them the globe uses Cesium's built-in Natural Earth imagery
// and a smooth ellipsoid. See backend/globe-data/README.md.
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config/env');

const router = express.Router();

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

router.get('/metadata', (_req, res) => {
  const dir = config.globeDataDir;
  const info = readJson(path.join(dir, 'imagery', 'info.json'));
  const imagery =
    info && fs.existsSync(path.join(dir, 'imagery'))
      ? {
          available: true,
          name: String(info.name || 'Local imagery').slice(0, 100),
          attribution: String(info.attribution || '').slice(0, 300),
          format: info.format === 'jpg' || info.format === 'jpeg' ? 'jpg' : 'png',
          scheme: info.scheme === 'tms' ? 'tms' : 'xyz',
          minZoom: Number.isInteger(info.minZoom) ? info.minZoom : 0,
          maxZoom: Number.isInteger(info.maxZoom) ? info.maxZoom : 18,
          bounds: info.bounds || null,
        }
      : { available: false };
  const layer = readJson(path.join(dir, 'terrain', 'layer.json'));
  const terrainInfo = readJson(path.join(dir, 'terrain', 'info.json')) || {};
  const terrain = layer
    ? { available: true, name: terrainInfo.name || 'Local terrain', attribution: terrainInfo.attribution || '' }
    : { available: false };
  res.set('Cache-Control', 'no-cache').json({ imagery, terrain });
});

// Quantized-mesh tiles made by cesium-terrain-builder are stored gzip-compressed on disk.
function setTerrainHeaders(res, filePath) {
  if (!filePath.endsWith('.terrain')) return;
  res.setHeader('Content-Type', 'application/vnd.quantized-mesh');
  try {
    const fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(2);
    fs.readSync(fd, head, 0, 2, 0);
    fs.closeSync(fd);
    if (head[0] === 0x1f && head[1] === 0x8b) res.setHeader('Content-Encoding', 'gzip');
  } catch {
    /* ignore */
  }
}

const staticOpts = { maxAge: '30d', fallthrough: false, index: false, dotfiles: 'deny' };
router.use('/imagery', (req, res, next) => express.static(path.join(config.globeDataDir, 'imagery'), staticOpts)(req, res, next));
router.use('/terrain', (req, res, next) =>
  express.static(path.join(config.globeDataDir, 'terrain'), { ...staticOpts, setHeaders: setTerrainHeaders })(req, res, next)
);
router.use((err, _req, res, next) => (err.status === 404 ? res.status(404).end() : next(err)));

module.exports = router;
