const crypto = require('crypto');
const path = require('path');
const supabaseAdmin = require('../config/supabaseAdminClient');
const storageConfig = require('../config/storageEncryption.config');
const storageEncryption = require('./crypto/storageEncryption.service');
const log = require('../utils/logger').child({ scope: 'storage' });

const LAB_REPORTS_BUCKET = 'lab-reports';
const PRESCRIPTIONS_BUCKET = 'prescriptions';

/** Signed URLs are short-lived; the client re-requests one when it needs it. */
const SIGNED_URL_TTL_SECONDS = storageConfig.signedUrlTtlSec || 60 * 10;

/**
 * Uploads a buffer and returns the storage path.
 *
 * Files are encrypted with AES-256-GCM + RSA-OAEP before storage at rest.
 * Files are namespaced by owner (`<patientId>/<uuid><ext>`) so a storage
 * policy can be written per user later without moving anything, and so one
 * patient can never guess another's path.
 */
async function uploadFile({ bucket, ownerId, buffer, originalName, contentType }) {
  const extension = path.extname(originalName || '').toLowerCase() || '.bin';
  const storagePath = `${ownerId}/${crypto.randomUUID()}${extension}`;

  // Always encrypt: an uploaded file that merely begins with the envelope magic
  // bytes must not be stored as-is.
  const payloadToStore = storageEncryption.encrypt(buffer);

  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(storagePath, payloadToStore, { contentType: 'application/octet-stream', upsert: false });

  if (error) {
    log.error(`upload to ${bucket} failed: ${error.message}`, { bucket, ownerId, bytes: buffer?.length });
    throw new Error(`Failed to store file: ${error.message}`);
  }

  log.debug(`stored ${bucket}/${storagePath}`, { bytes: payloadToStore?.length });
  return storagePath;
}

/**
 * Generates a time-limited HMAC-signed proxy URL to securely stream decrypted file content.
 */
function signStorageUrl(bucket, storagePath, expiresIn = SIGNED_URL_TTL_SECONDS) {
  if (!storagePath) return null;
  const ttl = expiresIn || SIGNED_URL_TTL_SECONDS;
  const exp = Math.floor(Date.now() / 1000) + ttl;
  const payload = `${bucket}:${storagePath}:${exp}`;
  const sig = crypto.createHmac('sha256', storageConfig.proxyHmacSecret).update(payload).digest('hex');

  const baseUrl = (process.env.SERVER_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/+$/, '');

  return `${baseUrl}/api/storage/file?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(storagePath)}&expires=${exp}&sig=${sig}`;
}

/** A time-limited URL for a private object, or null if one cannot be minted. */
async function createSignedUrl(bucket, storagePath, expiresIn = SIGNED_URL_TTL_SECONDS) {
  return signStorageUrl(bucket, storagePath, expiresIn);
}

async function removeFile(bucket, storagePath) {
  if (!storagePath) return;
  const { error } = await supabaseAdmin.storage.from(bucket).remove([storagePath]);
  if (error) log.warn(`could not remove ${bucket}/${storagePath}: ${error.message}`);
}

module.exports = {
  LAB_REPORTS_BUCKET,
  PRESCRIPTIONS_BUCKET,
  uploadFile,
  signStorageUrl,
  createSignedUrl,
  removeFile,
};
