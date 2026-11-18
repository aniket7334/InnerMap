const { pool } = require('../config/db');

function toDto(row) {
  let region = null;
  try {
    region = JSON.parse(row.region);
  } catch (_e) {
    region = null;
  }
  return {
    id: row.id,
    mapName: row.map_name,
    region,
    zoomMin: row.zoom_min,
    zoomMax: row.zoom_max,
    storageSize: Number(row.storage_size),
    downloadStatus: row.download_status,
    createdAt: row.created_at,
  };
}

async function listByUser(userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM downloaded_maps WHERE user_id = ? ORDER BY created_at DESC, id DESC',
    [userId]
  );
  return rows.map(toDto);
}

async function create(userId, { mapName, region, zoomMin, zoomMax, storageSize, downloadStatus }) {
  const [result] = await pool.execute(
    `INSERT INTO downloaded_maps
       (user_id, map_name, region, zoom_min, zoom_max, storage_size, download_status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userId, mapName, JSON.stringify(region), zoomMin, zoomMax, storageSize, downloadStatus]
  );
  const [rows] = await pool.execute('SELECT * FROM downloaded_maps WHERE id = ?', [result.insertId]);
  return toDto(rows[0]);
}

async function remove(id, userId) {
  const [result] = await pool.execute('DELETE FROM downloaded_maps WHERE id = ? AND user_id = ?', [id, userId]);
  return result.affectedRows > 0;
}

module.exports = { listByUser, create, remove };
