# MedBrief Consultation Audio: Implementation Instructions

Audience: an AI coding agent (Google Antigravity) and the developer who reviews its work.
Place this file in the repo at `docs/consult-audio/IMPLEMENTATION.md`. The short standing rules are in the root `AGENTS.md`.
Design background (the "why") is in `idea.md`. If `idea.md` and this file disagree, this file wins.

---

## 0. How to work (agent protocol)

1. Do **one phase at a time**, in order. Never start a later phase unless the developer says so.
2. Start every phase in **Planning mode**. Produce an implementation plan that lists the files you will create or change, new dependencies, and how you will test. Wait for approval before editing code.
3. **Discover, do not assume.** This repo already exists (Node.js/Express backend, React doctor dashboard, Flutter patient app, Supabase Postgres, Auth and Storage, a Python OCR service). Inspect it first. Follow its folder layout, naming, migration tool, linting and test setup. Never guess a file path or table name.
4. **Do not invent external API shapes.** For Sarvam, read the official spec before writing any client code:
   - OpenAPI: `https://docs.sarvam.ai/api-reference/speech-to-text/openapi.json`
   - AsyncAPI (websocket): `https://docs.sarvam.ai/api-reference/speech-to-text/asyncapi.json`
   - Docs index: `https://docs.sarvam.ai/llms.txt` (a docs MCP server also exists at `https://docs.sarvam.ai/_mcp/server`)
   If the spec and this file disagree, follow the spec and tell the developer.
5. **Verify package choices.** For Socket.IO (server, React client, Flutter client) and the Flutter recording and foreground-service packages: check they are maintained, and that client and server Socket.IO versions are compatible, before adopting them. Record the choice in your plan.
6. A phase is **done** only when its acceptance criteria pass. Run the tests. If you cannot run something (needs a phone, a key, a GPU), say so plainly and give the developer exact manual steps. Never claim a result you did not observe.
7. At the end of each phase produce a short walkthrough: what changed, test evidence, known gaps.
8. If blocked, or if a decision is marked "ask" below, stop and ask. Do not pick silently.
9. Keep changes small and reversible. Do not rewrite existing OCR, auth or dashboard code unless a phase requires it, and then say exactly what you touched.

### Non-negotiable safety and privacy rules

- The system **flags and prioritises; it never diagnoses.** No UI text or output may state a diagnosis.
- **No audio, transcript text, names or health values in logs, error messages, analytics or notification text.** Log ids, counts, timings and error codes only. Add a log-scrubbing test.
- Tests and fixtures use **synthetic data only.**
- Do not invent clinical values or thresholds. Use clearly named configured placeholders.
- Secrets (Sarvam key, Gemini key, Supabase service key, JWT secret) come from environment variables. Never commit them. Provide `.env.example` entries without real values.
- Every database table is created with **row level security** enabled. Every route checks authentication and role.

---

## 1. Goal and constraints

**Goal:** after the doctor ends a consultation, a draft of the consultancy notes is ready for review within **1 to 2 minutes**, including speech-to-text and text-model processing.

**Constraints:**
- A doctor device and a patient device each capture audio and send it to our server. No relay through the doctor's PC.
- **No live text is needed.** Only the finished draft matters.
- Indian mobile networks are unreliable, so audio is sent as small compressed chunks that can be retried. No continuous raw streaming.
- One backend: Node.js, hosted on **Render**. Python is used only for OCR and (later, optional) local Whisper.
- Everything must stay **Sarvam-compatible**: the speech provider sits behind one interface so Sarvam and a local model can be swapped by config.

**Core idea:** do the work during the visit. Each phone cuts the audio into chunks and uploads them in the background. Each chunk is transcribed as it arrives. When the doctor ends the visit only the last chunks remain.

---

## 2. Decisions

### 2.1 Locked

