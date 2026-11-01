# Consultation Audio Pipeline: Local Testing & Verification Guide

This runbook documents how to run local tests, verify each component across all phases, and troubleshoot issues.

---

## Quick Reference Commands

| What you want to test | Command | Notes |
|---|---|---|
| **Run All Backend Tests** | `cd server && npm test` | Runs all 26 test suites (435+ tests) |
| **Test Consultation Pipeline Only** | `cd server && npm test -- src/tests/consultAudio/` | Fast targeted run (~1.2s) |
| **Test Whisper STT (Default Sample)** | `node tools/test-whisper.js` | Uses medical consultation audio |
| **Test Whisper STT (Custom Audio)** | `node tools/test-whisper.js <path-to-audio>` | Supports WAV, MP3, AAC, M4A, OGG |
| **Verify GPU Hardware Acceleration** | `python whisper-service/test_gpu.py` | Checks CUDA and RTX GPU |
| **Check Whisper Service Health** | `curl http://localhost:8001/health` | Checks status, model, and device |
| **Simulate Full Device Recording** | `node tools/simulate-device/simulate.js --dry-run --both` | Slices & uploads chunks |

---

## Phase 0: Discovery & Measurement Tools

For the optional server-side Redis cache, see the setup and verification section at the end of this guide.

### 1. Dry-Run Measurement Tools
These tools test provider integration contracts without making paid network calls or requiring active API keys.

```bash
# Test Sarvam REST tool
node tools/measure/sarvam-rest.js --dry-run

# Test Sarvam Batch tool
node tools/measure/sarvam-batch.js --dry-run

# Test Gemini Clinical Drafter tool
node tools/measure/gemini-draft.js --dry-run
```

**What this does:** Verifies that audio payload construction, parameters, and headers strictly conform to the provider specifications.

---

## Phase 1: Consultation Room & Foundation Tests

### 1. State Machine Unit Tests
```bash
cd server
npm test -- src/tests/consultAudio/stateMachine.test.js
```
- **What it tests:** Validates all state transitions (`created` $\rightarrow$ `waiting` $\rightarrow$ `ready` $\rightarrow$ `recording` $\rightarrow$ `ending` $\rightarrow$ `processing` $\rightarrow$ `draft_ready`). Confirms invalid transitions are strictly rejected.

### 2. Tokens & Room Codes Tests
```bash
cd server
npm test -- src/tests/consultAudio/tokenAndCodes.test.js
```
- **What it tests:** 
  - Room code generation, rate limiting (max 5 failed attempts), and TTL expiration.
  - JWT token generation and verification for scoped device roles (`doctor` vs `patient`).

### 3. Consultation Session API Tests
```bash
cd server
npm test -- src/tests/consultAudio/consultAudioApi.test.js
```
- **What it tests:** Endpoints for creating sessions, joining by room code, recording doctor/patient consents, clock synchronization (`/api/time`), setting readiness, and starting recording.

### 4. Socket.IO Push Messaging Tests
```bash
cd server
npm test -- src/tests/consultAudio/socketIntegration.test.js
```
- **What it tests:** Verifies push events (`device_joined`, `device_ready`, `session_started`, `end_requested`) sent to rooms when participants connect.

---

## Phase 2: Audio Chunk Ingest & Simulator Tests

### 1. Chunk Ingestion Tests
```bash
cd server
npm test -- src/tests/consultAudio/chunkIngest.test.js
```
- **What it tests:**
  - Idempotent upload: sending the same chunk twice returns success without duplicate storage.
  - Silent chunk handling: saves metadata without saving empty audio.
  - Final device markers: records total expected chunks per device.
  - Enqueues transcription jobs automatically upon non-silent upload.

### 2. Device Simulator CLI
The simulator mimics a real phone/browser cutting and streaming audio chunks:

```bash
# Dry-run simulator with both doctor and patient devices:
node tools/simulate-device/simulate.js --dry-run --both

# Simulate against a running local backend:
node tools/simulate-device/simulate.js --session=<SESSION_UUID> --token=<DOCTOR_TOKEN> --device=doctor
```

