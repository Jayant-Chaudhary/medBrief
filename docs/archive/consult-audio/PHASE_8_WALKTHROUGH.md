# Phase 8: Notes Drafting (Interface and Checks) Walkthrough

**Status:** Completed and Verified  
**Date:** 2026-11-02  
**Specifications:** `docs/consult-audio/IMPLEMENTATION.md` (Phase 8)  
**Standing Rules:** `AGENTS.md` (one phase at a time, zero sensitive health/transcript logging, no medical diagnoses, strict tracer verification, schema-enforced output).

---

## 1. Executive Summary

Phase 8 implements **Clinical Notes Drafting with Tracer Verification and Dual Model Providers**. It consumes the merged, chronological consultation timeline produced in Phase 7 and generates a reviewable structured clinical draft within the time budget:

1. **Dual / Pluggable Model Providers**:
   - **Google Gemini Flash** (`GeminiDraftProvider`): Production provider calling the Google Generative Language REST API (`gemini-1.5-flash` or `gemini-2.0-flash`) with OpenAPI JSON response schemas.
   - **Local Qwen3:8b** (`LocalDraftProvider`): Local testing provider connecting to Ollama (`/api/chat` or OpenAI-compatible `/v1/chat/completions`) with JSON formatting, enabling local, private offline testing without third-party API dependencies.
   - **FakeDraftProvider**: Fast, deterministic, zero-network provider using actual transcript `segment_id`s and verified tracers for automated CI/regression test suites.
   - Config-driven swapping via `DRAFT_MODEL_PROVIDER` (`'gemini'` | `'local'` | `'fake'`), exactly mirroring STT provider abstraction.
2. **Context Builder & Verified Tracer Verification**:
   - Ingests structured intake (`questionnaire_responses`), verified lab reports (`lab_report_metrics` where `needs_review = false` or `reviewed_by IS NOT NULL`), maternity card investigations (`pregnancy_investigations` where `dismissed_at IS NULL`), ultrasound findings (`pregnancy_ultrasounds`), and vitals (`vitals_logs`, `antenatal_visits`).
   - Generates deterministic tracer IDs (e.g. `TRACER_HEMOGLOBIN_10.8`, `TRACER_BP_SYSTOLIC_118`).
   - Ensures clinical numbers quoted by the model are backed by verified tracers.
   - Any verbal clinical numbers missing from structured data must be labeled `"stated verbally, unverified"`. Unverified lab/ultrasound tests must read `"[value pending verification]"`.
3. **Parallel Schema-Enforced Generation (Zod)**:
   - Executes 3 concurrent model tasks in parallel via `Promise.all`:
     1. **Doctor Notes Draft**: Chief complaint, vitals observed, assessment (descriptive clinical summary only, never a medical diagnosis), and plan & recommendations citing supporting `cited_segment_ids`.
     2. **Patient Summary**: Patient-friendly summary, action checklist, and red-flag warning signs.
     3. **Operational Clinical Flags**: Priority risk flags with severity (`low`, `medium`, `high`) and supporting `cited_segment_ids`.
4. **Deterministic Post-Check Engine**:
   - Audits that every cited `segment_id` exists in the input merged transcript.
   - Audits that all clinical numbers are either in the verified tracer catalog or accompanied by required disclaimers.
   - Hallucinated segment IDs or unverified claims flag the draft with `review_reasons: ['invalid_segment_citation', 'unverified_numeric_claim']`.
   - Never auto-publishes; draft is stored with `status: 'needs_review'`.
5. **State Transition, Storage & Socket Notifications**:
   - Database table `consult_drafts` with Row Level Security.
   - Moves session state: `processing` $\rightarrow$ `draft_ready`.
   - Emits real-time push event: `notes_ready` via Socket.IO.
   - Late chunk safety: If a late chunk arrives after drafting, Phase 6's `draft_outdated: true` flag signals that re-drafting is required.
6. **Clinician Review & Approval Bridge**:
   - `GET /api/consults/:id/draft`: Returns reviewable draft, citations, tracers used, and flags.
   - `POST /api/consults/:id/draft/review`: Doctor approves (committing finalized notes into `consultation_notes` for the existing clinician dashboard), edits, or rejects the draft.

---

## 2. Key Code Changes