| Area | Decision |
|---|---|
| Control channel | Socket.IO on the existing Node HTTP server. One room per session. Used for **push only** (server to client). |
| Audio channel | Chunks via **HTTPS POST**, one chunk per request, safe to retry. |
| State changes | Always made by **HTTP requests** (durable). Sockets only announce them. |
| Hosting | Render. Long-lived connections are fine. Do not store files on Render's local disk. |
| Chunk storage | Supabase Storage, private bucket. |
| Consent | Covers the whole room. If the patient does not consent, **nothing records**, not even the doctor device. |
| Speaker identity | From the device: doctor device = doctor, patient device = patient. |
| Provider (first) | Sarvam **REST** (up to about 30 s per request) per chunk. Not the realtime websocket. |
| Authority | Chunk transcripts feed the notes. Sarvam **batch** with speaker labels runs afterwards as a cross-check and as the one-device fallback. |
| Missing data | Missing chunks are flagged. Never guessed or filled in. |

### 2.2 Open (implement the default behind a config flag; developer will confirm)

| Question | Default |
|---|---|
| Phone keeps a temporary chunk file until the server confirms it | Yes, deleted right after confirmation. Consent text must say so. |
| Server audio retention | Delete chunk audio after the doctor has reviewed the draft (config: `AUDIO_RETENTION_AFTER_REVIEW_HOURS`, default 0). |
| Sarvam REST pricing and rate limits | Unknown. Concurrency is configurable. Phase 0 measures. |
| Session language | A per-session setting. Check the spec for how automatic detection is requested. Ask the developer for the default. |

### 2.3 Out of scope

Live captions, word-level timestamps, community or mental-health features, ultrasound image analysis, and any real patient data.

---

## 3. Architecture

**Components**

| Piece | Role |
|---|---|
| Doctor dashboard (React) | Starts the session, records the doctor device's mic in the browser, shows status and the notes draft. |
| Patient app (Flutter) | Joins with a room code, consents, records, uploads chunks. Android foreground service keeps the mic alive. |
| Node backend | Sessions, room codes, consent, scoped tokens, Socket.IO, chunk ingest, transcription worker, end-of-visit orchestration, merge, notes orchestration. |
| Provider interface | `transcribe(wavPath, options) -> Segment[]`. First implementation: Sarvam REST. A fake implementation for tests. |
| Supabase | Postgres (tables with RLS), Storage (chunk files), Auth (users). |

**Session state machine** (stored in `consult_sessions.status`)

```
created -> waiting -> ready -> recording -> ending -> processing -> draft_ready
                                   \-> cancelled / failed (from any state before draft_ready)
```
- `waiting`: session exists, devices joining.
- `ready`: required devices are ready (doctor always; patient unless `patient_required = false`).
- `ending`: End pressed, 15 s deadline running.
- `processing`: merge, verification and notes drafting running.

**Time mapping (so two devices share one timeline)**
- At join, each device does a clock handshake (default 5 rounds against `GET /api/time`) and keeps the round with the smallest round trip: `offset_ms = server_time - device_time`.
- When capture starts, the device records `capture_zero_device_ms` (its own monotonic clock) and reports it with `offset_ms`.
- Chunk session time: `session_ms = (capture_zero_device_ms + offset_ms + chunk.start_ms) - session_started_server_ms`.
- About 500 ms accuracy is enough. Do not build anything more precise.

---

## 4. Config defaults (all in one config module, all overridable by env)

