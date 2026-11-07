/**
 * Storage Envelope Encryption Service
 *
 * Implements AES-256-GCM + RSA-OAEP envelope encryption for files stored in Supabase Storage.
 * Each file is encrypted with a unique random AES-256 Data Encryption Key (DEK).
 * The DEK is encrypted with an RSA public key and bundled with the ciphertext in a
 * self-contained binary envelope ('ENCR\x01').
 */

const crypto = require('crypto');
const config = require('../../config/storageEncryption.config');
const logger = require('../../utils/logger').child({ scope: 'storage-encryption' });

const MAGIC = Buffer.from('ENCR', 'ascii');
const VERSION = 1;
const SUITE_AES_256_GCM_RSA_OAEP = 1;
const GCM_IV_LENGTH = 12; // 96-bit nonce
const GCM_TAG_LENGTH = 16; // 128-bit authentication tag

// Under NODE_ENV=test only, an in-memory keypair is generated when no keys are
// configured. It is never used in development or production: anything stored
// with it becomes permanently unreadable once the process restarts.
let devFallbackKeyPair = null;

function isTestEnv() {
  return process.env.NODE_ENV === 'test';
}

function missingKeyError(kind) {
  const err = new Error(
    `Storage encryption ${kind} key is not configured. ` +
      'Set STORAGE_ENCRYPTION_RSA_PUBLIC_KEY and STORAGE_ENCRYPTION_RSA_PRIVATE_KEY ' +
      '(generate a pair with: npm run generate-keys --prefix server)'
  );
  err.code = 'ERR_ENCRYPTION_CONFIG_MISSING';
  return err;
}

function getDevFallbackKeyPair() {
  if (!devFallbackKeyPair) {
    logger.info('Generating ephemeral in-memory RSA-2048 keypair for test use');
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    devFallbackKeyPair = { publicKey, privateKey };
  }
  return devFallbackKeyPair;
}

function resolvePublicKey(options = {}) {
  if (options.publicKey) return config.normalizePem(options.publicKey);
  if (config.rsaPublicKey) return config.rsaPublicKey;

  if (isTestEnv()) return getDevFallbackKeyPair().publicKey;
  throw missingKeyError('public');
}

function resolvePrivateKey(options = {}) {
  if (options.privateKey) return config.normalizePem(options.privateKey);
  if (config.rsaPrivateKey) return config.rsaPrivateKey;

  if (isTestEnv()) return getDevFallbackKeyPair().privateKey;
  throw missingKeyError('private');
}

/**
 * Checks whether a buffer starts with the 'ENCR' magic header.
 *
 * @param {Buffer|Uint8Array} buffer
 * @returns {boolean}
 */
function isEncrypted(buffer) {
  if (!buffer || !Buffer.isBuffer(buffer)) return false;
  if (buffer.length < 4) return false;
  return buffer[0] === 0x45 && buffer[1] === 0x4e && buffer[2] === 0x43 && buffer[3] === 0x52; // 'ENCR'
}

/**
 * Encrypts a buffer using AES-256-GCM and wraps the DEK with RSA-OAEP.
 *
 * @param {Buffer|Uint8Array|string} data - Plaintext buffer
 * @param {object} [options]
 * @param {string} [options.publicKey] - Optional PEM public key override
 * @param {string} [options.keyId] - Key identifier (default 'v1')
 * @returns {Buffer} Encrypted binary envelope
 */
