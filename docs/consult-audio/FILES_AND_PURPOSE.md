# Consultation Audio Pipeline: Files and Purpose Guide

This document maintains an up-to-date catalog of every file created for the consultation audio pipeline, written in plain English, explaining **what it is** and **why it exists**.

---

## 1. Database Migrations (`supabase/migrations/`)

### `supabase/migrations/20261029000000_consult_sessions.sql` (Phase 1)
- **What it is:** Database table definitions for consultation sessions, patient/doctor consents, and connected devices.
- **Why it exists:** Provides durable storage for the room codes, status tracking (`created`, `waiting`, `ready`, `recording`, `ending`, `processing`, `draft_ready`), clock synchronisation offsets (`offset_ms`), and Row Level Security (RLS) so only doctors and patients can access their own visits.

### `supabase/migrations/20261029000001_audio_chunks.sql` (Phase 2)
- **What it is:** Database table definition for `audio_chunks`.
- **Why it exists:** Tracks each incoming audio slice uploaded by either device (doctor or patient). Enforces a strict unique rule on `(session_id, device, seq)` so that retrying an upload never creates duplicate chunks. Also marks silent chunks without wasting disk space.

### `supabase/migrations/20261029000002_transcription.sql` (Phase 3)
- **What it is:** Database table definitions for `transcription_jobs` and `segments`.
- **Why it exists:** 
  - `transcription_jobs`: Acts as a resilient work queue for speech-to-text. If the server restarts or crashes, uncompleted jobs remain in the queue and recover automatically.
  - `segments`: Stores the recognized sentences with start/end milliseconds mapped onto the shared consultation timeline, with speaker labels (`doctor` or `patient`).

---

## 2. Server Configuration (`server/src/config/` and `server/`)

### `server/src/config/consultAudio.config.js`
- **What it is:** The single control center for all audio pipeline settings.
- **Why it exists:** Keeps all "magic numbers" (e.g., minimum chunk duration: 15s, hard cap: 25s, silence threshold: -45 dBFS, retry backoffs, provider choice) in one place instead of scattered across code bodies.

### `server/.env.example`
- **What it is:** A template documenting all necessary environment variables without containing real secrets.
- **Why it exists:** Ensures developers and automated CI know which keys (`SESSION_TOKEN_SECRET`, `WHISPER_SERVICE_URL`, `SARVAM_API_KEY`) need to be configured.

---

## 3. Server Core & Lifecycle (`server/src/`)

### `server/src/app.js`
- **What it is:** The main Express application and HTTP server entry point.
- **Why it exists:** Configures routes, mounts Socket.IO for push messaging, runs startup health checks (like verifying `ffmpeg` exists), and starts the background transcription worker loop.

### `server/src/utils/audioConverter.js`
- **What it is:** An in-memory audio converter using `ffmpeg-static`.
- **Why it exists:** Converts browser or phone audio formats (WebM, Opus, AAC, WAV) into standardized 16 kHz mono WAV for speech models. It streams directly through memory (stdin/stdout) so audio is **never written to Render's local disk**, adhering to strict patient privacy rules.

---

## 4. Consultation Audio Services (`server/src/services/consultAudio/`)

### `server/src/services/consultAudio/stateMachine.js`
- **What it is:** Strict rulebook for consultation session states.
- **Why it exists:** Prevents invalid jumps (e.g. you cannot jump from `waiting` directly to `recording` without being `ready` and having both microphone consents).

### `server/src/services/consultAudio/roomCode.service.js`
- **What it is:** Generator and validator for 6-character room codes.
- **Why it exists:** Generates unambiguous codes (excludes confusing characters like `0`, `O`, `1`, `I`) so a patient can easily type it on their phone to join the consultation room.

### `server/src/services/consultAudio/token.service.js`
- **What it is:** Scoped JSON Web Token (JWT) issuer and verifier.
- **Why it exists:** Gives the doctor and patient devices a temporary, tamper-proof pass token tied strictly to their consultation and device role.

### `server/src/services/consultAudio/session.service.js`
- **What it is:** Business logic for session creation, joining, device readiness, and consents.
- **Why it exists:** Manages clock handshakes (`offset_ms`), verifies consents, transitions the room to `ready`, and records session start/stop times.

### `server/src/services/consultAudio/socket.service.js`
- **What it is:** Socket.IO real-time push notification hub.
- **Why it exists:** Sends instant push alerts to devices (e.g., *"Patient has entered room"*, *"Both devices ready"*, *"Doctor pressed start"*, *"Recording ending"*). Socket.IO is push-only; state changes always happen via secure HTTP requests.

