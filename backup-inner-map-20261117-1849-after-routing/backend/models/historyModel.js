const { pool } = require('../config/db');

function toDto(row) {
  return {
    id: row.id,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    accuracy: row.accuracy,
    recordedAt: row.recorded_at,
  };
}

async function listByUser(userId, { limit = 500, from, to } = {}) {
  const where = ['user_id = ?'];
  const values = [userId];
  if (from) {
    where.push('recorded_at >= ?');
    values.push(from);
  }
  if (to) {
    where.push('recorded_at <= ?');
    values.push(to);
  }
  // limit is validated as an integer 1-5000 by the controller, so inlining it is safe.
  const [rows] = await pool.execute(
    `SELECT * FROM location_history WHERE ${where.join(' AND ')}
      ORDER BY recorded_at DESC LIMIT ${Number(limit)}`,
    values
  );
  return rows.map(toDto);
}

async function insertMany(userId, points) {
  if (!points.length) return 0;
  const values = points.map((p) => [userId, p.latitude, p.longitude, p.accuracy ?? null, new Date(p.recordedAt)]);
  const [result] = await pool.query(
    'INSERT INTO location_history (user_id, latitude, longitude, accuracy, recorded_at) VALUES ?',
    [values]
  );
  return result.affectedRows;
}

async function removeAll(userId) {
  const [result] = await pool.execute('DELETE FROM location_history WHERE user_id = ?', [userId]);
  return result.affectedRows;
}

module.exports = { listByUser, insertMany, removeAll };
