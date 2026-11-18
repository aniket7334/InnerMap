const { pool } = require('../config/db');

function toDto(row) {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    fileName: row.file_name,
    featureCount: Number(row.feature_count || 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const SELECT = `SELECT l.*, (SELECT COUNT(*) FROM map_features f WHERE f.layer_id = l.id) AS feature_count
                  FROM map_layers l`;

async function listByUser(userId) {
  const [rows] = await pool.execute(`${SELECT} WHERE l.user_id = ? ORDER BY l.created_at DESC, l.id DESC`, [userId]);
  return rows.map(toDto);
}

async function findOwned(id, userId) {
  const [rows] = await pool.execute(`${SELECT} WHERE l.id = ? AND l.user_id = ? LIMIT 1`, [id, userId]);
  return rows[0] ? toDto(rows[0]) : null;
}

/** Create using an existing connection (so it can share a transaction with feature inserts). */
async function createWith(conn, userId, { name, source, fileName }) {
  const [result] = await conn.execute(
    'INSERT INTO map_layers (user_id, name, source, file_name) VALUES (?, ?, ?, ?)',
    [userId, name, source, fileName || null]
  );
  return result.insertId;
}

async function rename(id, userId, name) {
  const [result] = await pool.execute('UPDATE map_layers SET name = ? WHERE id = ? AND user_id = ?', [
    name,
    id,
    userId,
  ]);
  return result.affectedRows > 0;
}

/** Bump updated_at so other devices know the layer's features changed. */
async function touchWith(conn, id) {
  await conn.execute('UPDATE map_layers SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
}

async function remove(id, userId) {
  const [result] = await pool.execute('DELETE FROM map_layers WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

module.exports = { listByUser, findOwned, createWith, rename, touchWith, remove };