### `server/src/services/consultAudio/chunkIngest.service.js`
- **What it is:** Ingestion engine for audio chunk uploads.
- **Why it exists:** Accepts raw audio chunks from devices, uploads them securely to Supabase Storage (`consult-audio` private bucket), saves metadata to `audio_chunks`, and enqueues transcription jobs.

### `server/src/services/consultAudio/transcriptionWorker.js`
- **What it is:** Background processor that transcribes audio into text.
- **Why it exists:** Atomically pulls queued jobs from the database, converts chunk audio to 16 kHz mono WAV, calls the STT provider, maps timestamps onto the master timeline, saves segments, and automatically retries on temporary failures with exponential backoff.

---

## 5. Speech-to-Text Providers (`server/src/services/consultAudio/stt/`)

### `server/src/services/consultAudio/stt/provider.interface.js`
- **What it is:** Common blueprint that all STT providers must follow.
- **Why it exists:** Guarantees that the rest of the application can swap providers without changing any backend code.

### `server/src/services/consultAudio/stt/fakeProvider.js`
- **What it is:** A mock provider for lightning-fast testing.
- **Why it exists:** Produces predictable transcription output instantly without needing internet access, external API keys, or GPU hardware.

### `server/src/services/consultAudio/stt/localProvider.js`
- **What it is:** Client for the local faster-whisper microservice.
- **Why it exists:** Sends audio to the local Whisper service over HTTP and parses the resulting text and timestamps.

### `server/src/services/consultAudio/stt/sarvamProvider.js`
- **What it is:** Client for Sarvam AI's Indian language REST API.
- **Why it exists:** Enables cloud transcription for Indian languages and regional dialects when configured.

### `server/src/services/consultAudio/stt/providerFactory.js`
- **What it is:** Switchboard that selects the active STT provider.
- **Why it exists:** Reads `STT_PROVIDER` (`local`, `sarvam`, or `fake`) and returns the appropriate provider instance.

---

## 6. Local Whisper Microservice (`whisper-service/`)

### `whisper-service/main.py`
- **What it is:** A lightweight FastAPI server running `faster-whisper`.
- **Why it exists:** Provides high-speed speech-to-text with GPU acceleration (CUDA float16) and built-in voice activity detection (VAD).

### `whisper-service/run.sh`
- **What it is:** Startup script for the Whisper service.
- **Why it exists:** Configures `LD_LIBRARY_PATH` for CUDA cuBLAS/cuDNN libraries and boots the server on port 8001.

### `whisper-service/test_gpu.py`
- **What it is:** Hardware verification diagnostic script.
- **Why it exists:** Confirms that CUDA and the NVIDIA GPU are properly detected and functioning.

---

## 7. Developer & Testing Tools (`tools/`)

### `tools/test-whisper.js`
- **What it is:** Standalone command-line testing utility.
- **Why it exists:** Lets you test any audio file (MP3, WAV, AAC, etc.) through the local Whisper pipeline and see transcription text, timestamps, and GPU speed immediately in your terminal.

### `tools/simulate-device/simulate.js`
- **What it is:** Hardware simulation CLI.
- **Why it exists:** Acts like real doctor and patient phones, cutting audio into real-time 15-second slices and uploading them over HTTP to test the server under realistic conditions.

### `tools/simulate-device/fixtures/sample-consult-5min.wav`
- **What it is:** A 5-minute audio test fixture.
- **Why it exists:** Provides repeatable multi-chunk audio for benchmark and integration testing.

---

## 8. Automated Unit & Integration Tests (`server/src/tests/consultAudio/`)

### `server/src/tests/consultAudio/stateMachine.test.js`
- **What it is:** Tests for the consultation room state transitions.
- **Why it exists:** Verifies that no invalid or out-of-order room state changes can ever occur.

### `server/src/tests/consultAudio/tokenAndCodes.test.js`
- **What it is:** Tests for room codes and JWT security tokens.
- **Why it exists:** Ensures room codes expire on time and tokens cannot be forged or reused across different visits.

### `server/src/tests/consultAudio/consultAudioApi.test.js`
- **What it is:** HTTP API integration tests.
- **Why it exists:** Verifies that all endpoints (`/create`, `/join`, `/consent`, `/ready`, `/start`, `/chunks`) enforce role security and return proper status codes.

