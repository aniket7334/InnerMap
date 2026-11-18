// Verifies "Authorization: Bearer <jwt>" and attaches req.user = { id, email }.
const { verifyToken } = require('../services/tokenService');
const { HttpError } = require('./errorHandler');

function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return next(new HttpError(401, 'Authentication required'));
  }
  try {
    const payload = verifyToken(token);
    const id = Number(payload.sub);
    if (!Number.isInteger(id) || id <= 0) throw new Error('bad subject');
    req.user = { id, email: payload.email };
    return next();
  } catch (_err) {
    return next(new HttpError(401, 'Invalid or expired token'));
  }
}

module.exports = { requireAuth };