| Name | Default | Meaning |
|---|---|---|
| `CHUNK_MIN_SEC` | 15 | Do not close a chunk before this, unless the session ended |
| `CHUNK_HARD_CAP_SEC` | 25 | Always close at this length |
| `PAUSE_MS` | 500 | Pause length that allows a close after the minimum |
| `SILENCE_DBFS` | calibrate | Below this average level a chunk counts as silent. Calibrate from test recordings |
| `END_DEADLINE_SEC` | 15 | Wait for final chunks after End |
| `ROOM_CODE_TTL_MIN` | 10 | Room code lifetime, single use |
| `CHUNK_MAX_BYTES` | 2,000,000 | Reject larger uploads |
| `UPLOAD_BACKOFF_MS` | 1000, 2000, 4000, 8000, then 30000 | Device retry waits |
| `TRANSCRIBE_CONCURRENCY` | 3 | Parallel provider calls |
| `TRANSCRIBE_MAX_ATTEMPTS` | 3 | Then mark the chunk failed |
| `DEDUPE_MIN_OVERLAP` | 0.5 | Share of the shorter segment that must overlap in time |
| `DEDUPE_MIN_SIMILARITY` | 0.8 | Text similarity (0 to 1) to call two segments the same utterance |
| `STT_PROVIDER` | `sarvam` | `sarvam`, `fake`, later `local` |

Numbers marked as defaults are starting points. Tune them with test recordings, and keep them out of the code body.

---

## 5. Data model

Use the repo's existing migration tool. Enable RLS on every table. The backend uses the service role; add policies so a doctor can read only their own sessions and a patient only their own session status.

- **consult_sessions**: `id`, `appointment_id` (link to the existing appointment table, discover its name), `doctor_id`, `patient_id`, `status`, `room_code`, `room_code_expires_at`, `patient_required` (bool, default true), `language_code` (nullable), `started_at`, `ended_at`, `end_deadline_at`, `created_at`.
- **session_consents**: `id`, `session_id`, `role` (doctor or patient), `user_id`, `consent_text_version`, `accepted_at`.
- **session_devices**: `id`, `session_id`, `device` (doctor or patient), `status` (joined, ready, recording, flushed, gone), `offset_ms`, `rtt_ms`, `capture_zero_device_ms`, `expected_chunks` (nullable), `final_received_at`, `joined_at`.
- **audio_chunks**: `id`, `session_id`, `device`, `seq`, `start_ms`, `duration_ms`, `avg_dbfs`, `codec`, `size_bytes`, `silent` (bool), `storage_path` (nullable), `status` (received, queued, transcribing, transcribed, failed, silent), `received_at`. **Unique (`session_id`, `device`, `seq`).**
- **transcription_jobs**: `id`, `chunk_id`, `status`, `attempts`, `next_attempt_at`, `locked_at`, `last_error_code` (a code only, never content).
- **segments**: `id` (this is the `segment_id`), `session_id`, `chunk_id`, `device`, `speaker` (doctor, patient, overlap, unknown), `start_ms`, `end_ms` (session time), `text`, `source` (chunk or batch), `provider`, `language`, `confidence` (nullable), `flags` (text array), `created_at`. The `text` column is health data: strict RLS, never logged.

Storage path: `consults/{session_id}/{device}/{seq}.{ext}` in a private bucket.

---

## 6. API contract

Authentication: doctor and patient sign in with the app's normal auth. Joining a session returns a **scoped session token** (signed, short-lived, containing `session_id`, `device`, `role`). Chunk and device routes accept only that token and only for that session.

### HTTP

| Method and path | Who | Purpose |
|---|---|---|
| `POST /api/consults` | doctor | Create a session for an appointment. Returns `session_id`, `room_code`, `expires_at`. |
| `POST /api/consults/join` | patient | Body `{room_code}`. Returns `session_id`, device token. Code is single use and expires. |
| `POST /api/consults/:id/consent` | both | Records consent for the caller's role. |
| `GET /api/time` | device | Returns server time in ms (clock handshake). |
| `POST /api/consults/:id/devices/:device/ready` | device | Body `{offset_ms, rtt_ms}`. Marks the device ready after mic and level check. |
| `POST /api/consults/:id/start` | doctor | Allowed when ready. Sets `recording`, `started_at`. Emits `session_started`. |
| `POST /api/consults/:id/devices/:device/capture-started` | device | Body `{capture_zero_device_ms}`. |
| `POST /api/consults/:id/chunks` | device | Body is the audio bytes (or empty if silent). Headers: `x-device`, `x-seq`, `x-start-ms`, `x-duration-ms`, `x-avg-dbfs`, `x-codec`, `x-silent`. Idempotent per (session, device, seq). Reply includes the current session state. |
| `POST /api/consults/:id/devices/:device/final` | device | Body `{total_chunks}`. The last seq is `total_chunks - 1`. |
| `POST /api/consults/:id/end` | doctor | Sets `ending`, stores `end_deadline_at`. Emits `end_requested`. |
| `GET /api/consults/:id/state` | any member | Current state, device statuses, chunk counts. |
| `GET /api/consults/:id/transcript` | doctor | Merged segments with flags. |

