const Preference = require('../models/preferenceModel');
const { HttpError } = require('../middleware/errorHandler');

async function get(req, res) {
  res.json({ preferences: await Preference.get(req.user.id) });
}

async function update(req, res) {
  const { mapProvider, defaultLat, defaultLng, defaultZoom, showDownloadedAreas } = req.body;
  const fields = {};
  if (mapProvider !== undefined) fields.mapProvider = mapProvider;
  if (showDownloadedAreas !== undefined) fields.showDownloadedAreas = showDownloadedAreas;
  // The default view is all-or-nothing: either a full lat/lng/zoom or cleared with nulls.
  if (defaultLat !== undefined || defaultLng !== undefined || defaultZoom !== undefined) {
    const parts = [defaultLat, defaultLng, defaultZoom];
    const allNull = parts.every((v) => v === null);
    const allSet = parts.every((v) => v !== null && v !== undefined);
    if (!allNull && !allSet) throw new HttpError(400, 'defaultLat, defaultLng and defaultZoom must be sent together');
    Object.assign(fields, { defaultLat, defaultLng, defaultZoom });
  }
  if (!Object.keys(fields).length) throw new HttpError(400, 'Nothing to update');
  res.json({ preferences: await Preference.upsert(req.user.id, fields) });
}

module.exports = { get, update };