### `server/src/tests/consultAudio/socketIntegration.test.js`
- **What it is:** Real-time push notification tests.
- **Why it exists:** Checks that devices receive instant room updates via Socket.IO without relying on polling.

### `server/src/tests/consultAudio/chunkIngest.test.js`
- **What it is:** Audio upload and idempotency tests.
- **Why it exists:** Verifies that retried chunks don't duplicate, silent chunks are saved as metadata, and final markers work properly.

### `server/src/tests/consultAudio/transcriptionWorker.test.js`
- **What it is:** Worker engine and retry tests.
- **Why it exists:** Verifies atomic job locking, timestamp math, automatic retries with backoff, and recovery from server crashes.

---

## 9. Doctor Web Recorder React App (`client/src/`) (Phase 4)

### `client/src/utils/audioChunker.js`
- **What it is:** A pure function audio chunk boundary and silence evaluation module.
- **Why it exists:** Provides deterministic, unit-testable decision logic for cutting audio chunks (close at first pause $\ge 500$ms after 15s, hard cap at 25s, silence detection $\le -45$ dBFS) completely decoupled from browser audio APIs.

### `client/src/services/consultAudio/webRecorder.js`
- **What it is:** The browser audio recording engine for the doctor device.
- **Why it exists:** Solves the browser container header challenge by implementing dual-recorder handover (starts recorder $N+1$ right before stopping recorder $N$ so every chunk has a valid WebM/Opus header and zero audio frames are lost). Also manages live mic metering via Web Audio API `AnalyserNode`, and an in-memory sequential upload queue with exponential backoff retries.

### `client/src/services/consultAudio/consultClient.service.js`
- **What it is:** The frontend API and Socket.IO client service for consultation sessions.
- **Why it exists:** Handles creating consultation sessions, doctor consent, a 5-round clock synchronization handshake (`/api/time`), signaling device readiness, and real-time Socket.IO push messaging for control room events (`device_joined`, `device_ready`, `session_started`, `end_requested`).

### `client/src/components/consultAudio/DoctorConsultationModal.jsx`
- **What it is:** The main user interface modal for doctor consultation recording and transcript review.
- **Why it exists:** Guides the doctor through the 5-step visit workflow: displaying the 6-character patient room code, live mic placement check and consent confirmation, active recording with blinking indicator and dynamic tab title (`🔴 Recording [04:12] - MedBrief`), and ending the visit with a final chunk flush. In addition, it features an interactive **Transcript & Processing Logs** tab displaying live speech-to-text chunk progress (transcribed vs. total chunks), speaker-segmented cards with timestamps (`[mm:ss - mm:ss]`), confidence percentages, language tags, "Copy Transcript", and "Download (.txt)" capabilities.

### `client/src/pages/clinician/ClinicianDashboard.jsx`
- **What it is:** The clinician dashboard and Report Analysis view.
- **Why it exists:** Provides entry points for the doctor to initiate "Record consultation" or click "Transcript Logs" for any patient visit to inspect processed transcripts and background worker status directly from the patient chart.

### `client/src/tests/audioChunker.test.js`
- **What it is:** Vitest unit tests for the audio chunker.
- **Why it exists:** Verifies that pause cuts, 25-second hard caps, silence detection, and loudness byte calculations execute with 100% mathematical accuracy on synthetic test arrays.

### `client/src/tests/webRecorder.test.js`
- **What it is:** Asynchronous recorder and HTTP-ordering regression tests with synthetic recorder events.
- **Why it exists:** Protects per-recorder buffers, final data flushing, sequence order, repeated Stop calls and error handling at chunk boundaries.

### `server/src/tests/consultAudio/audioConverter.test.js`
- **What it is:** Real in-memory ffmpeg conversion tests using synthetic data.
- **Why it exists:** Verifies resampling and controlled failure for malformed input, including the stdin pipe error that could crash Node.

### `docs/consult-audio/CHUNK_BOUNDARY_FIX_WALKTHROUGH.md`
- **What it is:** Chunk boundary investigation, fix, test evidence and remaining manual verification.

## 10. Optional server-side Redis audio cache (Phase 3 enhancement)

