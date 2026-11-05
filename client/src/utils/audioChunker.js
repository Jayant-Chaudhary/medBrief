/**
 * Pure Function Audio Chunker.
 *
 * Implements deterministic chunk-cutting logic and silence checks
 * based on consultation pipeline rules (min 15s, pause 500ms, hard cap 25s, -45 dBFS).
 *
 * Fully decoupled from the DOM and Web Audio APIs for fast unit testing.
 */

export const DEFAULT_CHUNKER_CONFIG = {
  chunkMinMs: 15000,     // 15 seconds
  chunkHardCapMs: 25000, // 25 seconds
  pauseMs: 500,          // 500 ms continuous silence required to cut
  silenceDbfs: -45,      // -45 dBFS considered silence
};

/**
 * Evaluates whether an active recording chunk should be cut.
 *
 * @param {Object} params
 * @param {Array<{timestampMs: number, dbfs: number}>} params.samples - Loudness samples for current chunk.
 * @param {number} params.chunkStartMs - Timestamp when current chunk started.
 * @param {number} params.currentMs - Current timestamp.
 * @param {Object} [params.config] - Optional config overrides.
 * @returns {{shouldCut: boolean, reason: 'hard_cap'|'pause'|null, cutMs: number|null}}
 */
export function evaluateChunkBoundary({
  samples = [],
  chunkStartMs = 0,
  currentMs,
  config = {},
}) {
  const mergedConfig = { ...DEFAULT_CHUNKER_CONFIG, ...config };
  const elapsedMs = Math.max(0, currentMs - chunkStartMs);

  // Rule 1: Hard Cap (25 seconds) — must cut regardless of speech
  if (elapsedMs >= mergedConfig.chunkHardCapMs) {
    return {
      shouldCut: true,
      reason: 'hard_cap',
      cutMs: currentMs,
    };
  }

  // Rule 2: Minimum duration (15 seconds) not yet reached
  if (elapsedMs < mergedConfig.chunkMinMs) {
    return {
      shouldCut: false,
      reason: null,
      cutMs: null,
    };
  }

  // Rule 3: After chunkMinMs, look for a pause of at least pauseMs
  if (!samples || samples.length === 0) {
    return {
      shouldCut: false,
      reason: null,
      cutMs: null,
    };
  }

  // Count backwards from latest sample to find consecutive silence duration
  let silenceDurationMs = 0;
  for (let i = samples.length - 1; i >= 0; i--) {
    const s = samples[i];
    if (s.dbfs <= mergedConfig.silenceDbfs) {
      const prevTime = i > 0 ? samples[i - 1].timestampMs : chunkStartMs;
      silenceDurationMs += Math.max(0, s.timestampMs - prevTime);
      if (silenceDurationMs >= mergedConfig.pauseMs) {
        return {
          shouldCut: true,
          reason: 'pause',
          cutMs: currentMs,
        };
      }
    } else {
      // Encountered vocal speech; pause was broken
      break;
    }
  }

  return {
    shouldCut: false,
    reason: null,
    cutMs: null,
  };
}

/**
 * Checks whether an array of loudness samples constitutes a silent chunk.
 *
 * @param {Array<{timestampMs: number, dbfs: number}>} samples
 * @param {number} [silenceDbfs=-45]
 * @returns {boolean} True if chunk is deemed silent.
 */
export function isChunkSilent(samples = [], silenceDbfs = DEFAULT_CHUNKER_CONFIG.silenceDbfs) {
  if (!samples || samples.length === 0) return true;

  let totalDbfs = 0;
  let hasVoice = false;

  for (const s of samples) {
    const dbfs = Number(s.dbfs);
    if (!isNaN(dbfs)) {
      totalDbfs += dbfs;
      if (dbfs > silenceDbfs) {
        hasVoice = true;
      }
    }
  }

  const avgDbfs = totalDbfs / samples.length;
  return !hasVoice || avgDbfs <= silenceDbfs;
}

/**
 * Calculates RMS and dBFS from raw PCM or Web Audio analyser time-domain byte array.
 *
 * @param {Uint8Array} byteData - Values between 0 and 255 (128 is zero).
 * @returns {{rms: number, dbfs: number}}
 */
export function calculateLoudnessFromByteData(byteData) {
  if (!byteData || byteData.length === 0) {
    return { rms: 0, dbfs: -100 };
  }

  let sumSquares = 0;
  for (let i = 0; i < byteData.length; i++) {
    // Center around 0 (-1.0 to 1.0)
    const norm = (byteData[i] - 128) / 128.0;
    sumSquares += norm * norm;
  }

  const rms = Math.sqrt(sumSquares / byteData.length);
  // Prevent log(0)
  const dbfs = rms > 0.00001 ? Math.max(-100, 20 * Math.log10(rms)) : -100;

  return { rms, dbfs };
}
