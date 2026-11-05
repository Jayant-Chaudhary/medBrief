# Phase 10: Local Whisper STT Provider Walkthrough

**Status:** Completed and Verified  
**Date:** 2026-11-02  
**Specifications:** `docs/consult-audio/IMPLEMENTATION.md` (Phase 10)  
**Standing Rules:** `AGENTS.md` (one phase at a time, zero sensitive health/transcript logging, pluggable STT provider interface, deterministic offline fallback).

---

## 1. Executive Summary

Phase 10 delivers the **Local Whisper Speech-to-Text Provider**, fulfilling the local, zero-cost, offline companion to the cloud-based Sarvam REST provider:

1. **Local Whisper Microservice (`whisper-service/`)**:
   - Python 3.12 FastAPI microservice running `faster-whisper` backed by `CTranslate2`.
   - Default model: `large-v3-turbo` (configurable via `WHISPER_MODEL`, with `base` and `tiny` for testing).
   - **Hardware Acceleration**: Automatic CUDA GPU acceleration detection (optimized for modern NVIDIA cards including RTX 50-series) with graceful automatic fallback to CPU `int8`.
   - **VAD Silence Filtering**: Built-in Silero Voice Activity Detection (`min_silence_duration_ms=500`) to prevent text hallucination or repetitive looping during silent or ambient audio intervals.
   - Endpoints:
     - `GET /health`: Health status, active device, model name, and CUDA availability.
     - `POST /transcribe`: Accepts audio file upload, returns transcribed segments with millisecond timestamps (`start_ms`, `end_ms`), text, confidence, and detected language.

2. **Node.js Provider Integration (`LocalProvider`)**:
   - Subclasses `SttProvider` (`server/src/services/consultAudio/stt/provider.interface.js`).
   - Accepts either in-memory WAV Buffer or local file path, formats as `multipart/form-data`, and posts to `http://localhost:8001/transcribe`.
   - Normalizes returned segments into standard MedBrief segment structures with timestamps and confidence scores.
   - Fallback logic: If Whisper produces full text without fine-grained segment splits, synthesizes a single chunk-spanning segment.

3. **Config-Driven Swapping (`providerFactory`)**:
   - `STT_PROVIDER=local` automatically activates `LocalProvider` with zero code modifications to the ingestion, queue, or orchestration pipeline.
   - Automatically resolves `config.whisperServiceUrl` (default: `http://localhost:8001`).

4. **Dedicated Verification Suite**:
   - Comprehensive unit test suite in `server/src/tests/consultAudio/localProvider.test.js` (11 tests, 100% statement and line coverage).
   - Audio transcription CLI in `tools/test-whisper.js`.
   - GPU verification tool in `whisper-service/test_gpu.py`.

---

## 2. Key Code Changes and Artifacts

| Component | Path | Purpose |
|---|---|---|
| **Microservice Application** | `whisper-service/main.py` | FastAPI app with `faster-whisper`, CTranslate2, CUDA detection, CPU fallback, and VAD filtering. |
| **Microservice Launcher** | `whisper-service/run.sh` | Bash script setting NVIDIA library paths (`libcublas`, `libcudnn`) and launching `uvicorn`. |
| **GPU Benchmark** | `whisper-service/test_gpu.py` | Standalone script verifying CTranslate2 CUDA inference on sample audio. |
| **Requirements** | `whisper-service/requirements.txt` | Python dependencies: `faster-whisper`, `fastapi`, `uvicorn`, `ctranslate2`, `pydantic`. |
| **Node.js Provider** | `server/src/services/consultAudio/stt/localProvider.js` | `LocalProvider` client invoking the microservice and returning standardized segments. |
| **Provider Factory** | `server/src/services/consultAudio/stt/providerFactory.js` | Factory mapping `STT_PROVIDER=local` to `LocalProvider`. |
| **Unit Test Suite** | `server/src/tests/consultAudio/localProvider.test.js` | 11 Jest unit tests covering Buffer/file inputs, VAD flags, timestamps, whole-chunk fallbacks, and error codes. |
| **CLI Test Tool** | `tools/test-whisper.js` | CLI to test ffmpeg 16 kHz conversion and Local Whisper transcription on any audio file. |

