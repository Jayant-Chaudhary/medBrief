/**
 * Pure Function Module for Timeline Merging and Crosstalk Handling.
 *
 * Implements Phase 7 Requirements:
 * - Deterministic, pure function without database or network I/O.
 * - Normalized text comparison across Devanagari and Latin.
 * - Temporal overlap ratio calculation.
 * - Louder-device crosstalk deduplication based on avg_dbfs.
 * - Simultaneous speech overlap detection and tagging.
 * - Low-confidence flag assignment.
 * - Embedding explicit gap entries for audit continuity (never silent holes).
 * - Chronological sorting by session time.
 * - Duplicate rate statistics reporting.
 */

const config = require('../../config/consultAudio.config');

/**
 * Normalizes text for comparison:
 * - Unicode NFKC normalization (unifies Devanagari combining characters and full-width forms).
 * - Lowercase conversion (for scripts with case).
 * - Strips ASCII and Unicode punctuation (including Devanagari danda/double danda).
 * - Collapses whitespace.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()?"'’‘“”–—।॥]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extracts character bigrams from a normalized string.
 */
function getCharacterBigrams(str) {
  const bigrams = [];
  if (!str) return bigrams;
  if (str.length === 1) {
    bigrams.push(str);
    return bigrams;
  }
  for (let i = 0; i < str.length - 1; i++) {
    bigrams.push(str.slice(i, i + 2));
  }
  return bigrams;
}

/**
 * Calculates text similarity between two strings (0.0 to 1.0).
 * Combines token-level Dice and character-bigram Dice for robustness
 * across both Latin and Devanagari scripts against minor STT variations.
 */
function calculateTextSimilarity(textA, textB) {
  const normA = normalizeText(textA);
  const normB = normalizeText(textB);

  if (normA === normB) return 1.0;
  if (!normA || !normB) return 0.0;

  // 1. Token-level Dice similarity
  const tokensA = normA.split(' ').filter(Boolean);
  const tokensB = normB.split(' ').filter(Boolean);

  let tokenDice = 0.0;
  if (tokensA.length > 0 && tokensB.length > 0) {
    const countsB = new Map();
    for (const t of tokensB) {
      countsB.set(t, (countsB.get(t) || 0) + 1);
    }

    let commonTokens = 0;
    for (const t of tokensA) {
      const count = countsB.get(t) || 0;
      if (count > 0) {
        commonTokens++;
        countsB.set(t, count - 1);
      }
    }
    tokenDice = (2.0 * commonTokens) / (tokensA.length + tokensB.length);
  }

  // 2. Character bigram Dice similarity
  const bigramsA = getCharacterBigrams(normA);
  const bigramsB = getCharacterBigrams(normB);

  let charDice = 0.0;
  if (bigramsA.length > 0 && bigramsB.length > 0) {
    const countsB = new Map();
    for (const bg of bigramsB) {
      countsB.set(bg, (countsB.get(bg) || 0) + 1);
    }

    let commonBigrams = 0;
    for (const bg of bigramsA) {
      const count = countsB.get(bg) || 0;
      if (count > 0) {
        commonBigrams++;
        countsB.set(bg, count - 1);
      }
    }
    charDice = (2.0 * commonBigrams) / (bigramsA.length + bigramsB.length);
  }

  return Math.max(tokenDice, charDice);
}

/**
 * Computes temporal overlap share relative to the shorter segment (0.0 to 1.0).
 */
function calculateOverlapRatio(segA, segB) {
  const startA = Number(segA.start_ms ?? segA.startMs ?? 0);
  const endA = Number(segA.end_ms ?? segA.endMs ?? 0);
  const startB = Number(segB.start_ms ?? segB.startMs ?? 0);
  const endB = Number(segB.end_ms ?? segB.endMs ?? 0);

  const overlapStart = Math.max(startA, startB);
  const overlapEnd = Math.min(endA, endB);
  const overlapMs = Math.max(0, overlapEnd - overlapStart);

  const durationA = Math.max(1, endA - startA);
  const durationB = Math.max(1, endB - startB);
  const shorterDuration = Math.min(durationA, durationB);

  return overlapMs / shorterDuration;
}

/**
 * Clones and normalizes a segment to a consistent schema.
 */
