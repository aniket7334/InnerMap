const Location = require('../models/locationModel');
const { HttpError } = require('../middleware/errorHandler');

async function list(req, res) {
  res.json({ locations: await Location.listByUser(req.user.id) });
}

async function create(req, res) {
  const location = await Location.create(req.user.id, {
    name: req.body.name.trim(),
    latitude: req.body.latitude,
    longitude: req.body.longitude,
  });
  res.status(201).json({ location });
}

async function update(req, res) {
  const { name, latitude, longitude } = req.body;
  if (name === undefined && latitude === undefined && longitude === undefined) {
    throw new HttpError(400, 'Nothing to update');
  }
  const location = await Location.update(req.params.id, req.user.id, {
    name: name !== undefined ? name.trim() : undefined,
    latitude,
    longitude,
  });
  // Not found OR owned by someone else -> 404 (do not reveal which).
  if (!location) throw new HttpError(404, 'Location not found');
  res.json({ location });
}

async function remove(req, res) {
  const removed = await Location.remove(req.params.id, req.user.id);
  if (!removed) throw new HttpError(404, 'Location not found');
  res.status(204).end();
}

module.exports = { list, create, update, remove };
