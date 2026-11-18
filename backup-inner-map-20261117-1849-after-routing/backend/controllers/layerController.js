// Feature layers: one per imported KML/KMZ/GeoJSON file, plus the user's "My drawings".
const Layer = require('../models/layerModel');
const Feature = require('../models/featureModel');
const { normalizeFeatures, normalizeFeature } = require('../services/geojson');
const { HttpError } = require('../middleware/errorHandler');

const MAX_FEATURES_PER_REQUEST = 1000;

async function list(req, res) {
  res.json({ layers: await Layer.listByUser(req.user.id) });
}

async function create(req, res) {
  const { name, source = 'imported', fileName } = req.body;
  if (!['imported', 'drawn'].includes(source)) throw new HttpError(400, 'source must be imported or drawn');
  const features = normalizeFeatures(req.body.features || [], MAX_FEATURES_PER_REQUEST);
  const { layerId, featureIds } = await Feature.createLayerWithFeatures(
    req.user.id,
    {
      name: name.trim().slice(0, 150),
      source,
      fileName: typeof fileName === 'string' ? fileName.slice(0, 255) : null,
    },
    features
  );
  res.status(201).json({ layer: await Layer.findOwned(layerId, req.user.id), featureIds });
}

async function rename(req, res) {
  const ok = await Layer.rename(req.params.id, req.user.id, req.body.name.trim().slice(0, 150));
  if (!ok) throw new HttpError(404, 'Layer not found');
  res.json({ layer: await Layer.findOwned(req.params.id, req.user.id) });
}

async function remove(req, res) {
  const ok = await Layer.remove(req.params.id, req.user.id);
  if (!ok) throw new HttpError(404, 'Layer not found');
  res.status(204).end();
}

async function listFeatures(req, res) {
  const layer = await Layer.findOwned(req.params.id, req.user.id);
  if (!layer) throw new HttpError(404, 'Layer not found');
  res.json({ layer, features: await Feature.listByLayer(req.params.id, req.user.id) });
}

async function addFeatures(req, res) {
  const layer = await Layer.findOwned(req.params.id, req.user.id);
  if (!layer) throw new HttpError(404, 'Layer not found');
  const features = normalizeFeatures(req.body.features, MAX_FEATURES_PER_REQUEST);
  const featureIds = await Feature.appendToLayer(req.user.id, layer.id, features);
  res.status(201).json({ featureIds });
}

async function updateFeature(req, res) {
  const body = req.body || {};
  const patch = {};
  if (body.geometry !== undefined) {
    const n = normalizeFeature({ geometry: body.geometry });
    patch.geometry = n.geometry;
  }
  if (body.name !== undefined || body.description !== undefined || body.style !== undefined) {
    // Re-use the normaliser for text/style limits (with a dummy point geometry).
    const n = normalizeFeature({ ...body, geometry: { type: 'Point', coordinates: [0, 0] } });
    if (body.name !== undefined) patch.name = n.name;
    if (body.description !== undefined) patch.description = n.description;
    if (body.style !== undefined) patch.style = n.style;
  }
  if (!Object.keys(patch).length) throw new HttpError(400, 'Nothing to update');
  const feature = await Feature.update(req.params.id, req.user.id, patch);
  if (!feature) throw new HttpError(404, 'Feature not found');
  res.json({ feature });
}

async function removeFeature(req, res) {
  const ok = await Feature.remove(req.params.id, req.user.id);
  if (!ok) throw new HttpError(404, 'Feature not found');
  res.status(204).end();
}

module.exports = { list, create, rename, remove, listFeatures, addFeatures, updateFeature, removeFeature };
