const crypto = require('crypto');
const env = require('../config/env');

/**
 * Scan results waiting on "is this report yours?", so saying yes does not scan
 * the same file twice.
 *
 * Held in this process only: until the uploader answers, this may be another
 * person's health data, so it is never written anywhere and it expires on its
 * own. Losing an entry to a restart costs one extra scan, nothing more.
 *
 * Keyed by the file's contents as well as who sent it, so an entry can only
 * ever be applied to the file it was read from, for the same patient.
 */
const pending = new Map();

function keyFor({ userId, patientId, buffer }) {
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');
  return `${userId}:${patientId}:${digest}`;
}

function forget(key) {
  const entry = pending.get(key);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(key);
}

function holdExtraction(owner, extracted) {
  const key = keyFor(owner);
  forget(key);

  // A Map iterates in insertion order, so the first key is the oldest.
  if (pending.size >= env.ocr.pendingExtractionMax) forget(pending.keys().next().value);

  const timer = setTimeout(() => pending.delete(key), env.ocr.pendingExtractionTtlMs);
  timer.unref();
  pending.set(key, { extracted, timer });
}

/** The held scan for this file, or null. Single use: a second call finds nothing. */
function takeExtraction(owner) {
  const key = keyFor(owner);
  const entry = pending.get(key);
  if (!entry) return null;
  forget(key);
  return entry.extracted;
}

module.exports = { holdExtraction, takeExtraction };
