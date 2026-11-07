# Phase 11 Implementation Plan: Hardening and Demo Rehearsal

**Status:** Proposed  
**Specification:** `docs/consult-audio/IMPLEMENTATION.md` (Phase 11)  
**Standing Rules:** `AGENTS.md` (work one phase at a time, wait for plan approval, synthetic test data only, zero patient/transcript logging, product flags and prioritizes, never diagnoses).

---

## 1. Goal

Phase 11 is the final phase of the consultation audio pipeline. It hardens the system against failures, enforces data privacy through automated log scrubbing audits, verifies deployment readiness for Render, and creates a clear rehearsal and demo manual (`DEMO.md`) for live clinical demonstrations.

---

## 2. Key Components to Build

### 1. End-to-End Rehearsal Script (`tools/simulate-device/rehearsal-e2e.js`)
- Runs a complete synthetic consultation simulation with two devices (Doctor Web + Patient Mobile):
  1. Creates or uses a test consultation session.
  2. Emulates parallel chunk streaming and final markers from both devices.
  3. Triggers `POST /api/consults/:id/end`.
  4. Waits for `notes_ready` (via polling or Socket.IO).
  5. Computes and prints a structured timing benchmark report:
     - End requested $\rightarrow$ all chunks transcribed
     - Chunks transcribed $\rightarrow$ merged timeline ready
     - Merged timeline $\rightarrow$ notes drafting completed
     - Total elapsed time from End to `notes_ready` (verifies compliance with the < 15s budget).

### 2. Log Scrubbing Audit Suite (`server/src/tests/consultAudio/logScrub.test.js`)
- Enforces the core repository standing rule: **"No audio, transcript text, names or health values in logs, errors, analytics or notification text. Log ids, counts, timings and error codes only."**
- Injects identifiable synthetic patient records, sensitive transcript text, and specific clinical numbers:
  - Patient name: `"Asha Devi"`
  - Sensitive transcript: `"Severe lower abdominal cramps radiating to back"`
  - Numeric vitals / lab metrics: `"145/95 mmHg"`, `"9.2 g/dL"`
- Executes ingestion, transcription worker, merge logic, tracer verification, and drafting service while intercepting all logger outputs (`logger.info`, `logger.warn`, `logger.error`, `logger.debug`, and `console`).
- Asserts that **zero occurrences** of sensitive strings or numeric values appear in any log output.

### 3. Failure Drills Test Suite (`server/src/tests/consultAudio/failureDrills.test.js`)
- **Drill 1 (Network Loss & Retry):** Simulates device chunk upload failure with packet drop / network errors, verifies exponential backoff retry and that all chunks are safely ingested without loss.
- **Drill 2 (One Device Never Joins / Patient Missing):** Simulates consultation where patient device never joins or uploads. Verifies:
  - Doctor-only mode completes cleanly when `end` is called.
  - Patient side is marked incomplete in session record and segment flags.
  - Session transitions to `processing` $\rightarrow$ `draft_ready` without hanging or timing out.
- **Drill 3 (Server Restart During `ending`):**
  - Simulates a server crash or Render deployment restart while a session is in the `ending` state with a persisted `end_deadline_at`.
  - Verifies `orchestratorService.start()` discovers the unfinished session, evaluates chunk completeness against the deadline, and resumes the session through merge and drafting.

### 4. Render Deployment Readiness Check (`tools/verify-render-deployment.js`)
- Standalone verification script checking:
  - HTTP Health check (`GET /health`) returns 200 OK.
  - ffmpeg static binary presence (`checkFfmpegInstalled`).
  - Required environment configuration (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `JWT_SECRET`, `SARVAM_API_KEY`, `GEMINI_API_KEY`).
  - Socket.IO CORS and proxy configuration.

### 5. Demo Playbook (`docs/consult-audio/DEMO.md`)
- Step-by-step guide for running live doctor + patient consultation demonstrations:
  - Pre-demo setup (browser permissions, environment flags).
  - Walkthrough script (starting consult, pairing with room code, recording, ending, reviewing draft).
  - Expected timing milestones.
  - Troubleshooting & contingency playbook (network glitch, permission reset, late chunk handling).
  - Clinical safety statement: "MedBrief flags and prioritizes; it never diagnoses."

---

## 3. Files to Create / Modify

| File | Type | Purpose |
|---|---|---|
| `tools/simulate-device/rehearsal-e2e.js` | New Script | End-to-end automated two-device consultation test with latency timing breakdown. |
| `server/src/tests/consultAudio/logScrub.test.js` | New Test Suite | Automated verification ensuring zero PII/transcript text/clinical values in logs. |
| `server/src/tests/consultAudio/failureDrills.test.js` | New Test Suite | Unit/integration tests for network drops, missing device fallback, and server crash during `ending`. |
| `tools/verify-render-deployment.js` | New Script | Production deployment checklist and automated health/environment validator for Render. |
| `docs/consult-audio/DEMO.md` | New Documentation | Rehearsal manual, live demo steps, talking points, and failure contingency playbook. |
| `docs/consult-audio/PHASE_11_IMPLEMENTATION_PLAN.md` | New Documentation | Repository copy of this implementation plan. |

---

## 4. Verification and Acceptance Criteria

1. `npm test -- src/tests/consultAudio/logScrub.test.js` passes with zero sensitive data detected in logs.
2. `npm test -- src/tests/consultAudio/failureDrills.test.js` passes with all three failure drills terminating cleanly and correctly flagged.
3. `rehearsal-e2e.js` executes end-to-end in `--dry-run` or mock mode, printing timing breakdown from `end` to `notes_ready` under 15 seconds.
4. `tools/verify-render-deployment.js` passes all local and simulated environment checks.
5. All 18+ consultAudio test suites and full server test suite (`npm test -- --runInBand`) pass cleanly.
