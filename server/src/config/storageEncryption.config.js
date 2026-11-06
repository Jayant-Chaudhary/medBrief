/**
 * Storage Encryption Configuration
 *
 * Configures RSA + AES-256-GCM envelope encryption for sensitive files
 * (lab reports, prescriptions, consultation audio chunks).
 */

const logger = require('../utils/logger').child({ scope: 'storage-encryption-config' });
const { requireSecret } = require('./runtimeEnv');

function normalizePem(keyStr) {
  if (!keyStr) return null;
  let str = String(keyStr).trim();
  if (!str.includes('-----BEGIN')) {
    try {
      const decoded = Buffer.from(str, 'base64').toString('utf8');
      if (decoded.includes('-----BEGIN')) {
        str = decoded;
      }
    } catch (_) {}
  }
  return str.replace(/\\n/g, '\n');
}

const env = process.env;
const isTestOrDev = (env.NODE_ENV || 'development') === 'development' || (env.NODE_ENV || '') === 'test';

const rsaPublicKey = normalizePem(env.STORAGE_ENCRYPTION_RSA_PUBLIC_KEY);
const rsaPrivateKey = normalizePem(env.STORAGE_ENCRYPTION_RSA_PRIVATE_KEY);
const keyId = env.STORAGE_ENCRYPTION_KEY_ID || 'v1';
const allowLegacyFallback = env.STORAGE_ENCRYPTION_ALLOW_LEGACY_FALLBACK !== 'false';
const proxyHmacSecret = requireSecret(
  ['STORAGE_PROXY_HMAC_SECRET', 'SESSION_TOKEN_SECRET'],
  'dev-storage-hmac-secret-change-in-prod',
);
const signedUrlTtlSec = Number(env.STORAGE_SIGNED_URL_TTL_SEC || 600); // 10 minutes default

if (!rsaPublicKey && !isTestOrDev) {
  logger.warn('STORAGE_ENCRYPTION_RSA_PUBLIC_KEY is not set; server-side encryption will fail in non-dev environments');
}
if (!rsaPrivateKey && !isTestOrDev) {
  logger.warn('STORAGE_ENCRYPTION_RSA_PRIVATE_KEY is not set; server-side decryption will fail in non-dev environments');
}

module.exports = {
  rsaPublicKey,
  rsaPrivateKey,
  keyId,
  allowLegacyFallback,
  proxyHmacSecret,
  signedUrlTtlSec,
  normalizePem,
};