- `server/docker-compose.redis.yml`: local loopback-only Redis with bounded memory, LRU eviction and disk persistence disabled.
- `server/src/config/redisClient.js`: shared optional connection, binary reply mapping, bounded handshake/commands, reconnect cooldown and shutdown. Redis errors fall back to persistent Storage without exposing raw messages.
- `server/src/services/consultAudio/audioCache.service.js`: original compressed binary chunks, namespaced by session/device/sequence; atomic expiry without refreshing duplicate entries; validated reads and explicit deletion.
- `server/src/services/consultAudio/chunkIngest.service.js`: Node uploads the durable copy to Supabase, attempts cache population before publishing the database job, and repairs absent jobs when an upload is retried.
- `server/src/services/consultAudio/transcriptionWorker.js`: cache-first retrieval, Storage fallback, checked completion and cache cleanup; reports retrieval source and timings without audio/transcript content.
- `server/src/tests/consultAudio/audioCache.test.js`: binary validation, key isolation, optional-cache failures and a real unresponsive TCP handshake test.
- `server/src/tests/consultAudio/audioCache.integration.test.js`: opt-in real Redis tests for binary fidelity, expiry, reconnection, command deadlines and ingest-to-worker hit/miss paths with synthetic persistence mocks.
- `docs/consult-audio/REDIS_CACHE_IMPLEMENTATION_PLAN.md`: approved design, scope and acceptance criteria.
- `docs/consult-audio/REDIS_CACHE_WALKTHROUGH.md`: executed verification and remaining deployment/manual checks.



## 11. Patient Android recorder (Phase 5)

- `mobile/lib/features/consult_audio/consult_audio_config.dart`: central, build-configurable audio, retention, timeout and retry values.
- `consult_audio_models.dart`, `audio_chunker.dart`, `adts_chunk_assembler.dart` in that feature directory: typed status/gaps, shared chunk decisions and complete AAC frame assembly.
- `patient_recorder.dart`: microphone adapter, local level check, encoded duration cuts, final-tail drain and focus interruptions.
- `pending_audio_store.dart`, `audio_upload_queue.dart`: serialized atomic manifests, short-lived app-private audio, capture/final request recovery, verified acknowledgements, retention and explicit discard.
- `consult_audio_repository.dart`, `consult_socket.dart`: real HTTP contracts, scoped secure credentials and push-only socket state reconciliation.
- `consult_foreground_task.dart`: actual Android task entry point owning recording/HTTP work, generic notifications and shutdown handshake.
- `consult_audio_controller.dart`, `consult_audio_page.dart`: patient consent/permission/readiness flow, foreground status proxy, pending recovery and incomplete capture display.
- `mobile/test/consult_audio_*.dart`: synthetic chunker, recorder-tail, real ffmpeg, API, queue, privacy and flow regressions.
- `tools/simulate-device/fixtures/chunker-cases.json`: shared Dart and JavaScript chunker cases.
- `server/src/services/consultAudio/gap.service.js`: validated, idempotent gap writes and reads. Session state checks participant membership; joins conditionally consume codes and preserve appointment ownership.
- `server/src/tests/consultAudio/gaps.test.js`, `patientAccess.test.js`: gap contract, access and simultaneous join regressions. `stateMachine.test.js` also covers absent required patients and room consent.
- `supabase/migrations/20261101000000_consult_audio_gaps.sql`, `20261102000000_consult_audio_gap_recovery.sql`: RLS-enabled gap metadata and recovery/discard reason codes with direct client writes revoked.
- `PHASE_5_INFRA_READINESS.md`, `PHASE_5_WALKTHROUGH.md`: observed infrastructure, changes, executed evidence and remaining Android/device acceptance.

## 12. End-of-Visit Orchestrator (Phase 6)

- `server/src/services/consultAudio/orchestrator.service.js`: Coordinates the reliable, time-boxed conclusion of consultation sessions (`recording` $\rightarrow$ `ending` $\rightarrow$ `processing`). Manages persistent deadline timers, detects missing sequence numbers, logs gaps, flags incomplete sides, handles doctor-only mode, and updates transcripts for late-arriving chunks.
- `server/src/tests/consultAudio/orchestrator.test.js`: Unit and acceptance tests verifying slow device timeout, missing sequence gap creation, server restart resumption, early completion fast-path, doctor-only mode, late chunk updates with `draft_outdated`, and strict privacy compliance.
- `supabase/migrations/20261102000001_consult_audio_orchestration.sql`: Adds `incomplete_sides` and `draft_outdated` to `consult_sessions`, an index on ending deadlines, and the `'missing_chunk'` reason code in `consult_audio_gaps`.
- `docs/consult-audio/PHASE_6_IMPLEMENTATION_PLAN.md`: Approved implementation plan for Phase 6.
- `docs/consult-audio/PHASE_6_WALKTHROUGH.md`: Detailed walkthrough, test evidence across backend, client, and mobile, and known gaps.

