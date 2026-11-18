const { pool } = require('../config/db');
const { parseStoredTypography } = require('../utils/typography');

const DEFAULTS = {
  mapProvider: 'local-vector',
  defaultLat: null,
  defaultLng: null,
  defaultZoom: null,
  showDownloadedAreas: true,
  typography: null, // null = default typography (see utils/typography.js)
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
    typography: parseStoredTypography(row.typography),
    updatedAt: row.updated_at,
  };
}

async function get(userId) {
  const [rows] = await pool.execute('SELECT * FROM user_preferences WHERE user_id = ? LIMIT 1', [userId]);
  return toDto(rows[0]);
}

// The typography column comes from migration 004. If it has not been applied (or was
// rolled back) the other preferences keep working and typography stays per-device.
let typographyColumn = null;
async function hasTypographyColumn() {
  if (typographyColumn === null) {
    const [rows] = await pool.execute("SHOW COLUMNS FROM user_preferences LIKE 'typography'");
    typographyColumn = rows.length > 0;
  }
  return typographyColumn;
}

/** Insert or update only the fields provided. */
async function upsert(userId, prefs) {
  const current = await get(userId);
  const next = { ...current, ...prefs };
  if (prefs.typography !== undefined && !(await hasTypographyColumn())) {
    const err = new Error('Typography settings need database migration 004');
    err.status = 422; // 4xx: the client drops it from its outbox instead of retrying forever
    throw err;
  }
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
  if (prefs.typography !== undefined) {
    await pool.execute('UPDATE user_preferences SET typography = ? WHERE user_id = ?', [
      next.typography === null ? null : JSON.stringify(next.typography),
      userId,
    ]);
  }
  return get(userId);
}

module.exports = { get, upsert, DEFAULTS };