### Socket.IO (server to client only)

- Connect with `auth: { token }`. Reject bad or wrong-session tokens. Join room `session:{id}`.
- `session_state` (on join and on every change), `session_started {started_at_server_ms}`, `end_requested {deadline_at}`, `status {devices, chunks_received}`, `notes_ready {session_id}`.
- No health data in any payload. Clients never need to send data over the socket.

Reliability rules:
- The socket is a convenience, never a dependency. The deadline timer lives on the server and is saved in the database so a restart does not lose it.
- Every chunk reply carries the session state, so a phone that missed a push learns within one chunk.
- On reconnect, a client fetches `/state` first, then listens again. Reconnect with backoff.

---

## 7. Phases

Each phase lists: **Goal, Tasks, Do not, Acceptance.**

### Phase 0: Discovery and measurements

**Goal:** know the repo and get real timing numbers before designing details.

**Tasks**
- Inspect the repo. Write `docs/consult-audio/REPO_MAP.md`: backend structure, how routes and auth are organised, migration tool, test runner, existing appointment and lab tables, how Gemini or other models are already called (if at all), Flutter and React structure.
- Write three measurement scripts under `tools/measure/` (the developer supplies keys and synthetic audio):
  1. Sarvam REST: time a 20 s clip, repeated 5 times, plus 3 requests in parallel. Print latency and any rate-limit responses.
  2. Sarvam batch: time a 10-minute synthetic consultation end to end (create, upload, start, poll, download) with speaker labels on.
  3. Gemini: time a drafting call on a roughly 5,000-word synthetic transcript with schema-enforced output.
- Create `docs/consult-audio/MEASUREMENTS.md` with a table the developer fills in.

**Do not** touch product code in this phase.

**Acceptance:** repo map exists and is accurate; scripts run with a `--help` and a dry-run mode that works without keys; measurements file has the table.

### Phase 1: Backend foundation

**Goal:** sessions, consent, room codes, scoped tokens, state machine, Socket.IO.

**Tasks**
- Migrations for `consult_sessions`, `session_consents`, `session_devices` with RLS.
- State machine module with allowed transitions and one function that performs a transition (validates, saves, emits).
- Endpoints: create, join, consent, `/api/time`, ready, start, capture-started, state.
- Room codes: short, random, single use, expiry from `ROOM_CODE_TTL_MIN`, limited join attempts.
- Scoped session token: signed, short-lived, includes session id, device, role.
- Socket.IO server on the existing HTTP server, token check on connect, one room per session, `session_state` and `session_started` events.
- `patient_required = false` supports doctor-only sessions.

**Do not** accept recording without both required consents.

**Acceptance (tests)**
- State machine rejects invalid transitions.
- Expired or reused room code is rejected. A token for session A cannot join session B's room.
- Start fails until required devices are ready and consents exist.
- Integration test: two socket clients in one room both receive `session_started`.
- RLS check: a different doctor cannot read the session.

### Phase 2: Chunk ingest and the device simulator

**Goal:** receive chunks reliably and store them.

