/**
 * Room Code Service for Consultation Pairing.
 *
 * Generates short, human-readable, unambiguous alphanumeric room codes,
 * manages expiry, and prevents brute-force join attempts.
 */

const crypto = require('crypto');
const config = require('../../config/consultAudio.config');

// Unambiguous characters (excluding 0/O, 1/I/L)
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

// In-memory rate limiting for join attempts: Map<codeOrIp, { count, resetAt }>
const failedAttempts = new Map();

/**
 * Generates a random alphanumeric room code.
 */
function generateRoomCode(length = config.roomCodeLength) {
  let code = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/**
 * Computes expiration timestamp based on config.roomCodeTtlMin.
 */
function getRoomCodeExpiry() {
  const expires = new Date();
  expires.setMinutes(expires.getMinutes() + config.roomCodeTtlMin);
  return expires.toISOString();
}

/**
 * Checks and records rate-limiting for join attempts.
 */
function checkRateLimit(key) {
  const now = Date.now();
  const entry = failedAttempts.get(key);

  if (entry && entry.resetAt > now) {
    if (entry.count >= config.maxJoinAttempts) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.resetAt - now) / 1000) };
    }
  } else {
    // Reset or new
    failedAttempts.set(key, { count: 0, resetAt: now + 5 * 60 * 1000 });
  }

  return { allowed: true };
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const entry = failedAttempts.get(key) || { count: 0, resetAt: now + 5 * 60 * 1000 };
  entry.count += 1;
  failedAttempts.set(key, entry);
}

function clearRateLimit(key) {
  failedAttempts.delete(key);
}

module.exports = {
  generateRoomCode,
  getRoomCodeExpiry,
  checkRateLimit,
  recordFailedAttempt,
  clearRateLimit,
};
