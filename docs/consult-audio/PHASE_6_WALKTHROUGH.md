# Phase 6 Walkthrough: End-of-Visit Orchestrator

**Date:** 2026-11-02  
**Feature:** Consultation Audio Pipeline — Phase 6: End-of-Visit Orchestrator  
**Status:** Completed and verified with automated test suites.

---

## 1. Summary of Changes

The End-of-Visit Orchestrator implements a reliable, time-boxed conclusion for consultation audio recordings, coordinating transition from `recording` $\rightarrow$ `ending` $\rightarrow$ `processing`:

1. **Time-Boxed Finish & Deadline Enforcement**:
   - Persists `end_deadline_at = now + END_DEADLINE_SEC` (default 15s) in `consult_sessions` when the doctor requests end (`POST /api/consults/:id/end`).
   - Sockets emit `end_requested { deadline_at }`.
   - In-memory timers monitor deadlines, supported by a periodic sweep (`orchestratorPollMs`) to prevent timer drift.

2. **Server Crash / Restart Resumption**:
   - On server startup (`server.listen`), the orchestrator queries all sessions in `ending` status.
   - If the deadline expired while the server was down, the session is immediately finalized to `processing`.
   - If the deadline is in the future, the remaining timer is scheduled.

3. **Completeness Check & Fast Path**:
   - Whenever a chunk is ingested, a final marker is recorded, or a chunk finishes transcription, `checkCompleteness(sessionId)` is evaluated.
   - If all expected chunks for all active devices have arrived and reached `status = 'transcribed'` (or `'silent'`), the session transitions to `processing` immediately without waiting for the deadline timer.

4. **Missing Chunks Recorded as Gaps**:
   - When a session finishes at the deadline, any sequence number $k \in [0, expected\_chunks - 1]$ that failed to upload is detected.
   - The orchestrator records an explicit timeline gap in `consult_audio_gaps` with `reason_code = 'missing_chunk'`, estimating timestamps from surrounding chunks.
   - Preserves audit trails truthfully without inventing silent audio or synthetic text.

5. **Incomplete Side Flagging**:
   - Devices missing chunks or without final markers before the deadline are flagged in `consult_sessions.incomplete_sides` (e.g. `['patient']`).
   - The orchestrator tags all segments belonging to that device with `'incomplete_side'` in their `flags` array.

6. **Doctor-Only Mode**:
   - If `patient_required = false` and no patient device joined, the orchestrator waits only for the doctor device.

7. **Late Chunk Handling**:
   - Chunks arriving after the session moves to `processing` (or `draft_ready`) are accepted (`is_late = true`) and transcribed.
   - Upon transcription, the orchestrator tags the segment with flag `['late']`, updates `consult_sessions.draft_outdated = true`, and emits a `transcript_updated` Socket.IO push.

8. **Privacy and Security Compliance**:
   - Adheres strictly to the standing rules: zero audio data, transcript text, patient names, or clinical values in orchestrator logs or socket push events (metadata and error codes only).

---

## 2. Files Modified & Created

### New Files
- `supabase/migrations/20261102000001_consult_audio_orchestration.sql`: Adds `incomplete_sides` and `draft_outdated` columns to `consult_sessions`, plus `'missing_chunk'` reason code in `consult_audio_gaps`.
- `server/src/services/consultAudio/orchestrator.service.js`: The end-of-visit orchestrator service.
- `server/src/tests/consultAudio/orchestrator.test.js`: Phase 6 acceptance and unit test suite.
- `docs/consult-audio/PHASE_6_IMPLEMENTATION_PLAN.md`: Approved implementation plan.
- `docs/consult-audio/PHASE_6_WALKTHROUGH.md`: This walkthrough.

### Modified Files
- `server/src/config/consultAudio.config.js`: Added `orchestratorPollMs`.
- `server/.env.example`: Added `ORCHESTRATOR_POLL_MS=1000`.
- `server/src/services/consultAudio/gap.service.js`: Added `'missing_chunk'` to `ALLOWED_REASON_CODES`.
- `server/src/services/consultAudio/socket.service.js`: Added `emitTranscriptUpdated`.
- `server/src/services/consultAudio/session.service.js`: Integrated orchestrator into `endConsultation`, exposed `incompleteSides` and `draftOutdated` in `getSessionState` and `getSessionTranscript`.
- `server/src/services/consultAudio/chunkIngest.service.js`: Integrated `checkCompleteness` call on chunk and final marker receipt during `ending`.
- `server/src/services/consultAudio/transcriptionWorker.js`: Integrated `checkCompleteness` on chunk transcription completion and `handleLateChunkTranscribed` for late chunks.
- `server/src/app.js`: Started orchestrator on server startup and cleanly stopped on graceful shutdown.

---

## 3. Test Evidence

### Backend Orchestrator Test Suite
```bash
$ npm test -- src/tests/consultAudio/orchestrator.test.js

PASS src/tests/consultAudio/orchestrator.test.js
  Consultation End-of-Visit Orchestrator (Phase 6)
    Fast Path: Early Completion Before Deadline
      ✓ transitions immediately to processing when all expected chunks are transcribed (3 ms)
    Acceptance Criterion 1: Simulated Slow Patient Device
      ✓ deadline expires, marks patient incomplete, and records missing sequence gaps (2 ms)
    Acceptance Criterion 2: Server Restart Resumption
      ✓ immediately finalizes sessions whose deadline expired while server was offline (1 ms)
      ✓ schedules timer for sessions whose deadline is still in the future
    Acceptance Criterion 3: Late Chunk Updates Transcript & Flags Draft Outdated
      ✓ marks consult_sessions draft_outdated=true and adds late flag to segments
    Doctor-Only Mode
      ✓ waits only for doctor device when patient_required is false and no patient joined (1 ms)
    Privacy & Safety Compliance
      ✓ orchestrator logs and emits strictly metadata and error codes only (1 ms)

Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Snapshots:   0 total
Time:        0.381 s
```

### Full Consultation Audio Suite
```bash
$ npm test -- src/tests/consultAudio/

Test Suites: 1 skipped, 11 passed, 11 of 12 total
Tests:       5 skipped, 122 passed, 127 total
Snapshots:   0 total
Time:        1.177 s
```

### Full Server Test Suite
```bash
$ npm test

Test Suites: 1 skipped, 34 passed, 34 of 35 total
Tests:       5 skipped, 579 passed, 584 total
Snapshots:   0 total
Time:        1.915 s
```

### Client Unit Tests
```bash
$ cd client && npm test

Test Files  3 passed (3)
Tests       22 passed (22)
```

### Mobile Flutter Audio Tests
```bash
$ cd mobile && flutter test test/consult_audio_flow_test.dart test/consult_audio_privacy_test.dart test/consult_audio_chunker_test.dart test/consult_audio_adts_test.dart test/consult_audio_queue_test.dart test/consult_audio_repository_test.dart

00:00 +37: All tests passed!
```

---

## 4. Known Gaps & Next Steps

1. **Supabase Remote Migration**:
   - `20261102000001_consult_audio_orchestration.sql` should be applied to remote database environments when deploying.
2. **Phase 7: Merge and Crosstalk Handling**:
   - Phase 6 successfully orchestrates arrival in `processing` and exposes segments, missing sequence gaps, and incomplete sides.
   - Phase 7 will implement the pure function `mergeSegments(doctorSegments, patientSegments, config)` to deduplicate crosstalk and construct the unified timeline.
