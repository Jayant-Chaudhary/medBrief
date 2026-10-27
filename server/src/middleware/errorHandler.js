const logger = require('../utils/logger');

/** Multer signals a rejected upload through these; they are client errors. */
const UPLOAD_ERROR_CODES = {
  LIMIT_FILE_SIZE: 413,
  LIMIT_FILE_COUNT: 400,
  LIMIT_UNEXPECTED_FILE: 400,
};

function resolveStatus(err) {
  if (err.name === 'MulterError') return UPLOAD_ERROR_CODES[err.code] || 400;
  // PostgREST reports a missing table/view in its schema cache with
  // PGRST205. This is a deployment/schema setup issue, not an opaque 500.
  if (err.code === 'PGRST205' || err.code === '42P01') return 503;
  // A rejected file type arrives as a plain Error from multer's fileFilter.
  if (/^Unsupported file type/.test(err.message || '')) return 415;
  // Malformed JSON from express.json().
  if (err.type === 'entity.parse.failed') return 400;
  return err.status || err.statusCode || 500;
}

function errorHandler(err, req, res, next) {
  const status = resolveStatus(err);
  const message = err.code === 'PGRST205' || err.code === '42P01'
    ? 'A required database table is missing. Apply the pending Supabase migration, then refresh the schema cache.'
    : (err.message || 'Internal Server Error');
  const log = req.log || logger;
  const meta = { method: req.method, url: req.originalUrl, status };

  // Client errors are expected traffic; only server errors need the stack.
  if (status >= 500) log.error(`request failed: ${err.message}`, { ...meta, err });
  else log.warn(`request rejected: ${err.message}`, meta);

  if (res.headersSent) return next(err);

  res.status(status).json({
    error: message,
    ...(req.id && { requestId: req.id }),
    ...(process.env.NODE_ENV === 'development' && { details: err.stack }),
  });
}

module.exports = errorHandler;