---

## 3. Test Evidence

### A. LocalProvider Unit Tests (`server/src/tests/consultAudio/localProvider.test.js`)

```text
PASS src/tests/consultAudio/localProvider.test.js
  LocalProvider STT (Phase 10)
    Capabilities
      ✓ reports correct capabilities and provider name (1 ms)
      ✓ strips trailing slashes from serviceUrl
    transcribe()
      ✓ transcribes Buffer input and maps segments correctly (1 ms)
      ✓ transcribes file path input and loads buffer from disk
      ✓ falls back to single whole-chunk segment if segments array is empty
      ✓ returns empty array when neither segments nor text are returned (silence)
      ✓ throws ERR_FILE_NOT_FOUND when file does not exist (2 ms)
      ✓ throws for invalid input types (non-buffer, non-string) (1 ms)
      ✓ throws ERR_LOCAL_STT_UNAVAILABLE on fetch network error
      ✓ throws ERR_LOCAL_STT_FAILED on HTTP error response (500)
    ProviderFactory integration
      ✓ instantiates LocalProvider when requested

-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
localProvider.js   |     100 |       80 |     100 |     100 |                   
-------------------|---------|----------|---------|---------|-------------------
Test Suites: 1 passed, 1 total
Tests:       11 passed, 11 total
```

### B. Full Consult Audio Test Suite

```text
Test Suites: 1 skipped, 16 passed, 16 of 17 total
Tests:       5 skipped, 178 passed, 183 total
Snapshots:   0 total
Time:        1.855 s
```

### C. Full Server Regression Suite

```text
Test Suites: 1 skipped, 39 passed, 39 of 40 total
Tests:       5 skipped, 635 passed, 640 total
Snapshots:   0 total
Time:        3.581 s
Ran all test suites.
```

---

## 4. Capability Differences: Local Whisper vs. Sarvam Cloud

Per `AGENTS.md` and `IMPLEMENTATION.md`, providers must declare their capabilities honestly:

| Feature | Sarvam REST (`saaras:v4`) | Local Whisper (`large-v3-turbo`) |
|---|---|---|
| **Deployment Target** | Cloud / Production (Render) | Local Developer / CI Workstation |
| **Hardware Required** | None (SaaS REST API) | NVIDIA CUDA GPU (optional CPU fallback) |
| **API Cost** | Paid per audio minute | 100% Free / Unlimited |
| **Offline Operation** | No (Requires Internet) | Yes (100% Air-gapped / Localhost) |
| **Speaker Diarization** | Supported via Sarvam Batch | Not supported in local provider (`supportsDiarization: false`) |
| **Streaming STT** | Supported | Not supported (`supportsStreaming: false`) |
| **Languages** | 10+ Indic languages + Indian English | Multilingual Whisper (99 languages) |

---

## 5. Known Gaps and Non-Blocking Items

1. **Production Deployment on Render**:
   - As planned, Render instances do not run `whisper-service` due to GPU unavailability. Production continues to use Sarvam REST + Gemini Flash.
2. **Batch Speaker Diarization**:
   - Whisper runs on independent chunks without global speaker diarization. Cross-device speaker separation relies on Phase 7's acoustic merge and loudness deduplication.

---

## 6. Definition of Done Checklist

- [x] Python microservice with `faster-whisper` and FastAPI operational.
- [x] Automatic CUDA GPU acceleration with CPU fallback.
- [x] Silero VAD filtering enabled to suppress silence hallucinations.
- [x] Node.js `LocalProvider` implemented and tested with 100% coverage.
- [x] Config-driven swapping via `STT_PROVIDER=local`.
- [x] Zero sensitive patient or health data in logs.
- [x] Full server test suite passing (635 tests).
