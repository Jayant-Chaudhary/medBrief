const crypto = require('crypto');
const logger = require('../utils/logger');

// Accept a caller's correlation ID only if it looks like one.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;

/**
 * Strips tokens, credentials, and sensitive query/path parameters from URLs before logging.
 */
function sanitizeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return '';
  const [pathname, search] = rawUrl.split('?');

  // Scrub known secret path segments (invite tokens, reset password tokens)
  let cleanPath = pathname
    .replace(/\/invite\/[^/]+/g, '/invite/:token')
    .replace(/\/reset-password\/[^/]+/g, '/reset-password/:token');

  // Scrub any long opaque hash/token path segment (> 24 chars that isn't a standard UUID)
  cleanPath = cleanPath
    .split('/')
    .map((part) => {
      if (
        /^[A-Za-z0-9_-]{24,}$/.test(part) &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part)
      ) {
        return ':token';
      }
      return part;
    })
    .join('/');

  if (!search) {
    return cleanPath;
  }

  // Scrub sensitive query parameters
  const params = new URLSearchParams(search);
  const sanitizedParams = new URLSearchParams();

  for (const [key, val] of params.entries()) {
    const lower = key.toLowerCase();
    if (
      lower.includes('token') ||
      lower.includes('secret') ||
      lower.includes('key') ||
      lower.includes('auth') ||
      lower.includes('password') ||
      lower.includes('code') ||
      lower.includes('patient') ||
      lower.includes('email') ||
      lower.includes('phone') ||
      lower.includes('sig')
    ) {
      sanitizedParams.append(key, '[REDACTED]');
    } else {
      sanitizedParams.append(key, val);
    }
  }

  const qs = sanitizedParams.toString();
  return qs ? `${cleanPath}?${qs}` : cleanPath;
}

/**
 * Tags each request with an ID (echoed as X-Request-Id), attaches `req.log`
 * scoped to it, and logs one line per request when the response finishes.
 */
function requestLogger(req, res, next) {
  const incoming = req.get('X-Request-Id');
  const reqId = incoming && SAFE_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
  const start = process.hrtime.bigint();
  const sanitizedUrl = sanitizeUrl(req.originalUrl);

  req.id = reqId;
  req.log = logger.child({ reqId });
  res.setHeader('X-Request-Id', reqId);

  req.log.debug('request started', {
    method: req.method,
    url: sanitizedUrl,
    // Field names only: bodies carry patient health data.
    ...(req.body && Object.keys(req.body).length && { bodyKeys: Object.keys(req.body) }),
  });

  let logged = false;
  const done = (event) => {
    if (logged) return;
    logged = true;

    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    const status = res.statusCode;
    const meta = {
      method: req.method,
      url: sanitizedUrl,
      status,
      durationMs: Math.round(durationMs * 10) / 10,
      ...(req.user && { userId: req.user.id, role: req.user.role }),
      ...(event === 'close' && { aborted: true }),
    };

    const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info';
    // Health probes are noisy; keep them at debug unless they fail.
    const quiet = level === 'info' && req.path === '/health';
    req.log[quiet ? 'debug' : level](`${req.method} ${sanitizedUrl} ${status}`, meta);
  };

  res.on('finish', () => done('finish'));
  res.on('close', () => done('close'));
  next();
}

module.exports = requestLogger;
module.exports.sanitizeUrl = sanitizeUrl;
