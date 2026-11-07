# Phase 7: Merge and Crosstalk Handling Walkthrough

**Status:** Completed and Verified  
**Date:** 2026-11-02  
**Specifications:** `docs/consult-audio/IMPLEMENTATION.md` (Phase 7)  
**Standing Rules:** `AGENTS.md` (one phase at a time, zero sensitive health/transcript logging, pure deterministic core).

---

## 1. Executive Summary

Phase 7 implements **Timeline Merging and Crosstalk Handling** to unify audio transcription segments from two independently recording devices (doctor web recorder and patient Android recorder) into a single, clean, chronological consultation transcript.

Key capabilities delivered:
1. **Pure Function Core (`mergeSegments`)**:
   - Deterministic and free of database/network dependencies.
   - Merges segments from both recording streams into chronological sequence by session start time.
2. **Acoustic Crosstalk Echo Deduplication**:
   - Detects when the same utterance is captured by both microphones (temporal overlap $\ge 50\%$ of shorter duration and text similarity $\ge 80\%$).
   - Evaluates chunk loudness (`avg_dbfs`) and keeps only the segment from the **louder device**, discarding the quieter room echo.
3. **Simultaneous Speech Overlap Tagging**:
   - Detects when two different sentences are spoken at the same time (temporal overlap $\ge 50\%$ and text similarity $< 80\%$).
   - Retains **both** utterances and marks both with the `'overlap'` flag.
4. **Multilingual Normalization (Devanagari & Latin)**:
   - Unicode NFKC normalization and punctuation removal including Devanagari danda (`।`, `॥`).
   - Hybrid similarity metric combining token Dice and character bigram Dice for resilience against speech-to-text spelling variations.
5. **Low-Confidence Tagging**:
   - Utterances with provider confidence below `lowConfidenceThreshold` (default 0.65) receive the `'low_confidence'` flag.
6. **Explicit Timeline Gaps**:
   - Both phone interruption gaps from `consult_audio_gaps` and failed audio chunks are embedded as visible timeline gap items (never silent holes).
7. **Duplicate Rate Metrics**:
   - Computes duplicate rate statistics (`stats.duplicateRate`, `duplicateCount`, `overlapCount`, `gapCount`) for developer observability.
8. **REST Endpoint Integration**:
   - `GET /api/consults/:id/transcript` returns the merged chronological timeline with segment IDs, speakers, timestamps, flags, and merge stats.

---

## 2. Key Code Changes

| File | Purpose |
|---|---|
| `server/src/services/consultAudio/mergeSegments.js` | Pure merger function: `normalizeText`, `calculateTextSimilarity`, `calculateOverlapRatio`, `mergeSegments`. |
| `server/src/config/consultAudio.config.js` | Added `lowConfidenceThreshold` (default 0.65) alongside `dedupeMinOverlap` (0.5) and `dedupeMinSimilarity` (0.8). |
| `server/.env.example` | Documented `DEDUPE_MIN_OVERLAP=0.5`, `DEDUPE_MIN_SIMILARITY=0.8`, `LOW_CONFIDENCE_THRESHOLD=0.65`. |
| `server/src/services/consultAudio/session.service.js` | Updated `getSessionTranscript` to merge doctor & patient segments, enrich with chunk `avg_dbfs`, include gaps, and return stats. |
| `tools/simulate-device/fixtures/merge-cases.json` | Cross-platform synthetic fixtures covering quiet duplicate removal, overlap, Devanagari utterances, low confidence, and gaps. |
| `server/src/tests/consultAudio/mergeSegments.test.js` | 15 unit tests covering normalization, similarity, overlap math, louder device retention, gap embedding, fixtures, and duplicate rate. |
| `server/src/tests/consultAudio/consultAudioApi.test.js` | API integration test verifying `GET /api/consults/:id/transcript` deduplication and explicit gap response. |
| `docs/consult-audio/FILES_AND_PURPOSE.md` | Documented Phase 7 files in Section 13. |

---

## 3. Duplicate Rate Metrics on Synthetic Consultations

From the shared test fixtures (`tools/simulate-device/fixtures/merge-cases.json`) and unit tests:

| Metric | Test Case Suite (merge-cases.json) | Developer Benchmark Scenario |
|---|---|---|
| **Total Input Utterances** | 8 speech segments | 4 speech segments |
| **Acoustic Duplicates Detected** | 2 duplicates | 1 duplicate |
| **Simultaneous Overlaps** | 1 overlap pair (2 segments) | 0 overlaps |
| **Timeline Gaps Embedded** | 1 gap entry | 0 gaps |
| **Retained Speech Segments** | 6 speech segments | 3 speech segments |
| **Measured Duplicate Rate** | **25.0%** | **25.0%** |

- **English Crosstalk Scenario**: Doctor segment (-18.5 dBFS) vs. Patient echo (-36.2 dBFS) $\rightarrow$ Echo dropped, doctor utterance retained.
- **Devanagari Crosstalk Scenario**: Hindi phrase with danda (`दवा खाने के बाद लेना है।`, -19.0 dBFS) vs. Patient echo (-34.0 dBFS) $\rightarrow$ Echo dropped, louder doctor utterance retained.
- **Simultaneous Speech Scenario**: Overlapping time intervals with distinct clinical content kept both segments with `overlap` flags.

