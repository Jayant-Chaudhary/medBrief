#!/usr/bin/env node
/**
 * Utility script to generate RSA Key Pair for Server-Side Envelope Encryption.
 *
 * Usage:
 *   node scripts/generateEncryptionKeys.js [--bits 4096]
 */

const crypto = require('crypto');

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return fallback;
}

const bits = parseInt(getArg('bits', '4096'), 10);
console.log(`Generating RSA ${bits}-bit keypair for storage envelope encryption...`);

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: bits,
  publicKeyEncoding: {
    type: 'spki',
    format: 'pem',
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'pem',
  },
});

const pubBase64 = Buffer.from(publicKey).toString('base64');
const privBase64 = Buffer.from(privateKey).toString('base64');

console.log('\n======================================================');
console.log('PUBLIC KEY (PEM):');
console.log(publicKey.trim());
console.log('\nPRIVATE KEY (PEM):');
console.log(privateKey.trim());
console.log('======================================================\n');
console.log('Add the following to your server/.env file:\n');
console.log(`STORAGE_ENCRYPTION_KEY_ID="v1"`);
console.log(`STORAGE_ENCRYPTION_RSA_PUBLIC_KEY="${pubBase64}"`);
console.log(`STORAGE_ENCRYPTION_RSA_PRIVATE_KEY="${privBase64}"`);
console.log('\n(Note: Keys are encoded as base64 strings for convenient single-line .env placement)');
