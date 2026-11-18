const { pool } = require('../config/db');

const PUBLIC_COLUMNS = 'id, name, email, location_history_enabled, location_history_consent_at, created_at';

function toPublic(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    locationHistoryEnabled: Boolean(row.location_history_enabled),
    locationHistoryConsentAt: row.location_history_consent_at,
    createdAt: row.created_at,
  };
}

async function findByEmail(email) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [email]);
  return rows[0] || null;
}

async function findById(id) {
  const [rows] = await pool.execute(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ? LIMIT 1`, [id]);
  return toPublic(rows[0]);
}

async function findByIdWithPassword(id) {
  const [rows] = await pool.execute('SELECT * FROM users WHERE id = ? LIMIT 1', [id]);
  return rows[0] || null;
}

async function create({ name, email, passwordHash }) {
  const [result] = await pool.execute('INSERT INTO users (name, email, password) VALUES (?, ?, ?)', [
    name,
    email,
    passwordHash,
  ]);
  return findById(result.insertId);
}

async function update(id, fields) {
  const sets = [];
  const values = [];
  if (fields.name !== undefined) {
    sets.push('name = ?');
    values.push(fields.name);
  }
  if (fields.email !== undefined) {
    sets.push('email = ?');
    values.push(fields.email);
  }
  if (fields.passwordHash !== undefined) {
    sets.push('password = ?');
    values.push(fields.passwordHash);
  }
  if (fields.locationHistoryEnabled !== undefined) {
    sets.push('location_history_enabled = ?', 'location_history_consent_at = ?');
    values.push(fields.locationHistoryEnabled ? 1 : 0, fields.locationHistoryEnabled ? new Date() : null);
  }
  if (!sets.length) return findById(id);
  values.push(id);
  await pool.execute(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, values);
  return findById(id);
}

module.exports = { findByEmail, findById, findByIdWithPassword, create, update };