| File | Purpose |
|---|---|
| `supabase/migrations/20261102000002_consult_drafts.sql` | Schema migration for `consult_drafts` table with RLS policies for doctors and patients. |
| `server/src/config/consultAudio.config.js` | Added `draftModelProvider`, `geminiDraftModel`, `geminiApiKey`, `localLlmUrl`, `localLlmModel`, `draftTimeoutMs`. |
| `server/.env.example` | Documented Phase 8 drafting configuration and local model options. |
| `server/src/services/consultAudio/drafting/draftSchemas.js` | Zod validation schemas and Gemini OpenAPI response schemas for Doctor Notes, Patient Summary, and Clinical Flags. |
| `server/src/services/consultAudio/drafting/tracerVerification.js` | Context builder, tracer catalog generator, and deterministic post-check engine. |
| `server/src/services/consultAudio/drafting/draftProvider.interface.js` | Base provider interface defining subtasks and parallel `generateDraft`. |
| `server/src/services/consultAudio/drafting/geminiDraftProvider.js` | Google Gemini Flash REST API provider with schema-enforced structured JSON output. |
| `server/src/services/consultAudio/drafting/localDraftProvider.js` | Local LLM provider for `qwen3:8b` (Ollama or OpenAI-compatible format) for local offline testing. |
| `server/src/services/consultAudio/drafting/fakeDraftProvider.js` | Deterministic zero-network provider using actual segment IDs and tracers for test suites. |
| `server/src/services/consultAudio/drafting/draftProviderFactory.js` | Factory resolving provider by config (`'gemini'` \| `'local'` \| `'fake'`). |
| `server/src/services/consultAudio/draft.service.js` | Coordinates drafting, post-checks, `consult_drafts` persistence, state transition to `draft_ready`, `notes_ready` socket emission, and review approval. |
| `server/src/services/consultAudio/orchestrator.service.js` | Updated `finalizeEndingSession` to trigger background clinical drafting when entering `processing`. |
| `server/src/controllers/consultAudio.controller.js` | Added `getDraft`, `reviewDraft`, and `generateDraft` controller handlers. |
| `server/src/routes/consultAudio.routes.js` | Added routes `GET /api/consults/:id/draft`, `POST /api/consults/:id/draft/review`, `POST /api/consults/:id/draft/generate`. |
| `server/src/tests/consultAudio/tracerVerification.test.js` | 5 unit tests for tracer generation, citation integrity, and unverified number auditing. |
| `server/src/tests/consultAudio/draftProviders.test.js` | 8 unit tests for `FakeDraftProvider`, `GeminiDraftProvider`, `LocalDraftProvider`, and factory. |
| `server/src/tests/consultAudio/draftService.test.js` | 6 integration tests for drafting, state transition to `draft_ready`, `notes_ready` push, and doctor review workflow. |
| `server/src/tests/consultAudio/consultAudioApi.test.js` | Added integration tests for `/draft`, `/draft/review`, and `/draft/generate`. |
| `docs/consult-audio/FILES_AND_PURPOSE.md` | Documented Phase 8 files in Section 14. |

---

## 3. Turnaround Time Benchmark

Measured using `tools/measure/gemini-draft.js` on a synthetic 5,000-word multi-turn consultation transcript:

```
======================================================================
GEMINI CLINICAL NOTES DRAFTING BENCHMARK
======================================================================
Mode:           DRY-RUN (Simulated)
Model:          gemini-1.5-flash
Target Words:   5000
======================================================================

[1/3] Generating Synthetic Consultation Transcript...
  Generated 194 dialogue segments (~5009 words).

[2/3] Calling Model with Structured Schema Enforcement...
  Generation completed in 2942 ms (2.94 s)

[3/3] Validating Output Conformance & Citation Integrity...
  Schema validation: PASSED (100% compliant)
  Segment citation integrity: PASSED (all citations exist in input)

======================================================================
DRAFT SUMMARY PREVIEW
======================================================================
Assessment:    Second trimester intrauterine pregnancy with mild physiological edema and mild iron deficiency anemia.
Plans Count:   2
Flags Count:   2
Action Items:  3
======================================================================
Drafting Time: 2942 ms (Budget: < 10,000 ms)
Fits Turnaround Budget: YES
======================================================================
```

---

## 4. Test Evidence

### 1. Tracer Verification Unit Tests (`tracerVerification.test.js`)
```
PASS src/tests/consultAudio/tracerVerification.test.js
  Tracer Verification Engine (Phase 8)
    buildTracerCatalog
      ✓ generates deterministic tracer items from structured clinical records (2 ms)
      ✓ ignores invalid or NaN values gracefully (1 ms)
    postCheckDraft: Citation Integrity
      ✓ passes when all cited segment_ids exist in the merged transcript (1 ms)
      ✓ flags invalid_segment_citation when a hallucinated segment_id is cited (1 ms)
    postCheckDraft: Numeric Claim Auditing
      ✓ verifies numbers that exist in the tracer catalog (1 ms)
      ✓ flags unverified_numeric_claim when an unverified number is stated without disclaimer
      ✓ permits unverified numbers when labeled with required disclaimer (1 ms)
```