**Tasks**
- Migration for `audio_chunks`.
- `POST /api/consults/:id/chunks` with validation (token, device matches token, session is `recording` or `ending`, size limit, supported codec), idempotency on (session, device, seq), storage in Supabase Storage, silent chunks stored as metadata only.
- Reply includes session state. Late chunks (after `processing`) are accepted and marked late.
- Final marker endpoint storing `expected_chunks`.
- Build a **device simulator** CLI in `tools/simulate-device/`: given a WAV file, a device name and a session token, it cuts the audio with the same rules as the real recorder, adds a configurable delay and random failures, and uploads chunks. This is used by all later phases and for the demo.

**Do not** keep chunk files on local disk beyond processing. Do not log bodies.

**Acceptance (tests)**
- Same chunk twice stores one row and one file, second call returns success.
- Wrong token, wrong device, oversized body, or ended session is rejected with the right status.
- Silent chunk creates a row and no file.
- Simulator uploads a 5-minute synthetic WAV as two devices and the counts match.

### Phase 3: Transcription worker and provider interface

**Goal:** every received chunk becomes segments.

**Tasks**
- Migration for `transcription_jobs` and `segments`.
- Job claiming that is safe with several workers (for example a Postgres function using `FOR UPDATE SKIP LOCKED`, or the repo's database client if it supports it).
- Convert each chunk to 16 kHz mono WAV with ffmpeg. **Make sure ffmpeg exists on Render** (a static ffmpeg package or a Dockerfile) and add a startup check.
- Provider interface `transcribe(wavPath, options) -> Segment[]` with `SarvamProvider` (REST, built from the OpenAPI spec) and `FakeProvider` (deterministic text, used in tests, no network).
- Map language codes between our setting and the provider's format.
- Retry with backoff up to `TRANSCRIBE_MAX_ATTEMPTS`, then mark the chunk `failed` and flag it. Concurrency from `TRANSCRIBE_CONCURRENCY`.
- Segment times use the time mapping in section 3.
- Capability flags on the provider (which modes it supports). Do not pretend unsupported modes work.

**Do not** depend on word-level timestamps. Do not log transcript text.

**Acceptance (tests)**
- With `FakeProvider`: simulator uploads, all chunks reach `transcribed`, segments appear in the right session-time order.
- Forced provider failure retries then flags, and does not block other chunks.
- Killing and restarting the worker mid-run loses no job.
- One optional smoke test against real Sarvam, skipped unless an env flag and key are set.

### Phase 4: Doctor web recorder (React)

**Goal:** the doctor device records, cuts chunks and uploads.

**Tasks**
- Flow: Start consultation, show room code, wait for patient, consent screen, mic permission, level check (a few seconds, with a "place the device on the table" hint), clock handshake, ready, Start.
- Recording: compressed audio. Browsers write the file header only in the first piece of a recording, so **start a fresh recorder for each chunk**, starting the next just before stopping the current so no audio is lost.
- Chunker as a **pure function** (inputs: loudness samples over time, config; output: cut points), so it can be unit tested. Rule: close at the first pause of `PAUSE_MS` after `CHUNK_MIN_SEC`, or at `CHUNK_HARD_CAP_SEC`.
- Silent check using `SILENCE_DBFS`.
- Upload queue: one chunk at a time, in order, retry with `UPLOAD_BACKOFF_MS`, keep recording regardless. Chunk bytes are held in memory (or a temporary store) only until the server confirms.
- Visible recording indicator (banner and tab title). Socket.IO client for `session_started`, `end_requested`, `status`, `notes_ready`.
- End: stop, upload the last partial chunk, send the final marker with the total count.
- Tested target: current Chrome or Edge. State clearly if other browsers are unsupported.

**Do not** transcribe or show text during recording. Do not store audio after confirmation.

**Acceptance**
- Unit tests for the chunker with synthetic loudness arrays (pause cuts, hard cap, silent chunk, end flush).
- Manual checklist (developer runs): record 3 minutes with the simulator's server, kill the network for 20 s and restore it, confirm no chunk is missing and the count matches the final marker.

### Phase 5: Patient Flutter recorder

**Goal:** same behaviour on the patient's Android phone.

**Tasks**
- Join by room code, consent, permission, level check, clock handshake, ready.
- Recording through a package that supports compressed or raw audio streaming. Choose and justify (the `record` package is a candidate; verify it). Chunker logic in plain Dart so it is unit tested with the same fixtures as Phase 4.
- **Android foreground service** with a persistent notification so recording continues with the screen locked. This notification is also the recording indicator.
- Upload queue with temporary files, each deleted right after the server confirms. Retry with backoff.
- Handle interruptions (incoming call, audio focus lost): mark a gap, resume when possible.
- Socket.IO client (check version compatibility with the server). On reconnect, fetch `/state` first.
- Generic notification text only, no health words.

**Acceptance**
- Dart unit tests for the chunker.
- Manual checklist (real phone): lock the screen for 5 minutes while recording; toggle airplane mode for 30 s; take an incoming call; confirm chunks, gaps and the final count are correct on the server.

### Phase 6: End-of-visit orchestrator

**Goal:** a reliable, time-boxed finish.

**Tasks**
- `end` endpoint sets `ending` and `end_deadline_at = now + END_DEADLINE_SEC`, emits `end_requested`.
- Persist the deadline. On server start, resume any `ending` sessions.
- Completeness check: for each device, expected chunks (from the final marker) versus received and transcribed. Missing sequence numbers are recorded as gaps.
- Move to `processing` when everything expected is transcribed **or** the deadline passes. Mark incomplete sides in the session and in segment flags.
- Late chunks that arrive afterwards are transcribed and trigger an update of the transcript (and a flag that the draft is outdated).
- Doctor-only mode: wait only for the doctor device.

**Acceptance (tests)**
- Simulated slow patient device: processing starts at the deadline, patient side flagged incomplete.
- Restart the server during `ending`: the session still finishes on time.
- A late chunk updates the transcript and marks the draft outdated.

### Phase 7: Merge and crosstalk handling

**Goal:** one clean timeline from two devices.

**Tasks**
- A **pure function** `mergeSegments(doctorSegments, patientSegments, config)`:
  - Sort by session time.
  - If two segments from different devices overlap by at least `DEDUPE_MIN_OVERLAP` of the shorter one **and** their text similarity is at least `DEDUPE_MIN_SIMILARITY`, treat them as one utterance and keep the one from the device that was **louder** (use the chunk's `avg_dbfs`). Never hard-gate a speaker to zero.
  - Genuine overlapping speech with different text is marked `overlap`.
  - Low-confidence segments get a flag. Failed or missing chunks produce explicit `gap` entries.
- Normalised text comparison (lowercase, strip punctuation, handle Devanagari and Latin). Pick a simple similarity measure and document it.
- Endpoint `GET /api/consults/:id/transcript` returns merged segments with `segment_id`, speaker, times and flags.

**Acceptance (tests, synthetic fixtures)**
- A quiet duplicate on the other device is removed. Two different sentences that overlap are both kept and marked `overlap`.
- Gaps appear as entries, not silent holes.
- Thresholds come from config. Report duplicate rate on a recorded two-phone test as a number for the developer.

### Phase 8: Notes drafting (interface and checks)

**Goal:** from transcript to a reviewable draft inside the time budget.

**Tasks (ask the developer before choosing the Gemini model name and before deciding where verified lab data lives)**
- Build the input: merged transcript with `segment_id`s, structured intake, verified lab and ultrasound values from the existing tables (discover them, do not invent).
- **Tracer verification:** every numeric lab or ultrasound value gets a tracer id and is checked against the structured report. The model may quote only verified values; otherwise the text must read `[value pending verification]`.
- Numbers spoken in the room that exist nowhere in structured data are labelled "stated verbally, unverified".
- Run **separate model calls in parallel** (doctor draft notes, patient summary, flags), each with a schema-enforced output (use the repo's validation library) where every claim carries the `segment_id`s that support it.
- **Deterministic post-check:** every number must be in the verified set; every cited segment must exist. Failures go to human review. Nothing auto-publishes.
- Store the draft with status `needs_review`, move the session to `draft_ready`, emit `notes_ready`.
- Prescription checklist stays rule-based from structured orders and verified labs. It does not use audio. Use configured placeholders for any thresholds.

**Acceptance (tests)**
- With a fake model client: output with an unverified number or a made-up segment id is rejected and sent to review.
- End to end with the simulator and fake providers: time from `end` to `notes_ready` is measured and printed.

### Phase 9: Batch cross-check and one-device fallback

**Goal:** a second opinion on speaker labels, and a safety net.

**Tasks**
- Rebuild a continuous track from stored chunks (pad silence using session times) with ffmpeg.
- Submit the **doctor device's track** to Sarvam batch with speaker labels (two speakers), following the spec's job flow (create, upload, start, poll or webhook, download). Sarvam batch returns chunk-level timestamps only.
- Compare batch speaker labels with per-device labels. Agreement raises confidence. Disagreement adds a flag shown in the doctor's review screen.
- If `patient_required = false` or the patient never joined, batch speaker labels become the primary speaker source for that session.
- If Phase 0 shows batch finishes fast enough for the time budget, ask the developer whether to make it the main transcript.

**Acceptance:** with fake batch responses, mismatches are flagged and matches are not; fallback sessions get speaker labels from batch.

### Phase 10: Local Whisper provider (optional, only if asked)

**Tasks**
- A small Python service using faster-whisper (large-v3-turbo) behind HTTP, called by `LocalProvider` in Node. Chunks are under 30 s so they fit Whisper's window. Use voice detection to avoid invented text on silence.
- GPU check first: newer RTX 50-series cards need CUDA 12.8 or later and a recent CTranslate2. Prove it runs on the GPU with a 30 s clip before building on it.
- `STT_PROVIDER=local` must work with no other code changes. Report which Sarvam modes are unsupported locally.

**Acceptance:** same chunk fixtures produce segments through both providers; a comparison script prints text differences for the developer.

### Phase 11: Hardening and demo rehearsal

**Tasks**
- Scripted end-to-end run using two simulated devices and synthetic consultations. Print a timing report (End to `notes_ready`).
- Log scrub test: confirm no transcript text, names or values appear in logs.
- Render checks: health endpoint, instance that does not sleep during the demo, environment variables set, ffmpeg present, Socket.IO connects through Render's proxy.
- Failure drills: network drop on each device, one device never joins, server restart during `ending`.
- Write `docs/consult-audio/DEMO.md`: exact steps and what to say if something fails.

**Acceptance:** all failure drills end in a correct, flagged result and never in a hang.

---

## 8. Definition of done (every phase)

- Acceptance tests pass and are committed.
- Lint and type checks pass.
- No transcript text, audio, names or health values in logs.
- Config values live in the config module and `.env.example` is updated.
- A short walkthrough lists changes, evidence and known gaps.
- No silent TODOs. Anything unfinished is listed.

---

## 9. Prompt templates for Antigravity

**Start a phase**
> Read `AGENTS.md` and `docs/consult-audio/IMPLEMENTATION.md`. Work only on **Phase N**. First inspect the repo and write an implementation plan listing files to change, dependencies and tests. Do not edit code until I approve the plan.

**After approval**
> Proceed with the approved plan for Phase N. Run the tests. At the end give me a walkthrough with test evidence and any gaps. Do not start Phase N+1.

**When something does not match**
> The Sarvam spec differs from the contract in section 6 of the implementation doc. Show me the difference and propose the smallest change. Do not edit yet.

**Review pass**
> Review the Phase N changes against its acceptance criteria and the safety rules in section 0. List anything that logs transcript text, skips auth or RLS, or hard-codes a threshold.
