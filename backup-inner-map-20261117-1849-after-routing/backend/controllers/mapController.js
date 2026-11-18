// Stores METADATA about map areas a user downloaded on a device.
// The tile images themselves stay in the browser (IndexedDB) and never reach MySQL.
const MapRecord = require('../models/mapModel');
const { HttpError } = require('../middleware/errorHandler');

async function list(req, res) {
  res.json({ maps: await MapRecord.listByUser(req.user.id) });
}

async function create(req, res) {
  const { mapName, region, zoomMin, zoomMax, storageSize, downloadStatus } = req.body;
  if (zoomMin > zoomMax) throw new HttpError(400, 'zoomMin must be <= zoomMax');
  const map = await MapRecord.create(req.user.id, {
    mapName: mapName.trim(),
    region: { south: region.south, west: region.west, north: region.north, east: region.east },
    zoomMin,
    zoomMax,
    storageSize: storageSize ?? 0,
    downloadStatus: downloadStatus ?? 'completed',
  });
  res.status(201).json({ map });
}

async function remove(req, res) {
  const removed = await MapRecord.remove(req.params.id, req.user.id);
  if (!removed) throw new HttpError(404, 'Map not found');
  res.status(204).end();
}

module.exports = { list, create, remove };
