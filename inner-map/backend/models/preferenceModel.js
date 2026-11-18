const { pool } = require('../config/db');

const DEFAULTS = {
  mapProvider: 'local-vector',
  defaultLat: null,
  defaultLng: null,
  defaultZoom: null,
  showDownloadedAreas: true,
  updatedAt: null,
};

function toDto(row) {
  if (!row) return { ...DEFAULTS };
  return {
    mapProvider: row.map_provider,
    defaultLat: row.default_lat === null ? null : Number(row.default_lat),
    defaultLng: row.default_lng === null ? null : Number(row.default_lng),
    defaultZoom: row.default_zoom,
    showDownloadedAreas: Boolean(row.show_downloaded_areas),
    updatedAt: row.updated_at,
  };
}

async function get(userId) {
  const [rows] = await pool.execute('SELECT * FROM user_preferences WHERE user_id = ? LIMIT 1', [userId]);
  return toDto(rows[0]);
}

/** Insert or update only the fields provided. */
async function upsert(userId, prefs) {
  const current = await get(userId);
  const next = { ...current, ...prefs };
  await pool.execute(
    `INSERT INTO user_preferences
       (user_id, map_provider, default_lat, default_lng, default_zoom, show_downloaded_areas)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       map_provider = VALUES(map_provider),
       default_lat = VALUES(default_lat),
       default_lng = VALUES(default_lng),
       default_zoom = VALUES(default_zoom),
       show_downloaded_areas = VALUES(show_downloaded_areas)`,
    [
      userId,
      next.mapProvider,
      next.defaultLat,
      next.defaultLng,
      next.defaultZoom,
      next.showDownloadedAreas ? 1 : 0,
    ]
  );
  return get(userId);
}

module.exports = { get, upsert, DEFAULTS };
