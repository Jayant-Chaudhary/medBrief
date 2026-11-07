const logger = require('../utils/logger');
const { sanitizeUrl } = require('./requestLogger');

/** Multer signals a rejected upload through these; they are client errors. */
const UPLOAD_ERROR_CODES = {
  LIMIT_FILE_SIZE: 413,
  LIMIT_FILE_COUNT: 400,
  LIMIT_UNEXPECTED_FILE: 400,
};

function resolveStatus(err) {
  if (err.name === 'MulterError') return UPLOAD_ERROR_CODES[err.code] || 400;
  // A rejected file type arrives as a plain Error from multer's fileFilter.
  if (/^Unsupported file type/.test(err.message || '')) return 415;
  // Malformed JSON from express.json().
  if (err.type === 'entity.parse.failed') return 400;
  return err.status || err.statusCode || 500;
}

function errorHandler(err, req, res, next) {
  const status = resolveStatus(err);
  const log = req.log || logger;
  // Sanitized: raw URLs can carry signed-link signatures and invite tokens.
  const meta = { method: req.method, url: sanitizeUrl(req.originalUrl), status };

  // Client errors are expected traffic; only server errors need the stack.
  if (status >= 500) log.error(`request failed: ${err.message}`, { ...meta, err });
  else log.warn(`request rejected: ${err.message}`, meta);

  if (res.headersSent) return next(err);

  res.status(status).json({
    error: err.message || 'Internal Server Error',
    // Machine-readable app codes (ERR_*) only; never driver or library codes.
    ...(typeof err.code === 'string' && /^ERR_[A-Z_]+$/.test(err.code) && { code: err.code }),
    ...(req.id && { requestId: req.id }),
    ...(process.env.NODE_ENV === 'development' && { details: err.stack }),
  });
}

module.exports = errorHandler;