function normalizeSegment(seg, defaultDevice) {
  const start = Number(seg.start_ms ?? seg.startMs ?? 0);
  const end = Number(seg.end_ms ?? seg.endMs ?? start);
  const device = seg.device || defaultDevice || 'unknown';
  const speaker = seg.speaker || device;

  let flags = Array.isArray(seg.flags) ? [...seg.flags] : [];

  return {
    id: seg.id || seg.segment_id || `seg-${device}-${start}`,
    segment_id: seg.id || seg.segment_id || `seg-${device}-${start}`,
    device,
    speaker,
    start_ms: start,
    startMs: start,
    end_ms: end,
    endMs: end,
    text: seg.text || '',
    provider: seg.provider || 'local',
    language: seg.language || null,
    confidence: seg.confidence !== undefined && seg.confidence !== null ? Number(seg.confidence) : null,
    avg_dbfs: seg.avg_dbfs !== undefined && seg.avg_dbfs !== null ? Number(seg.avg_dbfs) : null,
    flags,
    createdAt: seg.created_at || seg.createdAt || new Date().toISOString(),
  };
}

/**
 * Pure function: Merges doctor and patient segments, removes acoustic duplicates,
 * tags simultaneous speech overlaps, tags low-confidence utterances, and embeds explicit gap entries.
 *
 * @param {Array} doctorSegments
 * @param {Array} patientSegments
 * @param {Object} [options]
 * @param {number} [options.dedupeMinOverlap] - Min temporal overlap of shorter segment (0.0 - 1.0)
 * @param {number} [options.dedupeMinSimilarity] - Min text similarity (0.0 - 1.0)
 * @param {number} [options.lowConfidenceThreshold] - Threshold below which segment is tagged low_confidence
 * @param {Array} [options.gaps] - Interruption gaps from consult_audio_gaps
 * @param {Array} [options.failedChunks] - Failed chunks to format as gaps
 * @returns {Array} Merged timeline items with attached .stats property
 */