function encrypt(data, options = {}) {
  const plaintext = Buffer.isBuffer(data) ? data : Buffer.from(data || '');
  const publicKey = resolvePublicKey(options);
  const keyId = options.keyId || config.keyId || 'v1';

  const dek = crypto.randomBytes(32); // AES-256 key
  const iv = crypto.randomBytes(GCM_IV_LENGTH);

  // Symmetric AES-256-GCM encryption
  const cipher = crypto.createCipheriv('aes-256-gcm', dek, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Asymmetric RSA-OAEP key wrapping
  let encryptedDek;
  try {
    encryptedDek = crypto.publicEncrypt(
      {
        key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      dek
    );
  } catch (err) {
    logger.error('Failed to encrypt Data Encryption Key with RSA public key', {
      code: 'ERR_KEY_WRAP_FAILED',
      keyId,
    });
    const wrapErr = new Error('Failed to encrypt file encryption key');
    wrapErr.code = 'ERR_KEY_WRAP_FAILED';
    throw wrapErr;
  }

  // Pack binary envelope
  const keyIdBuffer = Buffer.from(keyId, 'utf8');
  const headerLength =
    4 + // MAGIC ('ENCR')
    1 + // VERSION (0x01)
    1 + // SUITE_ID (0x01)
    2 + // KEY_ID_LEN (uint16BE)
    keyIdBuffer.length +
    2 + // ENC_DEK_LEN (uint16BE)
    encryptedDek.length +
    1 + // IV_LEN (uint8)
    iv.length +
    GCM_TAG_LENGTH; // 16 bytes auth tag

  const envelope = Buffer.allocUnsafe(headerLength + ciphertext.length);
  let offset = 0;

  // 1. Magic
  MAGIC.copy(envelope, offset);
  offset += 4;

  // 2. Version
  envelope.writeUInt8(VERSION, offset);
  offset += 1;

  // 3. Suite ID
  envelope.writeUInt8(SUITE_AES_256_GCM_RSA_OAEP, offset);
  offset += 1;

  // 4. Key ID
  envelope.writeUInt16BE(keyIdBuffer.length, offset);
  offset += 2;
  keyIdBuffer.copy(envelope, offset);
  offset += keyIdBuffer.length;

  // 5. Encrypted DEK
  envelope.writeUInt16BE(encryptedDek.length, offset);
  offset += 2;
  encryptedDek.copy(envelope, offset);
  offset += encryptedDek.length;

  // 6. IV
  envelope.writeUInt8(iv.length, offset);
  offset += 1;
  iv.copy(envelope, offset);
  offset += iv.length;

  // 7. Auth Tag
  authTag.copy(envelope, offset);
  offset += GCM_TAG_LENGTH;

  // 8. Ciphertext
  ciphertext.copy(envelope, offset);

  return envelope;
}

/**
 * Decrypts a binary envelope to recover the original plaintext buffer.
 *
 * @param {Buffer|Uint8Array} data - Encrypted envelope or legacy plaintext buffer
 * @param {object} [options]
 * @param {string} [options.privateKey] - Optional PEM private key override
 * @param {boolean} [options.allowLegacyFallback] - Whether to allow unencrypted buffers
 * @returns {Buffer} Decrypted plaintext buffer
 */
function decrypt(data, options = {}) {
  const envelope = Buffer.isBuffer(data) ? data : Buffer.from(data || '');

  if (!isEncrypted(envelope)) {
    const allowFallback =
      options.allowLegacyFallback !== undefined
        ? options.allowLegacyFallback
        : config.allowLegacyFallback;

    if (allowFallback) {
      logger.debug('Object is not envelope-encrypted; returning legacy plaintext buffer');
      return envelope;
    }
    const err = new Error('Payload is not envelope-encrypted');
    err.code = 'ERR_NOT_ENCRYPTED';
    throw err;
  }

  if (envelope.length < 32) {
    const err = new Error('Encrypted envelope payload is truncated');
    err.code = 'ERR_ENVELOPE_TRUNCATED';
    throw err;
  }

  let offset = 4; // Skip 'ENCR'

  const version = envelope.readUInt8(offset);
  offset += 1;
  if (version !== VERSION) {
    const err = new Error(`Unsupported envelope version: ${version}`);
    err.code = 'ERR_UNSUPPORTED_VERSION';
    throw err;
  }

  const suiteId = envelope.readUInt8(offset);
  offset += 1;
  if (suiteId !== SUITE_AES_256_GCM_RSA_OAEP) {
    const err = new Error(`Unsupported cipher suite ID: ${suiteId}`);
    err.code = 'ERR_UNSUPPORTED_SUITE';
    throw err;
  }

  const keyIdLen = envelope.readUInt16BE(offset);
  offset += 2;
  if (envelope.length < offset + keyIdLen) {
    const err = new Error('Envelope header truncated reading keyId');
    err.code = 'ERR_ENVELOPE_TRUNCATED';
    throw err;
  }
  const keyId = envelope.toString('utf8', offset, offset + keyIdLen);
  offset += keyIdLen;

  const encDekLen = envelope.readUInt16BE(offset);
  offset += 2;
  if (envelope.length < offset + encDekLen) {
    const err = new Error('Envelope header truncated reading encrypted DEK');
    err.code = 'ERR_ENVELOPE_TRUNCATED';
    throw err;
  }
  const encryptedDek = envelope.subarray(offset, offset + encDekLen);
  offset += encDekLen;

  const ivLen = envelope.readUInt8(offset);
  offset += 1;
  if (envelope.length < offset + ivLen + GCM_TAG_LENGTH) {
    const err = new Error('Envelope header truncated reading IV or Tag');
    err.code = 'ERR_ENVELOPE_TRUNCATED';
    throw err;
  }
  const iv = envelope.subarray(offset, offset + ivLen);
  offset += ivLen;

  const authTag = envelope.subarray(offset, offset + GCM_TAG_LENGTH);
  offset += GCM_TAG_LENGTH;

  const ciphertext = envelope.subarray(offset);

  // Decrypt DEK using RSA private key
  const privateKey = resolvePrivateKey(options);
  let dek;
  try {
    dek = crypto.privateDecrypt(
      {
        key: privateKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: 'sha256',
      },
      encryptedDek
    );
  } catch (_err) {
    logger.error('Failed to unwrap Data Encryption Key with RSA private key', {
      code: 'ERR_KEY_UNWRAP_FAILED',
      keyId,
    });
    const unwrapErr = new Error('Decryption failed: key unwrap error');
    unwrapErr.code = 'ERR_KEY_UNWRAP_FAILED';
    throw unwrapErr;
  }

  // Decrypt ciphertext using AES-256-GCM
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', dek, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext;
  } catch (_err) {
    logger.error('Failed to decrypt ciphertext or auth tag mismatch', {
      code: 'ERR_DECRYPT_AUTHENTICATION_FAILED',
      keyId,
    });
    const authErr = new Error('Decryption failed: integrity check failed');
    authErr.code = 'ERR_DECRYPT_AUTHENTICATION_FAILED';
    throw authErr;
  }
}

/**
 * Confirms the configured public and private keys form a working pair by
 * wrapping and unwrapping a random value. Call at startup so a mismatched pair
 * is caught before any file is stored with an unrecoverable key.
 *
 * @param {object} [options]
 * @param {string} [options.publicKey] - PEM override (tests)
 * @param {string} [options.privateKey] - PEM override (tests)
 * @returns {{ ok: true } | { ok: false, code: string }} Never includes key material.
 */
function verifyKeyPair(options = {}) {
  const publicKey = options.publicKey ? config.normalizePem(options.publicKey) : config.rsaPublicKey;
  const privateKey = options.privateKey ? config.normalizePem(options.privateKey) : config.rsaPrivateKey;
  if (!publicKey || !privateKey) return { ok: false, code: 'ERR_ENCRYPTION_CONFIG_MISSING' };

  try {
    const probe = crypto.randomBytes(32);
    const params = { padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' };
    const wrapped = crypto.publicEncrypt({ ...params, key: publicKey }, probe);
    const unwrapped = crypto.privateDecrypt({ ...params, key: privateKey }, wrapped);
    if (!unwrapped.equals(probe)) return { ok: false, code: 'ERR_ENCRYPTION_KEYPAIR_MISMATCH' };
    return { ok: true };
  } catch (_err) {
    return { ok: false, code: 'ERR_ENCRYPTION_KEYPAIR_MISMATCH' };
  }
}

module.exports = {
  MAGIC,
  VERSION,
  isEncrypted,
  encrypt,
  decrypt,
  getDevFallbackKeyPair,
  verifyKeyPair,
};
