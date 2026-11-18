const History = require('../models/historyModel');
const User = require('../models/userModel');
const { HttpError } = require('../middleware/errorHandler');
const { rules } = require('../middleware/validate');

const MAX_BATCH = 500;

async function list(req, res) {
  const limit = req.query.limit === undefined ? 500 : Number(req.query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 5000) throw new HttpError(400, 'limit must be 1-5000');
  const from = req.query.from ? new Date(req.query.from) : undefined;
  const to = req.query.to ? new Date(req.query.to) : undefined;
  if ((from && Number.isNaN(from.getTime())) || (to && Number.isNaN(to.getTime()))) {
    throw new HttpError(400, 'from/to must be ISO dates');
  }
  res.json({ history: await History.listByUser(req.user.id, { limit, from, to }) });
}

// Accepts either a single point { latitude, longitude, accuracy?, recordedAt? }
// or a batch { points: [ ... ] } (used when syncing points recorded offline).
async function record(req, res) {
  const user = await User.findById(req.user.id);
  if (!user || !user.locationHistoryEnabled) {
    throw new HttpError(403, 'Location history is turned off. Enable it in your profile first.');
  }

  const raw = Array.isArray(req.body.points) ? req.body.points : [req.body];
  if (!raw.length) throw new HttpError(400, 'No points supplied');
  if (raw.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} points per request`);

  const now = Date.now();
  const points = raw.map((p, i) => {
    const err = rules.latitude(p.latitude) || rules.longitude(p.longitude);
    if (err) throw new HttpError(400, `Point ${i}: ${err}`);
    const recordedAt = p.recordedAt ? Date.parse(p.recordedAt) : now;
    if (Number.isNaN(recordedAt) || recordedAt > now + 5 * 60 * 1000) {
      throw new HttpError(400, `Point ${i}: invalid recordedAt`);
    }
    const accuracy = typeof p.accuracy === 'number' && Number.isFinite(p.accuracy) ? p.accuracy : null;
    return { latitude: p.latitude, longitude: p.longitude, accuracy, recordedAt };
  });

  const inserted = await History.insertMany(req.user.id, points);
  res.status(201).json({ inserted });
}

async function clear(req, res) {
  const deleted = await History.removeAll(req.user.id);
  res.json({ deleted });
}

module.exports = { list, record, clear };