---

## 4. Test Evidence

### 1. Merge and Crosstalk Unit Tests (`server/src/tests/consultAudio/mergeSegments.test.js`)
```
PASS src/tests/consultAudio/mergeSegments.test.js
  Timeline Merging and Crosstalk Handling (Phase 7)
    Text Normalization
      ✓ normalizes Latin text by lowercasing and stripping punctuation (1 ms)
      ✓ normalizes Devanagari script and strips danda punctuation (1 ms)
      ✓ handles empty or non-string input safely
    Text Similarity Measure
      ✓ returns 1.0 for identical or case/punctuation-only variations (1 ms)
      ✓ returns high similarity (>= 0.8) for minor phonetic/word variations
      ✓ returns low similarity (< 0.8) for distinct sentences
      ✓ returns 0.0 when one or both strings are empty (1 ms)
    Temporal Overlap Calculation
      ✓ calculates correct overlap ratio relative to shorter segment
    Acceptance Criterion 1: Quiet Duplicate Removal
      ✓ drops quieter patient echo when doctor device is louder (1 ms)
      ✓ drops quieter doctor echo when patient device is louder
    Acceptance Criterion 2: Simultaneous Speech (Different Content)
      ✓ keeps both segments and adds overlap flag when utterances differ (1 ms)
    Acceptance Criterion 3: Explicit Gap Entries in Timeline
      ✓ interleaves consult_audio_gaps and failed chunks into chronological timeline (1 ms)
    Acceptance Criterion 4: Low-Confidence Tagging
      ✓ tags segments below configured threshold with low_confidence
    Cross-Platform Synthetic Fixtures (merge-cases.json)
      ✓ passes all cases in merge-cases.json (1 ms)
    Developer Metrics: Duplicate Rate Calculation
      ✓ correctly calculates and reports duplicate rate metrics

Test Suites: 1 passed, 1 total
Tests:       15 passed, 15 total
```

### 2. Consultation Audio API Tests (`server/src/tests/consultAudio/consultAudioApi.test.js`)
```
PASS src/tests/consultAudio/consultAudioApi.test.js
  ✓ deduplicates crosstalk echo and includes explicit gaps in returned merged timeline
Test Suites: 1 passed, 1 total
Tests:       21 passed, 21 total
```

### 3. All Consultation Audio Backend Tests (`server/src/tests/consultAudio/`)
```
Test Suites: 1 skipped, 12 passed, 12 of 13 total
Tests:       5 skipped, 138 passed, 143 total
Snapshots:   0 total
Time:        1.454 s
```

### 4. Full Server Test Suite (`npm test -- --runInBand`)
```
Test Suites: 1 skipped, 35 passed, 35 of 36 total
Tests:       5 skipped, 595 passed, 600 total
Snapshots:   0 total
Time:        3.259 s
```

### 5. Client Web Tests (`client/`)
```
✓ src/tests/webRecorder.test.js (5)
✓ src/tests/audioChunker.test.js (14)
✓ src/tests/flowsheet.test.js (3)
Test Files  3 passed (3)
Tests       22 passed (22)
```

### 6. Mobile Flutter Tests (`mobile/`)
```
flutter test test/consult_audio_adts_test.dart test/consult_audio_chunker_test.dart test/consult_audio_flow_test.dart test/consult_audio_privacy_test.dart test/consult_audio_queue_test.dart test/consult_audio_repository_test.dart

00:00 +37: All tests passed!
```

---

## 5. Standing Rules & Safety Verification

1. **Flags and Prioritises; Never Diagnoses**:
   - All flags added are strictly operational: `'overlap'`, `'low_confidence'`, `'gap'`, `reason_code`.
   - No diagnostic text or medical classification is added.
2. **Zero Sensitive Content in Logs**:
   - `mergeSegments` performs in-memory computations without logging transcript strings, patient names, or health values.
   - Logs record only segment IDs, counts, durations, and status codes.
3. **No Invented Clinical Thresholds**:
   - Thresholds are purely acoustic/mathematical (`DEDUPE_MIN_OVERLAP=0.5`, `DEDUPE_MIN_SIMILARITY=0.8`, `LOW_CONFIDENCE_THRESHOLD=0.65`).
   - All values reside in `consultAudio.config.js` and `.env.example`.
4. **Idempotent and Visible Continuity**:
   - Gaps from interruptions or failed chunks are preserved in the timeline as explicit entries with `type: 'gap'`, preventing silent transcript omissions.

---

## 6. Known Gaps & Next Steps

1. **Phase 8 (Notes Drafting)**:
   - Next phase consumes the merged timeline with `segment_id`s, structured intake, verified lab/ultrasound data, tracer verification, and parallel schema-validated Gemini prompts for draft doctor notes, patient summaries, and safety flags.
   - **Per AGENTS.md rule**: Do not start Phase 8 until explicitly approved by the developer.