---

## Phase 3: Transcription Worker & Local Whisper GPU Tests

### 1. Hardware Check: Verify NVIDIA GPU Acceleration
```bash
LD_LIBRARY_PATH="$PWD/whisper-service/venv/lib/python3.12/site-packages/nvidia/cublas/lib:$PWD/whisper-service/venv/lib/python3.12/site-packages/nvidia/cudnn/lib:$LD_LIBRARY_PATH" \
whisper-service/venv/bin/python whisper-service/test_gpu.py
```
- **Expected Output:**
  ```text
  CUDA Devices Available: 1
  SUCCESS: CUDA GPU detected!
  Loading WhisperModel('tiny', device='cuda', compute_type='float16')...
  GPU INFERENCE VERIFICATION: PASSED
  ```

### 2. Starting the Whisper Microservice
If the service is not already running in the background:
```bash
bash whisper-service/run.sh
```
Check health:
```bash
curl http://localhost:8001/health
# Returns: {"status":"ok","model":"base","device":"cuda","cuda_available":true,"cuda_device_count":1,"model_loaded":true}
```

### 3. Testing Audio Transcription CLI
```bash
# Default consultation sample:
node tools/test-whisper.js

# Custom audio file:
node tools/test-whisper.js /path/to/any/recording.mp3
```
- **What it does:** Converts audio to 16 kHz mono WAV via `ffmpeg-static`, sends it to `LocalProvider`, and displays:
  - Total processing time (typically 150ms–2s on CUDA GPU)
  - Timestamps for each spoken phrase
  - Detected language and clean text

### 4. Transcription Worker Unit & Resilience Tests
```bash
cd server
npm test -- src/tests/consultAudio/transcriptionWorker.test.js
```
- **What it tests:**
  - Atomic job locking (multiple workers cannot claim the same chunk).
  - Audio download and in-memory conversion.
  - Timeline mapping math: translates local chunk milliseconds to the global visit timeline.
  - Exponential backoff retry on temporary STT failure.
  - Stuck job recovery: resets jobs that stalled due to server crash/restart.

---

## Phase 4: Doctor Web Recorder (React) Tests

### 1. Running Client Chunker Unit Tests
```bash
cd client
npm test
```
- **What it tests:**
  - Verifies the chunker pure function logic (`audioChunker.test.js`):
    - Rejects cutting before 15s (`CHUNK_MIN_SEC`).
    - Detects pauses $\ge 500$ms (`PAUSE_MS`) after 15s and cuts cleanly.
    - Forces hard cap cut at 25s (`CHUNK_HARD_CAP_SEC`) during continuous talk.
    - Classifies silent chunks ($\le -45$ dBFS).
    - Accurately converts raw Web Audio byte streams to RMS and dBFS loudness.

### 2. Testing the UI in the Browser
1. Start the backend: `cd server && npm run dev`
2. Start the frontend: `cd client && npm run dev`
3. Sign in as a clinician and select any appointment from the dashboard.
4. Click the **Record consultation** button in the top action bar:
   - **Lobby View:** Displays the 6-character room code.
   - **Mic Check:** Move closer/further from the microphone and speak to watch the live dBFS meter bounce in real time.
   - **Consent:** Confirm readiness checkbox.
   - **Active Recording:** Click Start Consultation and speak; verify the blinking red badge, live timer, and the browser tab title updating to `🔴 Recording [00:15] - MedBrief`.
   - **End Visit:** Click End Consultation to flush the final chunk and transmit the expected chunk count marker.

