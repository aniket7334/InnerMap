const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const { signToken } = require('../services/tokenService');
const { HttpError } = require('../middleware/errorHandler');

const SALT_ROUNDS = 12;

async function register(req, res) {
  const name = req.body.name.trim();
  const email = req.body.email.trim().toLowerCase();

  if (await User.findByEmail(email)) throw new HttpError(409, 'An account with this email already exists');

  const passwordHash = await bcrypt.hash(req.body.password, SALT_ROUNDS);
  const user = await User.create({ name, email, passwordHash });
  res.status(201).json({ token: signToken(user), user });
}

async function login(req, res) {
  const email = req.body.email.trim().toLowerCase();
  const row = await User.findByEmail(email);
  // Same message for unknown email and wrong password, so accounts cannot be enumerated.
  const ok = row && (await bcrypt.compare(req.body.password, row.password));
  if (!ok) throw new HttpError(401, 'Invalid email or password');

  const user = await User.findById(row.id);
  res.json({ token: signToken(user), user });
}

async function getProfile(req, res) {
  const user = await User.findById(req.user.id);
  if (!user) throw new HttpError(404, 'User not found');
  res.json({ user });
}

async function updateProfile(req, res) {
  const { name, email, currentPassword, newPassword, locationHistoryEnabled } = req.body;
  const fields = {};

  if (name !== undefined) fields.name = name.trim();

  if (email !== undefined) {
    const normalized = email.trim().toLowerCase();
    const existing = await User.findByEmail(normalized);
    if (existing && existing.id !== req.user.id) throw new HttpError(409, 'That email is already in use');
    fields.email = normalized;
  }

  if (newPassword !== undefined) {
    const row = await User.findByIdWithPassword(req.user.id);
    if (!currentPassword || !(await bcrypt.compare(currentPassword, row.password))) {
      throw new HttpError(400, 'Current password is incorrect', { currentPassword: 'Current password is incorrect' });
    }
    fields.passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
  }

  if (locationHistoryEnabled !== undefined) fields.locationHistoryEnabled = locationHistoryEnabled;

  const user = await User.update(req.user.id, fields);
  res.json({ user });
}

module.exports = { register, login, getProfile, updateProfile };
