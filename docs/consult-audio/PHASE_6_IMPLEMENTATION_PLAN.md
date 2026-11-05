# Phase 6: End-of-Visit Orchestrator Implementation Plan

**Status:** Proposed — awaiting developer approval before editing code.  
**Specification:** `docs/consult-audio/IMPLEMENTATION.md` (Phase 6)  
**Ground Rules:** `AGENTS.md` (one phase at a time, planning mode first, privacy & safety rules strictly enforced).

---

## 1. Goal & Requirements

Build the **End-of-Visit Orchestrator** to guarantee a reliable, time-boxed conclusion when a doctor ends a consultation:

1. **Time-Boxed Finish**: When a doctor requests end (`POST /api/consults/:id/end`), the session enters `ending` and persists `end_deadline_at = now + END_DEADLINE_SEC` (default 15s). Sockets push `end_requested { deadline_at }`.
2. **Server Restart Resumption**: Persisted deadlines survive server restarts or worker crashes. On startup, the server inspects all sessions in `ending` status and finishes them on time.
3. **Completeness Check**: Compares expected chunks declared in device final markers (`expected_chunks`) against received and transcribed chunks.
4. **Missing Chunks as Gaps**: Any missing sequence number between 0 and `expected_chunks - 1` is recorded as an explicit timeline gap in `consult_audio_gaps` with `reason_code = 'missing_chunk'`, preserving the audit trail without inventing silence.
5. **Timed Transition to `processing`**: Moves session to `processing` when:
   - **Fast path:** All expected chunks from all active devices are transcribed before the deadline.
   - **Deadline path:** The deadline expires (`now >= end_deadline_at`), even if chunks are missing or untranscribed.
6. **Incomplete Side Flagging**: If a device failed to upload all expected chunks before the deadline, that device side is marked incomplete in `consult_sessions.incomplete_sides` (e.g. `['patient']`) and attached to segment flags (`incomplete_side`).
7. **Doctor-Only Mode**: If `patient_required = false` and no patient device joined, the orchestrator waits only for the doctor device.
8. **Late Chunks Handling**: Chunks arriving after the session has moved to `processing` (or `draft_ready`) are accepted, ingested with `is_late = true`, transcribed, tagged with flag `['late']`, and update `consult_sessions.draft_outdated = true` with a `transcript_updated` push notification.

---

## 2. Architecture & Design

```mermaid
flowchart TD
    A[Doctor calls POST /api/consults/:id/end] --> B[session.service.js: Set status='ending', compute & persist end_deadline_at]
    B --> C[socketService: emit end_requested]
    B --> D[orchestrator.service.js: Register session & schedule deadline timer]
    
    D --> E{All expected chunks transcribed?}
    E -- Yes: Early Finish --> F[orchestrator.finalizeEndingSession]
    E -- No: Wait --> G{Deadline expired or server restart?}
    G -- Yes --> F
    
    F --> H[Check missing sequence numbers]
    H --> I[Insert missing sequence gaps into consult_audio_gaps]
    F --> J[Determine incomplete sides]
    J --> K[Update consult_sessions: status='processing', incomplete_sides]
    K --> L[Tag segments with incomplete_side flag]
    K --> M[socketService: emit session_state status='processing']
    
    N[Late chunk arrives after deadline] --> O[chunkIngest.service: ingest with is_late=true]
    O --> P[transcriptionWorker: transcribe & save segment flags=['late']]
    P --> Q[orchestrator.handleLateChunkTranscribed]
    Q --> R[consult_sessions: set draft_outdated=true]
    Q --> S[socketService: emit transcript_updated]
```

---

## 3. Database Migration

Create `supabase/migrations/20261102000001_consult_audio_orchestration.sql`:

1. **`consult_sessions` Columns**:
   ```sql
   alter table public.consult_sessions 
     add column if not exists incomplete_sides text[] not null default '{}',
     add column if not exists draft_outdated boolean not null default false;

   create index if not exists idx_consult_sessions_ending_deadline 
     on public.consult_sessions(status, end_deadline_at) 
     where status = 'ending';
   ```
2. **`consult_audio_gaps` Reason Code**:
   Add `'missing_chunk'` to the check constraint:
   ```sql
   alter table public.consult_audio_gaps drop constraint if exists consult_audio_gaps_reason_code_check;
   alter table public.consult_audio_gaps add constraint consult_audio_gaps_reason_code_check check (
     reason_code in (
       'phone_call', 'focus_lost', 'permission_revoked', 'recorder_error',
       'unknown', 'retention_expired', 'storage_lost', 'user_discarded', 'missing_chunk'
     )
   );
   ```

---

## 4. Files to Create and Modify