### 3. Inspecting Live Transcripts & Processing Logs
1. Once recording finishes or whenever you click **Transcript Logs** on the appointment view in `ClinicianDashboard.jsx`:
   - An interactive modal opens directly on the **Transcript & Processing Logs** tab.
   - **Live Progress Bar:** Shows the percentage of audio chunks transcribed vs total chunks uploaded.
   - **Worker State:** If the background Whisper worker is currently transcribing, a pulsating amber banner announces `Transcribing Audio (Whisper GPU)...` and auto-polls every 2.5 seconds.
   - **Segment Feed:** Each recognized speech slice renders with speaker pill (`Doctor` in emerald / `Patient` in purple), millisecond time range (`[mm:ss - mm:ss]`), confidence score (e.g. `98% conf`), and detected language tag.
   - **Export Options:** Click **Copy** to copy formatted conversation dialogue to clipboard, or **Download** to save `consultation-transcript-<id>.txt`.

---

## Troubleshooting & Tips

### Whisper Service says "connection refused" on port 8001
- **Cause:** The Python FastAPI process is not currently running.
- **Fix:** Start it in a terminal:
  ```bash
  bash whisper-service/run.sh
  ```

### Testing Without GPU (CPU Fallback)
If running on a machine without an NVIDIA GPU, the service automatically falls back to `device="cpu"` and `compute_type="int8"`. No configuration change is required.

### Switching STT Providers
In `server/.env`:
- `STT_PROVIDER=local` $\rightarrow$ Uses local faster-whisper microservice (port 8001).
- `STT_PROVIDER=sarvam` $\rightarrow$ Uses Sarvam AI cloud REST API (`SARVAM_API_KEY` required).
- `STT_PROVIDER=fake` $\rightarrow$ Uses instant deterministic mock (zero network/GPU, ideal for unit tests).

---

## Optional server-side Redis audio cache

Devices upload only to Node. Node uploads compressed bytes to private Supabase Storage, attempts the Redis write, then publishes the database transcription job. HTTP success requires durable storage and job publication; a Redis failure alone is safe to ignore. The worker uses Redis first and falls back to Storage. No new database migration or client upload setting is required.

### Local setup

From the repository root:

```bash
cd server
npm ci
docker compose -f docker-compose.redis.yml config
docker compose -f docker-compose.redis.yml up -d --wait
```

Set these entries in `server/.env`, preserving the existing Supabase and authentication configuration:

```dotenv
CONSULT_AUDIO_CACHE_ENABLED=true
REDIS_URL=redis://127.0.0.1:6379
AUDIO_CACHE_TTL_SEC=1800
REDIS_CONNECT_TIMEOUT_MS=500
REDIS_COMMAND_TIMEOUT_MS=200
REDIS_RECONNECT_MAX_DELAY_MS=5000
REDIS_MAX_PENDING_COMMANDS=128
REDIS_MAXMEMORY_MB=256
```

Start Node with `npm run dev`. Leave the configured STT provider unchanged. The Redis container publishes its port on loopback only, uses LRU eviction, and disables AOF/snapshots. It is a disposable cache; its restart must not lose the persistent Supabase audio. `REDIS_PORT` can override the local published port; also update `REDIS_URL` if changing it. Production requires a private Redis connection reachable from Node, rather than assuming localhost.

Entries are binary compressed chunks, keyed only by session/device/sequence. A duplicate does not overwrite the entry or refresh its TTL. Successful transcript and completion writes delete the entry; transient processing failures retain it for retries; terminal failures remove it with Storage still available. Expired/evicted entries and Redis errors fall back to Storage. A failed cleanup does not retry a completed provider call.

### Automated verification

From `server/`:

```bash
npm test -- --runInBand src/tests/consultAudio/ --coverage=false
RUN_REDIS_INTEGRATION=true REDIS_URL=redis://127.0.0.1:6379 npm test -- --runInBand src/tests/consultAudio/audioCache.integration.test.js --coverage=false
npm test -- --runInBand --coverage=false
```

Without `RUN_REDIS_INTEGRATION=true`, the real Redis suite is explicitly skipped. It uses synthetic bytes and an isolated prefix, checks binary fidelity/NX/expiry/deletion/reconnection and a blocked-command deadline, and exercises ingest through the worker with real Redis and mocked Supabase/conversion. It does not contact Sarvam, Whisper or a live Supabase project. It never flushes unrelated keys.

