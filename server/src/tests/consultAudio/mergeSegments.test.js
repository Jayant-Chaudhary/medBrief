/**
 * Unit Tests for Timeline Merging and Crosstalk Handling (Phase 7).
 *
 * Verifies:
 * 1. Pure function behavior with zero network/database I/O.
 * 2. Text normalization and similarity across Latin and Devanagari.
 * 3. Quiet duplicate removal: louder device utterance retained, quieter echo dropped.
 * 4. Simultaneous speech: overlapping different sentences kept and flagged 'overlap'.
 * 5. Low-confidence segment tagging.
 * 6. Explicit gap entries embedded in the timeline (never silent holes).
 * 7. Consumption of shared cross-platform test fixtures (merge-cases.json).
 * 8. Accurate duplicate rate metric calculation.
 */

const fs = require('fs');
const path = require('path');
const {
  mergeSegments,
  normalizeText,
  calculateTextSimilarity,
  calculateOverlapRatio,
} = require('../../services/consultAudio/mergeSegments');

describe('Timeline Merging and Crosstalk Handling (Phase 7)', () => {
  describe('Text Normalization', () => {
    test('normalizes Latin text by lowercasing and stripping punctuation', () => {
      expect(normalizeText('Hello, Doctor! How are you today?')).toBe('hello doctor how are you today');
      expect(normalizeText('  Multiple   spaces   and "quotes" — ')).toBe('multiple spaces and quotes');
    });

    test('normalizes Devanagari script and strips danda punctuation', () => {
      expect(normalizeText('दवा खाने के बाद लेना है।')).toBe('दवा खाने के बाद लेना है');
      expect(normalizeText('नमस्ते॥ डॉक्टर साहब, कैसे हैं?')).toBe('नमस्ते डॉक्टर साहब कैसे हैं');
    });

    test('handles empty or non-string input safely', () => {
      expect(normalizeText('')).toBe('');
      expect(normalizeText(null)).toBe('');
      expect(normalizeText(undefined)).toBe('');
      expect(normalizeText(123)).toBe('');
    });
  });

  describe('Text Similarity Measure', () => {
    test('returns 1.0 for identical or case/punctuation-only variations', () => {
      expect(calculateTextSimilarity('Take this tablet.', 'take this tablet')).toBe(1.0);
      expect(calculateTextSimilarity('दवा खाने के बाद लें।', 'दवा खाने के बाद लें')).toBe(1.0);
    });

    test('returns high similarity (>= 0.8) for minor phonetic/word variations', () => {
      const sim = calculateTextSimilarity(
        'Good morning, how has your blood pressure been this week?',
        'Good morning how has your blood pressure been this week'
      );
      expect(sim).toBeGreaterThanOrEqual(0.8);
    });

    test('returns low similarity (< 0.8) for distinct sentences', () => {
      const sim = calculateTextSimilarity(
        'Let me check your blood pressure now.',
        'I felt very dizzy yesterday morning.'
      );
      expect(sim).toBeLessThan(0.8);
    });

    test('returns 0.0 when one or both strings are empty', () => {
      expect(calculateTextSimilarity('', 'hello')).toBe(0.0);
      expect(calculateTextSimilarity('', '')).toBe(1.0);
    });
  });

  describe('Temporal Overlap Calculation', () => {
    test('calculates correct overlap ratio relative to shorter segment', () => {
      // Shorter is segB (2000ms), overlap is 2000ms -> 1.0
      const segA = { start_ms: 1000, end_ms: 5000 };
      const segB = { start_ms: 2000, end_ms: 4000 };
      expect(calculateOverlapRatio(segA, segB)).toBeCloseTo(1.0);

      // Shorter is segD (2000ms), overlap is 1000ms -> 0.5
      const segC = { start_ms: 1000, end_ms: 4000 };
      const segD = { start_ms: 3000, end_ms: 5000 };
      expect(calculateOverlapRatio(segC, segD)).toBeCloseTo(0.5);

      // Disjoint segments -> 0.0
      const segE = { start_ms: 1000, end_ms: 2000 };
      const segF = { start_ms: 3000, end_ms: 4000 };
      expect(calculateOverlapRatio(segE, segF)).toBe(0.0);
    });
  });

  describe('Acceptance Criterion 1: Quiet Duplicate Removal', () => {
    test('drops quieter patient echo when doctor device is louder', () => {
      const doctorSegments = [
        {
          id: 'doc-1',
          device: 'doctor',
          start_ms: 1000,
          end_ms: 5000,
          text: 'How are your headaches this week?',
          avg_dbfs: -18.0,
          confidence: 0.95,
        },
      ];

      const patientSegments = [
        {
          id: 'pat-1',
          device: 'patient',
          start_ms: 1200,
          end_ms: 5100,
          text: 'How are your headaches this week',
          avg_dbfs: -35.0, // Quieter echo
          confidence: 0.90,
        },
      ];

      const merged = mergeSegments(doctorSegments, patientSegments);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('doc-1');
      expect(merged[0].device).toBe('doctor');
      expect(merged.stats.duplicateCount).toBe(1);
      expect(merged.stats.duplicateRate).toBe(0.5);
    });

    test('drops quieter doctor echo when patient device is louder', () => {
      const doctorSegments = [
        {
          id: 'doc-1',
          device: 'doctor',
          start_ms: 1200,
          end_ms: 4000,
          text: 'I took the medicine at night',
          avg_dbfs: -38.0, // Quieter echo on doctor device
          confidence: 0.88,
        },
      ];

      const patientSegments = [
        {
          id: 'pat-1',
          device: 'patient',
          start_ms: 1000,
          end_ms: 4100,
          text: 'I took the medicine at night',
          avg_dbfs: -20.0, // Patient spoke directly into phone
          confidence: 0.96,
        },
      ];

      const merged = mergeSegments(doctorSegments, patientSegments);

      expect(merged).toHaveLength(1);
      expect(merged[0].id).toBe('pat-1');
      expect(merged[0].device).toBe('patient');
      expect(merged.stats.duplicateCount).toBe(1);
    });
  });

  describe('Acceptance Criterion 2: Simultaneous Speech (Different Content)', () => {
    test('keeps both segments and adds overlap flag when utterances differ', () => {
      const doctorSegments = [
        {
          id: 'doc-2',
          device: 'doctor',
          start_ms: 5000,
          end_ms: 8000,
          text: 'Let me look at your hemoglobin results.',
          avg_dbfs: -20.0,
          confidence: 0.94,
          flags: [],
        },
      ];

      const patientSegments = [
        {
          id: 'pat-2',
          device: 'patient',
          start_ms: 5200,
          end_ms: 8100,
          text: 'I brought the test receipt from the clinic.',
          avg_dbfs: -22.0,
          confidence: 0.91,
          flags: [],
        },
      ];

      const merged = mergeSegments(doctorSegments, patientSegments);

      expect(merged).toHaveLength(2);
      expect(merged.map((s) => s.id)).toEqual(['doc-2', 'pat-2']);
      expect(merged[0].flags).toContain('overlap');
      expect(merged[1].flags).toContain('overlap');
      expect(merged.stats.overlapCount).toBe(1);
      expect(merged.stats.duplicateCount).toBe(0);
    });
  });

  describe('Acceptance Criterion 3: Explicit Gap Entries in Timeline', () => {
    test('interleaves consult_audio_gaps and failed chunks into chronological timeline', () => {
      const doctorSegments = [
        { id: 'doc-1', start_ms: 0, end_ms: 10000, text: 'First part of consultation' },
        { id: 'doc-2', start_ms: 25000, end_ms: 35000, text: 'Second part of consultation' },
      ];

      const gaps = [
        {
          gap_id: 'gap-uuid-1',
          device: 'patient',
          start_ms: 12000,
          duration_ms: 8000,
          reason_code: 'phone_call',
        },
      ];

      const failedChunks = [
        {
          id: 'chunk-fail-1',
          device: 'doctor',
          seq: 3,
          start_ms: 36000,
          duration_ms: 15000,
        },
      ];

      const merged = mergeSegments(doctorSegments, [], { gaps, failedChunks });

      expect(merged).toHaveLength(4);

      // Verify chronological ordering
      expect(merged[0].id).toBe('doc-1');
      expect(merged[1].type).toBe('gap');
      expect(merged[1].flags).toEqual(['gap', 'phone_call']);
      expect(merged[1].start_ms).toBe(12000);
      expect(merged[1].end_ms).toBe(20000);

      expect(merged[2].id).toBe('doc-2');
      expect(merged[3].type).toBe('gap');
      expect(merged[3].flags).toEqual(['gap', 'chunk_failed']);
      expect(merged[3].start_ms).toBe(36000);
    });
  });

  describe('Acceptance Criterion 4: Low-Confidence Tagging', () => {
    test('tags segments below configured threshold with low_confidence', () => {
      const segments = [
        { id: 's-1', start_ms: 1000, end_ms: 3000, text: 'Clear utterance', confidence: 0.92, flags: [] },
        { id: 's-2', start_ms: 4000, end_ms: 6000, text: 'Muffled speech', confidence: 0.45, flags: [] },
      ];

      const merged = mergeSegments(segments, [], { lowConfidenceThreshold: 0.65 });

      expect(merged[0].flags).not.toContain('low_confidence');
      expect(merged[1].flags).toContain('low_confidence');
    });
  });

  describe('Cross-Platform Synthetic Fixtures (merge-cases.json)', () => {
    test('passes all cases in merge-cases.json', () => {
      const fixturePath = path.join(__dirname, '../../../../tools/simulate-device/fixtures/merge-cases.json');
      const testCases = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

      for (const tc of testCases) {
        const merged = mergeSegments(tc.doctorSegments || [], tc.patientSegments || [], {
          gaps: tc.gaps || [],
        });

        if (tc.expectedRetainedIds) {
          const actualRetainedIds = merged.filter((item) => item.type !== 'gap').map((item) => item.id);
          expect(actualRetainedIds).toEqual(tc.expectedRetainedIds);
        }

        if (tc.expectedDuplicateCount !== undefined) {
          expect(merged.stats.duplicateCount).toBe(tc.expectedDuplicateCount);
        }

        if (tc.expectedOverlapFlags) {
          for (const expectedId of tc.expectedOverlapFlags) {
            const seg = merged.find((item) => item.id === expectedId);
            expect(seg.flags).toContain('overlap');
          }
        }

        if (tc.expectedFlags) {
          for (const [itemId, expectedFlagList] of Object.entries(tc.expectedFlags)) {
            const item = merged.find((i) => i.id === itemId);
            expect(item).toBeDefined();
            for (const f of expectedFlagList) {
              expect(item.flags).toContain(f);
            }
          }
        }
      }
    });
  });

  describe('Developer Metrics: Duplicate Rate Calculation', () => {
    test('correctly calculates and reports duplicate rate metrics', () => {
      const doctorSegments = [
        { id: 'd-1', start_ms: 0, end_ms: 4000, text: 'Hello how are you', avg_dbfs: -18 },
        { id: 'd-2', start_ms: 5000, end_ms: 9000, text: 'Take this pill after lunch', avg_dbfs: -19 },
      ];

      const patientSegments = [
        { id: 'p-1', start_ms: 200, end_ms: 4100, text: 'Hello how are you', avg_dbfs: -35 }, // Duplicate
        { id: 'p-2', start_ms: 10000, end_ms: 13000, text: 'I understand doctor', avg_dbfs: -22 },
      ];

      const merged = mergeSegments(doctorSegments, patientSegments);

      expect(merged.stats).toEqual({
        totalInputSegments: 4,
        retainedSegments: 3,
        duplicateCount: 1,
        noiseSuppressedCount: 0,
        overlapCount: 0,
        gapCount: 0,
        duplicateRate: 0.25, // 1 duplicate out of 4 total input segments = 25%
      });
    });
  });

  describe('noise confidence floor', () => {
    it('leaves near-certain noise out of the timeline and counts it', () => {
      const doctor = [
        { id: 'd1', start_ms: 0, end_ms: 2000, text: 'synthetic clear sentence', confidence: 0.8 },
        { id: 'd2', start_ms: 3000, end_ms: 5000, text: 'synthetic garbled sentence', confidence: 0.17 },
      ];
      const merged = mergeSegments(doctor, [], { noiseConfidenceFloor: 0.25 });
      expect(merged.map((s) => s.id)).toEqual(['d1']);
      expect(merged.stats.noiseSuppressedCount).toBe(1);
      expect(merged.stats.totalInputSegments).toBe(2);
    });

    it('keeps segments with unknown confidence', () => {
      const merged = mergeSegments([{ id: 'd1', start_ms: 0, end_ms: 1000, text: 'synthetic' }], []);
      expect(merged).toHaveLength(1);
      expect(merged.stats.noiseSuppressedCount).toBe(0);
    });
  });
});