### New Files
1. **`server/src/services/consultAudio/orchestrator.service.js`**:
   - `start()`: Scans for active `ending` sessions on startup and resumes their timers. Starts polling check loop (every `config.orchestratorPollMs`).
   - `stop()`: Cleans up in-memory timers and intervals on server shutdown.
   - `registerEndingSession(sessionId, deadlineAt)`: Called when a doctor initiates end. Registers deadline timer and checks for immediate early completion.
   - `checkCompleteness(sessionId)`: Re-evaluates chunk/job statuses. Called when:
     - Ingest receives a chunk or final marker during `ending`.
     - Transcription worker completes a chunk job for an `ending` session.
   - `finalizeEndingSession(sessionId, { isOverdue = false })`:
     - Identifies expected devices (`doctor`; plus `patient` if `patient_required` or joined).
     - Checks received chunks against `expected_chunks`.
     - Detects missing sequence numbers and creates gap rows in `consult_audio_gaps`.
     - Determines `incomplete_sides`.
     - Executes atomic state transition to `processing`.
     - Tags segments from incomplete sides with `'incomplete_side'`.
     - Pushes `session_state` via Socket.IO.
   - `handleLateChunkTranscribed(chunk)`:
     - Sets `draft_outdated = true` on `consult_sessions`.
     - Emits `transcript_updated` with `{ sessionId, draftOutdated: true, lateChunk: { device, seq } }`.

2. **`server/src/tests/consultAudio/orchestrator.test.js`**:
   - Dedicated Jest test suite covering all Phase 6 acceptance scenarios.

### Existing Files to Update
1. **`server/src/services/consultAudio/session.service.js`**:
   - In `endConsultation`: Notify `orchestrator.registerEndingSession(sessionId, endDeadlineAt)`.
   - In `getSessionState` & `getSessionTranscript`: Return `incompleteSides` / `incomplete_sides` and `draftOutdated` / `draft_outdated`.
2. **`server/src/services/consultAudio/gap.service.js`**:
   - Add `'missing_chunk'` to `ALLOWED_REASON_CODES`.
3. **`server/src/services/consultAudio/chunkIngest.service.js`**:
   - When a chunk or final marker is received for an `ending` session, trigger `orchestrator.checkCompleteness(sessionId)`.
4. **`server/src/services/consultAudio/transcriptionWorker.js`**:
   - On chunk transcription completion:
     - If the session is `ending`, trigger `orchestrator.checkCompleteness(sessionId)`.
     - If the chunk was late (`chunk.is_late === true`), call `orchestrator.handleLateChunkTranscribed(chunk)`.
5. **`server/src/services/consultAudio/socket.service.js`**:
   - Add `emitTranscriptUpdated(sessionId, payload)`.
6. **`server/src/config/consultAudio.config.js`**:
   - Add `orchestratorPollMs: Number(env.ORCHESTRATOR_POLL_MS || 1000)`.
7. **`server/src/app.js`**:
   - Start `orchestrator.start()` on `server.listen`.
   - Stop `orchestrator.stop()` during graceful shutdown.

---

## 5. Verification & Acceptance Criteria

We will verify with automated tests in `server/src/tests/consultAudio/orchestrator.test.js` and existing suites:

| Acceptance Criterion | Verification Test |
|---|---|
| **1. Simulated Slow Patient Device** | Patient uploads only 1 of 3 chunks; doctor device uploads all. At deadline expiry, session moves to `processing`, sequence 1 & 2 are recorded as `missing_chunk` gaps, patient side is flagged in `incomplete_sides: ['patient']`, and patient segments have `'incomplete_side'` in flags. |
| **2. Server Restart During `ending`** | A session has `status = 'ending'` and `end_deadline_at`. Orchestrator service is stopped and started. Resumes the timer and finishes on time when deadline expires. |
| **3. Fast Path (All Chunks Transcribed Early)** | Both devices declare final markers and all chunks are transcribed before the 15s deadline. The session immediately transitions to `processing` without waiting for the timer. |
| **4. Late Chunk Updates Transcript & Flags Draft** | A chunk arrives after `processing` has started. Ingest accepts it (`is_late = true`), worker transcribes it with flag `['late']`, session has `draft_outdated = true`, and `transcript_updated` event is pushed. |
| **5. Doctor-Only Mode** | When `patient_required = false` and no patient joined, orchestrator transitions to `processing` as soon as the doctor device finishes, without waiting for the patient device. |
| **6. Privacy & Safety Check** | Verify zero audio content, transcript text, patient names, or clinical values in any orchestrator logs, error codes, or push messages. |

---

## 6. Definition of Done Checklist

- [ ] New migration file committed with RLS and constraints.
- [ ] Orchestrator service implemented and integrated into server startup/shutdown.
- [ ] Completeness check accurately handles sequence gaps and doctor-only mode.
- [ ] Late chunk ingestion marks `draft_outdated = true` and updates segments.
- [ ] All new unit & integration tests pass with 100% assertions satisfied.
- [ ] Full existing test suite passes (`npm test -- src/tests/consultAudio/`).
- [ ] Walkthrough document written with test evidence and known gaps.
