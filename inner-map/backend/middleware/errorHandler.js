class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function notFound(req, _res, next) {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`));
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ message: 'Request body is not valid JSON' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ message: 'Request body is too large' });
  }
  if (['ECONNREFUSED', 'ER_BAD_DB_ERROR', 'ER_ACCESS_DENIED_ERROR', 'ER_NO_SUCH_TABLE'].includes(err.code)) {
    console.error('[db]', err.code, err.message);
    return res.status(503).json({
      message: 'Database is unavailable. Start MySQL in XAMPP and import database/inner_map_db.sql.',
    });
  }
  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ message: 'That record already exists' });
  }
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  const body = { message: status >= 500 ? 'Internal server error' : err.message };
  if (err.details) body.errors = err.details;
  return res.status(status).json(body);
}

// Wraps async route handlers so rejected promises reach errorHandler.
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { HttpError, notFound, errorHandler, asyncHandler };
