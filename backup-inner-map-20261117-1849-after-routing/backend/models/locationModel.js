const { pool } = require('../config/db');

function toDto(row) {
  return {
    id: row.id,
    name: row.location_name,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    createdAt: row.created_at,
  };
}

async function listByUser(userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM saved_locations WHERE user_id = ? ORDER BY created_at DESC, id DESC',
    [userId]
  );
  return rows.map(toDto);
}

async function findOwned(id, userId) {
  const [rows] = await pool.execute('SELECT * FROM saved_locations WHERE id = ? AND user_id = ? LIMIT 1', [
    id,
    userId,
  ]);
  return rows[0] ? toDto(rows[0]) : null;
}

async function create(userId, { name, latitude, longitude }) {
  const [result] = await pool.execute(
    'INSERT INTO saved_locations (user_id, location_name, latitude, longitude) VALUES (?, ?, ?, ?)',
    [userId, name, latitude, longitude]
  );
  return findOwned(result.insertId, userId);
}

async function update(id, userId, { name, latitude, longitude }) {
  const [result] = await pool.execute(
    `UPDATE saved_locations
        SET location_name = COALESCE(?, location_name),
            latitude      = COALESCE(?, latitude),
            longitude     = COALESCE(?, longitude)
      WHERE id = ? AND user_id = ?`,
    [name ?? null, latitude ?? null, longitude ?? null, id, userId]
  );
  if (!result.affectedRows) return null;
  return findOwned(id, userId);
}

async function remove(id, userId) {
  const [result] = await pool.execute('DELETE FROM saved_locations WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

module.exports = { listByUser, findOwned, create, update, remove };