function mergeSegments(doctorSegments = [], patientSegments = [], options = {}) {
  const dedupeMinOverlap = options.dedupeMinOverlap ?? config.dedupeMinOverlap ?? 0.5;
  const dedupeMinSimilarity = options.dedupeMinSimilarity ?? config.dedupeMinSimilarity ?? 0.8;
  const lowConfidenceThreshold = options.lowConfidenceThreshold ?? config.lowConfidenceThreshold ?? 0.65;
  const noiseConfidenceFloor = options.noiseConfidenceFloor ?? config.noiseConfidenceFloor ?? 0.25;
  const partialSimilarity = options.crosstalkPartialSimilarity ?? config.crosstalkPartialSimilarity ?? 0.25;
  const partialLoudnessDb = options.crosstalkPartialLoudnessDb ?? config.crosstalkPartialLoudnessDb ?? 6;
  const dominantLoudnessDb = options.crosstalkDominantLoudnessDb ?? config.crosstalkDominantLoudnessDb ?? 10;
  const gaps = options.gaps || [];
  const failedChunks = options.failedChunks || [];

  const allDoctor = (doctorSegments || []).map((s) => normalizeSegment(s, 'doctor'));
  const allPatient = (patientSegments || []).map((s) => normalizeSegment(s, 'patient'));

  const totalInputSegments = allDoctor.length + allPatient.length;

  // 0. Leave out segments the recogniser itself was almost certain were noise.
  const isNoise = (seg) => seg.confidence !== null && seg.confidence < noiseConfidenceFloor;
  const normDoctor = allDoctor.filter((s) => !isNoise(s));
  const normPatient = allPatient.filter((s) => !isNoise(s));
  const noiseSuppressedCount = totalInputSegments - normDoctor.length - normPatient.length;

  // 1. Tag low-confidence segments
  for (const seg of [...normDoctor, ...normPatient]) {
    if (seg.confidence !== null && seg.confidence < lowConfidenceThreshold) {
      if (!seg.flags.includes('low_confidence')) {
        seg.flags.push('low_confidence');
      }
    }
  }

  // 2. Crosstalk Deduplication & Simultaneous Speech Overlap Evaluation
  const removedIds = new Set();
  let duplicateCount = 0;
  let overlapCount = 0;

  for (const dSeg of normDoctor) {
    for (const pSeg of normPatient) {
      if (removedIds.has(dSeg.id) || removedIds.has(pSeg.id)) continue;

      const overlapRatio = calculateOverlapRatio(dSeg, pSeg);
      if (overlapRatio >= dedupeMinOverlap) {
        const similarity = calculateTextSimilarity(dSeg.text, pSeg.text);

        const dLoudness = dSeg.avg_dbfs ?? -100;
        const pLoudness = pSeg.avg_dbfs ?? -100;
        const loudnessDiff = Math.abs(dLoudness - pLoudness);

        // Acoustic bleed / echo detection:
        // 1. Text is very similar (>= dedupeMinSimilarity), OR
        // 2. Partial text similarity (>= 0.25) AND noticeable loudness difference (>= 6 dBFS), OR
        // 3. Substantial loudness difference (>= 10 dBFS) during high overlap (>= 0.5) where the quieter mic
        //    picked up muffled acoustic bleed from the other device in the same room.
        const isAcousticBleed =
          similarity >= dedupeMinSimilarity ||
          (similarity >= partialSimilarity && loudnessDiff >= partialLoudnessDb) ||
          (loudnessDiff >= dominantLoudnessDb && overlapRatio >= dedupeMinOverlap);

        if (isAcousticBleed) {
          // Acoustic echo / crosstalk duplicate: retain the louder device's clearer recording
          if (dLoudness >= pLoudness) {
            // Doctor device was louder; drop quieter patient echo
            removedIds.add(pSeg.id);
          } else {
            // Patient device was louder; drop quieter doctor echo
            removedIds.add(dSeg.id);
          }
          duplicateCount++;
        } else {
          // Genuine simultaneous speech with different content: keep both and mark 'overlap'
          if (!dSeg.flags.includes('overlap')) {
            dSeg.flags.push('overlap');
          }
          if (!pSeg.flags.includes('overlap')) {
            pSeg.flags.push('overlap');
          }
          overlapCount++;
        }
      }
    }
  }

  // 3. Collect retained speech segments
  const mergedTimeline = [];
  for (const seg of normDoctor) {
    if (!removedIds.has(seg.id)) mergedTimeline.push(seg);
  }
  for (const seg of normPatient) {
    if (!removedIds.has(seg.id)) mergedTimeline.push(seg);
  }

  // 4. Embed explicit timeline gaps (never silent holes)
  for (const gap of gaps) {
    const startMs = Number(gap.start_ms ?? gap.startMs ?? 0);
    const durationMs = Number(gap.duration_ms ?? gap.durationMs ?? 0);
    const endMs = startMs + durationMs;
    const reasonCode = gap.reason_code || gap.reasonCode || 'unknown';
    const device = gap.device || 'unknown';

    mergedTimeline.push({
      id: `gap-${gap.gap_id || gap.id || `${device}-${startMs}`}`,
      segment_id: `gap-${gap.gap_id || gap.id || `${device}-${startMs}`}`,
      type: 'gap',
      device,
      speaker: device,
      start_ms: startMs,
      startMs: startMs,
      end_ms: endMs,
      endMs: endMs,
      text: `[Audio gap: ${reasonCode}]`,
      reason_code: reasonCode,
      reasonCode: reasonCode,
      flags: ['gap', reasonCode],
      createdAt: gap.received_at || new Date().toISOString(),
    });
  }

  // 5. Embed failed chunk gaps
  for (const chunk of failedChunks) {
    const startMs = Number(chunk.start_ms ?? chunk.startMs ?? 0);
    const durationMs = Number(chunk.duration_ms ?? chunk.durationMs ?? 0);
    const endMs = startMs + durationMs;
    const device = chunk.device || 'unknown';

    mergedTimeline.push({
      id: `failed-chunk-${chunk.id || `${device}-${chunk.seq}`}`,
      segment_id: `failed-chunk-${chunk.id || `${device}-${chunk.seq}`}`,
      type: 'gap',
      device,
      speaker: device,
      start_ms: startMs,
      startMs: startMs,
      end_ms: endMs,
      endMs: endMs,
      text: '[Audio chunk failed to transcribe]',
      reason_code: 'chunk_failed',
      reasonCode: 'chunk_failed',
      flags: ['gap', 'chunk_failed'],
      createdAt: chunk.received_at || new Date().toISOString(),
    });
  }

  // 6. Chronological sort by session time
  mergedTimeline.sort((a, b) => {
    if (a.start_ms !== b.start_ms) {
      return a.start_ms - b.start_ms;
    }
    return a.end_ms - b.end_ms;
  });

  // 7. Calculate duplicate rate stats
  const duplicateRate = totalInputSegments > 0 ? duplicateCount / totalInputSegments : 0;
  mergedTimeline.stats = {
    totalInputSegments,
    retainedSegments: mergedTimeline.filter((item) => item.type !== 'gap').length,
    duplicateCount,
    noiseSuppressedCount,
    overlapCount,
    gapCount: gaps.length + failedChunks.length,
    duplicateRate: Number(duplicateRate.toFixed(4)),
  };

  return mergedTimeline;
}

module.exports = {
  mergeSegments,
  normalizeText,
  calculateTextSimilarity,
  calculateOverlapRatio,
};
