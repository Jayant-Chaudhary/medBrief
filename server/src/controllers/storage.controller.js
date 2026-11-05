/**
 * Storage Controller
 *
 * Serves decrypted files from Supabase Storage via time-limited HMAC-signed URLs.
 */

const path = require('path');
const crypto = require('crypto');
const supabaseAdmin = require('../config/supabaseAdminClient');
const config = require('../config/storageEncryption.config');
const storageEncryption = require('../services/crypto/storageEncryption.service');
const logger = require('../utils/logger').child({ scope: 'storage-controller' });

const ALLOWED_BUCKETS = ['lab-reports', 'prescriptions', 'consult-audio'];

const MIME_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
  '.txt': 'text/plain',
};

function getMimeType(filePath) {
  const ext = path.extname(filePath || '').toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function verifyStorageSignature({ bucket, storagePath, expires, sig, secret }) {
  if (!bucket || !storagePath || !expires || !sig) {
    return { ok: false, status: 400, code: 'ERR_MISSING_SIGNATURE_PARAMS', message: 'Missing signature parameters' };
  }

  const expNum = Number(expires);
  if (!Number.isSafeInteger(expNum) || expNum <= 0) {
    return { ok: false, status: 400, code: 'ERR_INVALID_EXPIRY', message: 'Invalid expiry timestamp' };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec > expNum) {
    return { ok: false, status: 403, code: 'ERR_URL_EXPIRED', message: 'Signed URL has expired' };
  }

  const payload = `${bucket}:${storagePath}:${expNum}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(payload).digest('hex');

  const sigBuf = Buffer.from(String(sig), 'hex');
  const expectedBuf = Buffer.from(expectedSig, 'hex');

  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, status: 403, code: 'ERR_INVALID_SIGNATURE', message: 'Invalid or forged signature' };
  }

  return { ok: true };
}

/**
 * Streams a decrypted file from Supabase Storage if the URL signature is valid.
 */
async function serveStorageFile(req, res, next) {
  try {
    const { bucket, path: storagePath, expires, sig } = req.query;

    // 1. Bucket whitelist check
    if (!bucket || !ALLOWED_BUCKETS.includes(bucket)) {
      return res.status(400).json({ error: 'Invalid storage bucket', code: 'ERR_INVALID_BUCKET' });
    }

    // 2. Storage path traversal & safety check
    if (!storagePath || typeof storagePath !== 'string') {
      return res.status(400).json({ error: 'Missing or invalid file path', code: 'ERR_INVALID_PATH' });
    }
    const normalized = path.normalize(storagePath).replace(/^(\.\.(\/|\\|$))+/, '');
    if (storagePath.includes('..') || storagePath.startsWith('/') || storagePath.includes('\0') || normalized !== storagePath) {
      return res.status(400).json({ error: 'Illegal file path traversal', code: 'ERR_INVALID_PATH' });
    }

    // 3. Signature verification
    const sigCheck = verifyStorageSignature({
      bucket,
      storagePath,
      expires,
      sig,
      secret: config.proxyHmacSecret,
    });

    if (!sigCheck.ok) {
      return res.status(sigCheck.status).json({ error: sigCheck.message, code: sigCheck.code });
    }

    // 4. Download encrypted object from Supabase Storage
    const { data, error } = await supabaseAdmin.storage.from(bucket).download(storagePath);
    if (error || !data) {
      logger.warn('Storage object download failed or missing', {
        bucket,
        code: error?.code || 'ERR_FILE_NOT_FOUND',
      });
      return res.status(404).json({ error: 'File not found or inaccessible', code: 'ERR_FILE_NOT_FOUND' });
    }

    // Convert downloaded blob to buffer
    let rawBuffer;
    if (Buffer.isBuffer(data)) {
      rawBuffer = data;
    } else if (typeof data.arrayBuffer === 'function') {
      rawBuffer = Buffer.from(await data.arrayBuffer());
    } else if (typeof data.text === 'function') {
      rawBuffer = Buffer.from(await data.text());
    } else {
      rawBuffer = Buffer.from(data);
    }

    // 5. Decrypt envelope
    let decrypted;
    try {
      decrypted = storageEncryption.decrypt(rawBuffer);
    } catch (decryptErr) {
      logger.error('Failed to decrypt storage object for streaming', {
        bucket,
        code: decryptErr.code || 'ERR_DECRYPT_FAILED',
      });
      return res.status(500).json({ error: 'Failed to decrypt file', code: decryptErr.code || 'ERR_DECRYPT_FAILED' });
    }

    // 6. Set headers and stream response
    const mimeType = getMimeType(storagePath);
    const filename = path.basename(storagePath);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', decrypted.length);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.setHeader('Cache-Control', 'private, max-age=300');

    return res.status(200).send(decrypted);
  } catch (err) {
    logger.error('Unexpected error serving storage file', { code: 'ERR_SERVE_STORAGE_EXCEPTION' });
    next(err);
  }
}

module.exports = {
  ALLOWED_BUCKETS,
  getMimeType,
  verifyStorageSignature,
  serveStorageFile,
};