### Live Supabase smoke test and restart drill

Use a synthetic test appointment/session and synthetic audio only. The existing fixtures have not been confirmed synthetic, so do not use them by default for this check.

1. Enable the cache and, for a provider-independent test, temporarily set `STT_PROVIDER=fake` on the local backend. Create, consent, ready and start a synthetic consultation through the existing application/API. Obtain its scoped doctor token without putting it in logs or a committed file.
2. Generate a synthetic 60-second mono WAV in a scratch directory, for example from the repo root:

   ```bash
   node -e 'const fs=require("node:fs"); const count=16000*60; const b=Buffer.alloc(44+count*2); b.write("RIFF",0); b.writeUInt32LE(b.length-8,4); b.write("WAVEfmt ",8); b.writeUInt32LE(16,16); b.writeUInt16LE(1,20); b.writeUInt16LE(1,22); b.writeUInt32LE(16000,24); b.writeUInt32LE(32000,28); b.writeUInt16LE(2,32); b.writeUInt16LE(16,34); b.write("data",36); b.writeUInt32LE(count*2,40); for(let i=0;i<count;i++) b.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*220*i/16000)),44+i*2); fs.writeFileSync("/tmp/medbrief-synthetic-cache.wav",b);'
   ```

3. Set shell variables `CONSULT_TEST_SESSION_ID` and `CONSULT_TEST_DOCTOR_TOKEN` from that synthetic session, then upload through Node:

   ```bash
   node tools/simulate-device/simulate.js --file=/tmp/medbrief-synthetic-cache.wav --device=doctor --session="$CONSULT_TEST_SESSION_ID" --token="$CONSULT_TEST_DOCTOR_TOKEN" --url=http://localhost:4000
   ```

4. In the private bucket and database, verify the object count, chunk rows and completed jobs. Worker success logs should contain `audioSource=redis` and `retrievalMs`; do not dump audio or transcript contents. Confirm processed cache keys are absent. Repeat the identical upload to verify no additional chunk/job is created.
5. To guarantee pending jobs for a restart drill, set `TRANSCRIBE_WORKER_POLL_MS=60000`, restart Node, wait for its first empty polling iteration, and upload a fresh synthetic session within that interval. Restart Redis with `docker compose -f docker-compose.redis.yml restart redis` from `server/` before the next worker poll. The next processing pass should use `audioSource=storage` and finish successfully. Restore the poll setting afterward. If polling timing is uncertain, use the automated forced-miss test instead of claiming a restart result.
6. Stop Redis with `docker compose -f docker-compose.redis.yml stop redis`; a new synthetic upload must still persist and process through Storage. Start it again with `docker compose -f docker-compose.redis.yml up -d --wait` and verify reconnection on a subsequent cache operation.
7. Restore the previous provider and polling settings. Cache deletion does not delete the persistent Storage object; the existing retention policy remains separate.

For latency comparison, record per-chunk retrieval source and `retrievalMs`, hit/miss counts, Storage download count and total processing time for equivalent synthetic inputs. Compare cache-enabled hits with cache-disabled Storage reads and report conversion/provider time separately. Do not claim an overall speedup from a Redis-only microbenchmark.

### Rollback and troubleshooting

- Set `CONSULT_AUDIO_CACHE_ENABLED=false` and restart Node to use the existing Storage-only path. Remaining cache keys expire naturally.
- If Docker reports a missing socket or daemon, start Docker Desktop/the Docker engine and rerun the Compose command. Redis unavailability must not prevent Node from starting or durable uploads from succeeding.
- Cache timeouts close the unhealthy connection and use a reconnect cooldown. An unusually slow remote Redis connection may require measured timeout adjustments in the config/env settings.
- A retryable `503` during chunk ingest can indicate failed persistent metadata/job publication. Retrying the same session/device/sequence repairs a missing job without re-uploading its stored audio. Completed, failed and active jobs are not reset by upload retries.