## 13. Merge and Crosstalk Handling (Phase 7)

- `server/src/services/consultAudio/mergeSegments.js`: Pure, deterministic merger function that unifies doctor and patient segments into a single chronological timeline. Computes temporal overlap ratios relative to the shorter segment, measures text similarity via token Dice and character bigrams (supporting both Devanagari and Latin), removes quieter acoustic echo duplicates based on chunk `avg_dbfs`, flags simultaneous speech overlaps (`'overlap'`), tags low-confidence utterances (`'low_confidence'`), embeds explicit gaps (`consult_audio_gaps` and failed chunks) so gaps are never silent holes, and computes duplicate rate statistics.
- `tools/simulate-device/fixtures/merge-cases.json`: Shared synthetic cross-platform test fixtures covering quiet duplicate removal, simultaneous speech overlap, Devanagari consultation phrases, low confidence tagging, and gap embedding.
- `server/src/tests/consultAudio/mergeSegments.test.js`: Comprehensive unit tests covering pure normalization, similarity math, temporal overlap calculations, quiet duplicate removal, simultaneous speech flags, gap embedding, fixture validation, and duplicate rate reporting.
- `docs/consult-audio/PHASE_7_IMPLEMENTATION_PLAN.md`: Approved implementation plan for Phase 7.
- `docs/consult-audio/PHASE_7_WALKTHROUGH.md`: Detailed walkthrough, duplicate rate metrics, test evidence, and known gaps.

## 14. Notes Drafting (Interface and Checks) (Phase 8)

- `supabase/migrations/20261102000002_consult_drafts.sql`: Creates `consult_drafts` table with `status in ('needs_review', 'approved', 'rejected')`, `doctor_notes`, `patient_summary`, `clinical_flags`, `tracers_used`, `review_reasons`, and Row Level Security policies matching session participants.
- `server/src/services/consultAudio/drafting/draftSchemas.js`: Zod and Gemini OpenAPI JSON response schemas for Doctor Notes, Patient Summary, and Clinical Flags.
- `server/src/services/consultAudio/drafting/tracerVerification.js`: Context builder querying structured records (`lab_report_metrics`, `pregnancy_investigations`, `pregnancy_ultrasounds`, `vitals_logs`, `antenatal_visits`, `questionnaire_responses`), tracer catalog generator, and deterministic post-check engine enforcing citation integrity and numeric claim verification.
- `server/src/services/consultAudio/drafting/draftProvider.interface.js`: Interface defining `generateDoctorNotes`, `generatePatientSummary`, `generateClinicalFlags`, and parallel `generateDraft`.
- `server/src/services/consultAudio/drafting/geminiDraftProvider.js`: Google Gemini Flash REST API provider with schema-enforced JSON output.
- `server/src/services/consultAudio/drafting/localDraftProvider.js`: Local LLM provider for `qwen3:8b` (Ollama or OpenAI-compatible format) for local offline testing.
- `server/src/services/consultAudio/drafting/fakeDraftProvider.js`: Deterministic zero-network provider using actual segment IDs and tracers for test suites.
- `server/src/services/consultAudio/drafting/draftProviderFactory.js`: Factory resolving provider by config (`'gemini'` | `'local'` | `'fake'`).
- `server/src/services/consultAudio/draft.service.js`: Orchestrates transcript retrieval, structured context & tracer building, parallel drafting, post-checks, `consult_drafts` persistence, state transition to `draft_ready`, `notes_ready` socket emission, and clinician review/approval committed to `consultation_notes`.
- `server/src/tests/consultAudio/tracerVerification.test.js`: Unit tests for tracer generation, citation integrity, and unverified number auditing.
- `server/src/tests/consultAudio/draftProviders.test.js`: Unit tests for `FakeDraftProvider`, `GeminiDraftProvider`, `LocalDraftProvider`, and factory.
- `server/src/tests/consultAudio/draftService.test.js`: Integration tests for draft generation, review approval, rejection, and access control.
- `docs/consult-audio/PHASE_8_IMPLEMENTATION_PLAN.md`: Approved implementation plan for Phase 8.
- `docs/consult-audio/PHASE_8_WALKTHROUGH.md`: Detailed walkthrough, benchmark turnaround timing, test evidence, and known gaps.
