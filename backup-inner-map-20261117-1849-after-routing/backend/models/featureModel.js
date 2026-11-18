const { pool } = require('../config/db');
const Layer = require('./layerModel');

function parseJson(text) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function toDto(row) {
  return {
    id: row.id,
    layerId: row.layer_id,
    name: row.name,
    description: row.description,
    geometry: parseJson(row.geometry),
    style: parseJson(row.style),
    createdAt: row.created_at,
  };
}

async function listByLayer(layerId, userId) {
  const [rows] = await pool.execute(
    'SELECT * FROM map_features WHERE layer_id = ? AND user_id = ? ORDER BY id',
    [layerId, userId]
  );
  return rows.map(toDto);
}

/** Bulk insert inside a transaction connection. Returns the new ids in input order. */
async function insertManyWith(conn, userId, layerId, features) {
  const ids = [];
  // Chunks keep each INSERT statement a reasonable size.
  for (let i = 0; i < features.length; i += 200) {
    const chunk = features.slice(i, i + 200);
    const values = chunk.map((f) => [
      userId,
      layerId,
      f.name,
      f.description,
      f.geometryType,
      JSON.stringify(f.geometry),
      f.style ? JSON.stringify(f.style) : null,
    ]);
    const [result] = await conn.query(
      'INSERT INTO map_features (user_id, layer_id, name, description, geometry_type, geometry, style) VALUES ?',
      [values]
    );
    // InnoDB assigns consecutive ids to a multi-row insert (innodb_autoinc_lock_mode 1/2 for simple inserts).
    for (let k = 0; k < chunk.length; k += 1) ids.push(result.insertId + k);
  }
  return ids;
}

/** Create a layer and its features atomically. */
async function createLayerWithFeatures(userId, layer, features) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const layerId = await Layer.createWith(conn, userId, layer);
    const featureIds = await insertManyWith(conn, userId, layerId, features);
    await conn.commit();
    return { layerId, featureIds };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function appendToLayer(userId, layerId, features) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const featureIds = await insertManyWith(conn, userId, layerId, features);
    await Layer.touchWith(conn, layerId);
    await conn.commit();
    return featureIds;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function findOwned(id, userId) {
  const [rows] = await pool.execute('SELECT * FROM map_features WHERE id = ? AND user_id = ? LIMIT 1', [id, userId]);
  return rows[0] ? toDto(rows[0]) : null;
}

async function update(id, userId, f) {
  const sets = [];
  const values = [];
  const set = (sql, value) => {
    sets.push(sql);
    values.push(value);
  };
  if (f.name !== undefined) set('name = ?', f.name);
  if (f.description !== undefined) set('description = ?', f.description);
  if (f.geometry !== undefined) {
    set('geometry_type = ?', f.geometry.type);
    set('geometry = ?', JSON.stringify(f.geometry));
  }
  if (f.style !== undefined) set('style = ?', f.style ? JSON.stringify(f.style) : null);
  const existing = await findOwned(id, userId);
  if (!existing) return null;
  if (sets.length) {
    values.push(id, userId);
    await pool.execute(`UPDATE map_features SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`, values);
    await Layer.touchWith(pool, existing.layerId);
  }
  return findOwned(id, userId);
}

async function remove(id, userId) {
  const existing = await findOwned(id, userId);
  if (!existing) return false;
  await pool.execute('DELETE FROM map_features WHERE id = ? AND user_id = ?', [id, userId]);
  await Layer.touchWith(pool, existing.layerId);
  return true;
}

module.exports = { listByLayer, createLayerWithFeatures, appendToLayer, findOwned, update, remove };
