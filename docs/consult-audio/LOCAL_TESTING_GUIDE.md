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
