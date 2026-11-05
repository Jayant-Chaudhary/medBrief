/**
 * Unit Tests for Storage Envelope Encryption Service
 */

const crypto = require('crypto');
const storageEncryption = require('../../services/crypto/storageEncryption.service');

describe('Storage Envelope Encryption Service', () => {
  let testKeyPair;

  beforeAll(() => {
    testKeyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  });

  describe('isEncrypted', () => {
    test('returns false for null, undefined, or empty buffer', () => {
      expect(storageEncryption.isEncrypted(null)).toBe(false);
      expect(storageEncryption.isEncrypted(undefined)).toBe(false);
      expect(storageEncryption.isEncrypted(Buffer.alloc(0))).toBe(false);
      expect(storageEncryption.isEncrypted(Buffer.from('RIFF'))).toBe(false);
      expect(storageEncryption.isEncrypted('%PDF-1.5')).toBe(false);
    });

    test('returns true for buffer starting with ENCR', () => {
      const encrypted = storageEncryption.encrypt(Buffer.from('sample audio content'), {
        publicKey: testKeyPair.publicKey,
      });
      expect(storageEncryption.isEncrypted(encrypted)).toBe(true);
    });
  });

  describe('encrypt and decrypt round-trip', () => {
    test('encrypts and decrypts text string correctly', () => {
      const plaintext = 'Patient vitals: BP 120/80, HR 72';
      const encrypted = storageEncryption.encrypt(plaintext, {
        publicKey: testKeyPair.publicKey,
        keyId: 'test-v1',
      });

      expect(storageEncryption.isEncrypted(encrypted)).toBe(true);
      expect(encrypted.toString('utf8')).not.toContain('Patient vitals');

      const decrypted = storageEncryption.decrypt(encrypted, {
        privateKey: testKeyPair.privateKey,
      });
      expect(decrypted.toString('utf8')).toBe(plaintext);
    });

    test('encrypts and decrypts binary buffer (synthetic audio/pdf)', () => {
      // 64 KB synthetic binary payload
      const binaryPayload = crypto.randomBytes(65536);
      const encrypted = storageEncryption.encrypt(binaryPayload, {
        publicKey: testKeyPair.publicKey,
      });

      expect(encrypted.length).toBeGreaterThan(binaryPayload.length);

      const decrypted = storageEncryption.decrypt(encrypted, {
        privateKey: testKeyPair.privateKey,
      });
      expect(decrypted.equals(binaryPayload)).toBe(true);
    });

    test('handles empty buffer payload', () => {
      const empty = Buffer.alloc(0);
      const encrypted = storageEncryption.encrypt(empty, {
        publicKey: testKeyPair.publicKey,
      });

      expect(storageEncryption.isEncrypted(encrypted)).toBe(true);

      const decrypted = storageEncryption.decrypt(encrypted, {
        privateKey: testKeyPair.privateKey,
      });
      expect(decrypted.length).toBe(0);
    });
  });

  describe('tamper detection and authentication', () => {
    test('fails if ciphertext is modified (bit-flip)', () => {
      const plaintext = Buffer.from('Confidential Consultation Audio Chunk');
      const encrypted = storageEncryption.encrypt(plaintext, {
        publicKey: testKeyPair.publicKey,
      });

      // Flip the last byte of ciphertext
      encrypted[encrypted.length - 1] ^= 0xff;

      expect(() => {
        storageEncryption.decrypt(encrypted, {
          privateKey: testKeyPair.privateKey,
        });
      }).toThrow();

      try {
        storageEncryption.decrypt(encrypted, {
          privateKey: testKeyPair.privateKey,
        });
      } catch (err) {
        expect(err.code).toBe('ERR_DECRYPT_AUTHENTICATION_FAILED');
      }
    });

    test('fails if decrypted with wrong RSA private key', () => {
      const otherKeyPair = crypto.generateKeyPairSync('rsa', {
        modulusLength: 2048,
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      });

      const encrypted = storageEncryption.encrypt('Top secret data', {
        publicKey: testKeyPair.publicKey,
      });

      expect(() => {
        storageEncryption.decrypt(encrypted, {
          privateKey: otherKeyPair.privateKey,
        });
      }).toThrow();

      try {
        storageEncryption.decrypt(encrypted, {
          privateKey: otherKeyPair.privateKey,
        });
      } catch (err) {
        expect(err.code).toBe('ERR_KEY_UNWRAP_FAILED');
      }
    });

    test('fails on truncated envelope payload', () => {
      const encrypted = storageEncryption.encrypt('Some file data', {
        publicKey: testKeyPair.publicKey,
      });

      const truncated = encrypted.subarray(0, 15);
      expect(() => {
        storageEncryption.decrypt(truncated, {
          privateKey: testKeyPair.privateKey,
        });
      }).toThrow();

      try {
        storageEncryption.decrypt(truncated, {
          privateKey: testKeyPair.privateKey,
        });
      } catch (err) {
        expect(err.code).toBe('ERR_ENVELOPE_TRUNCATED');
      }
    });

    test('fails on unsupported version or cipher suite', () => {
      const encrypted = storageEncryption.encrypt('Version test', {
        publicKey: testKeyPair.publicKey,
      });

      // Modify version (byte offset 4)
      const badVersion = Buffer.from(encrypted);
      badVersion[4] = 99;
      expect(() => {
        storageEncryption.decrypt(badVersion, { privateKey: testKeyPair.privateKey });
      }).toThrow('Unsupported envelope version');

      // Modify suite ID (byte offset 5)
      const badSuite = Buffer.from(encrypted);
      badSuite[5] = 99;
      expect(() => {
        storageEncryption.decrypt(badSuite, { privateKey: testKeyPair.privateKey });
      }).toThrow('Unsupported cipher suite ID');
    });

    test('auto-uses ephemeral keypair in test/dev environment if options omitted', () => {
      const encrypted = storageEncryption.encrypt('Dev fallback plaintext');
      expect(storageEncryption.isEncrypted(encrypted)).toBe(true);

      const decrypted = storageEncryption.decrypt(encrypted);
      expect(decrypted.toString('utf8')).toBe('Dev fallback plaintext');
    });
  });

  describe('legacy unencrypted fallback', () => {
    test('returns unencrypted buffer when allowLegacyFallback is true', () => {
      const rawPdf = Buffer.from('%PDF-1.4 sample content');
      const result = storageEncryption.decrypt(rawPdf, {
        allowLegacyFallback: true,
      });
      expect(result.equals(rawPdf)).toBe(true);
    });

    test('throws ERR_NOT_ENCRYPTED when allowLegacyFallback is false', () => {
      const rawPdf = Buffer.from('%PDF-1.4 sample content');
      expect(() => {
        storageEncryption.decrypt(rawPdf, {
          allowLegacyFallback: false,
        });
      }).toThrow();

      try {
        storageEncryption.decrypt(rawPdf, {
          allowLegacyFallback: false,
        });
      } catch (err) {
        expect(err.code).toBe('ERR_NOT_ENCRYPTED');
      }
    });
  });
});