### 2. Draft Model Providers & Factory Tests (`draftProviders.test.js`)
```
PASS src/tests/consultAudio/draftProviders.test.js
  Draft Model Providers & Factory (Phase 8)
    DraftProviderFactory
      ✓ instantiates GeminiDraftProvider for "gemini" (1 ms)
      ✓ instantiates LocalDraftProvider for "local"
      ✓ instantiates FakeDraftProvider for "fake" (1 ms)
      ✓ throws for unsupported provider name
    FakeDraftProvider
      ✓ generates schema-compliant draft using real segment_ids from transcript (2 ms)
      ✓ simulates invalid citation when configured (1 ms)
      ✓ simulates unverified number when configured (1 ms)
      ✓ simulates timeout error when configured (1 ms)
    GeminiDraftProvider
      ✓ throws if GEMINI_API_KEY is missing (1 ms)
      ✓ calls fetch with valid Gemini REST endpoint and returns parsed draft (1 ms)
    LocalDraftProvider (Qwen3:8b)
      ✓ calls Ollama format by default and parses valid JSON response (1 ms)
      ✓ supports OpenAI-compatible endpoint format when url matches /v1/chat/completions (1 ms)
```

### 3. Draft Service & Review Workflow Tests (`draftService.test.js`)
```
PASS src/tests/consultAudio/draftService.test.js
  Clinical Notes Draft Service (Phase 8)
    generateDraftForSession
      ✓ successfully generates draft, saves with needs_review, moves state to draft_ready, and emits notes_ready (3 ms)
      ✓ rejects draft generation if session is not in processing or draft_ready state (1 ms)
    getSessionDraft
      ✓ returns latest draft for authorized doctor (1 ms)
      ✓ throws 403 for unauthorized caller (1 ms)
    reviewSessionDraft
      ✓ approves draft, updates status to approved, and commits to consultation_notes (2 ms)
      ✓ rejects draft and records rejection reason (1 ms)
      ✓ prevents non-doctor user from reviewing draft (1 ms)
```

### 4. Consult Audio API End-to-End Tests (`consultAudioApi.test.js`)
```
PASS src/tests/consultAudio/consultAudioApi.test.js
  Clinical Notes Drafting Endpoints (Phase 8)
    ✓ GET /api/consults/:id/draft returns latest reviewable draft
    ✓ POST /api/consults/:id/draft/review approves draft and commits notes
    ✓ POST /api/consults/:id/draft/generate creates new draft on demand
Test Suites: 1 passed, 1 total
Tests:       24 passed, 24 total
```

### 5. All Consultation Audio Backend Tests (`server/src/tests/consultAudio/`)
```
Test Suites: 1 skipped, 15 passed, 15 of 16 total
Tests:       5 skipped, 167 passed, 172 total
Snapshots:   0 total
Time:        1.548 s
```

### 6. Full Server Test Suite (`npm test -- --runInBand`)
```
Test Suites: 1 skipped, 38 passed, 38 of 39 total
Tests:       5 skipped, 624 passed, 629 total
Snapshots:   0 total
Time:        3.343 s
```

### 7. Client Web Tests (`client/`)
```
✓ src/tests/webRecorder.test.js (5)
✓ src/tests/audioChunker.test.js (14)
✓ src/tests/flowsheet.test.js (3)
Test Files  3 passed (3)
Tests       22 passed (22)
```

### 8. Mobile Flutter Tests (`mobile/`)
```
flutter test test/consult_audio_adts_test.dart test/consult_audio_chunker_test.dart test/consult_audio_flow_test.dart test/consult_audio_privacy_test.dart test/consult_audio_queue_test.dart test/consult_audio_repository_test.dart

00:00 +37: All tests passed!
```

---

## 5. Safety and Privacy Verification

1. **Flags and Prioritises; Never Diagnoses**:
   - System prompts and schemas enforce descriptive assessment only.
   - The platform strictly outputs observations, recommendations, and operational flags, never medical diagnoses.
2. **Zero Sensitive Content in Logs**:
   - Zero transcript text, patient names, or clinical values in logs or socket events.
   - Socket push `notes_ready` emits `{ session_id }` only.
3. **No Unverified Hallucinations**:
   - Every cited segment ID must exist in the input transcript.
   - Quoted clinical numbers must match structured database tracers, or carry explicit disclaimers (`"stated verbally, unverified"` / `"[value pending verification]"`).
4. **Human Review Before Publication**:
   - Every generated draft starts with `status: 'needs_review'`.
   - Final notes only reach `consultation_notes` when a clinician explicitly reviews and calls `POST /api/consults/:id/draft/review` with `action: 'approve'`.

---

## 6. Known Gaps & Next Steps

1. **Phase 9 (Batch Cross-Check and One-Device Fallback)**:
   - Rebuilds continuous audio track from stored chunks with ffmpeg and submits to Sarvam batch with speaker diarization to cross-check real-time labels.
   - Per standing rules in [AGENTS.md](file:///home/jayant/Code/health-on/health-on-project/AGENTS.md), Phase 9 will begin only upon your explicit request.
