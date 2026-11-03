# Prenatal Check-In & AI Pre-Visit Clinical Brief

Comprehensive architecture, clinical research, database schemas, API contracts, and user interactions for the AI-powered prenatal check-in feature in MedBrief.

---

## 1. Executive Summary & Clinical Background

### The Clinical Problem
In standard prenatal care, pregnant patients visit their obstetrician every 4 weeks in early pregnancy, every 2 weeks starting at week 28, and weekly after week 36. 

During the multi-week intervals between visits:
1. **Recall Bias & Symptom Normalization:** Patients often forget when mild symptoms began or normalize acute complications (e.g., attributing preeclamptic visual scotoma or sudden facial edema to "normal pregnancy fatigue").
2. **Under-reported Perinatal Mental Health:** Perinatal mood and anxiety disorders (PMAD) affect ~20% of pregnant individuals. Due to perceived stigma and rushed 12-minute appointments, fewer than 1 in 5 discuss feelings of panic or intrusive worry in person.
3. **Doctor Cognitive Overload:** Doctors do not have the time to read raw, unstructured chat transcripts. They need a **30-second distilled clinical brief** highlighting red flags and trajectories before entering the exam room.

### The Solution
An end-to-end, privacy-compliant, and strictly non-breaking system:
- **Patient Side (Flutter Mobile):** Bite-sized (<2 min) guided check-ins combining trimester-adaptive physical sensations, validated mental health screening (EPDS & GAD-2), daily routine adherence, and an open doctor agenda. Includes an immediate **Emergency Intercept** modal for acute danger signs.
- **Backend (Node.js & Gemini 2.5 Flash):** An automated synthesis engine analyzing 28-day longitudinal trajectories, recent vitals, and obstetric history into structured JSON clinical briefs (with a deterministic rule fallback for offline testing).
- **Clinician Side (React Dashboard):** A collapsible 30-second pre-visit brief card categorizing priority alerts, 3-pillar trajectories, patient concerns, and suggested clinical focus points.

---

## 2. Non-Negotiable Safety & Privacy Rules

1. **Flags and Prioritises; Never Diagnoses:** The feature surfaces alerts, priority tiers (`low`, `moderate`, `high`, `urgent`), and clinical trends. Neither UI copy nor LLM outputs ever issue a definitive medical diagnosis.
2. **Strict Privacy in Logs:** No patient names, audio, raw chat transcripts, or sensitive health numbers are recorded in server logs, analytics, or error outputs. Only IDs, counts, timings, and status codes.
3. **Zero Disruption to Existing Code:** All existing questionnaire routes (`/api/questionnaire`), appointments, OCR triage, and consult audio recording features remain 100% untouched and functional.

---

## 3. Architecture & File Catalog

### A. Database Migrations (`supaBase/`)
- **`supaBase/migrations/20261103000000_pregnancy_checkin_ai.sql`:**
  - `patient_checkin_sessions`: Tracks routine weekly and pre-visit check-ins, gestational age, and status (`completed` or `flagged_urgent`).
  - `patient_checkin_answers`: Stores answers across Physical, Mental, and Medical categories with boolean, scale (1–5), and text support.
  - `visit_ai_summaries`: Stores synthesized clinical briefs, risk tiers, red-flag arrays, 3-pillar trajectories, and clinician talking points.
  - Row Level Security (RLS) enabled on all 3 tables with role-scoped policies.
- **`supaBase/rollbacks/20261103000000_pregnancy_checkin_ai.sql`:** Clean rollback script.

### B. Server Implementation (`server/`)
- **`server/src/config/checkin.config.js`:** Centralized settings (lookback window: 28 days, timeout: 15s, model: `gemini-2.5-flash`).
- **`server/src/validators/checkin.validators.js`:** Zod schemas for sessions, question keys, and answers.
- **`server/src/services/checkin.service.js`:** Recording check-in sessions and escalating status to `flagged_urgent` when danger signs are present.
- **`server/src/services/checkinAi.service.js`:** Gathers 28-day history, vitals, and obstetric context. Invokes Gemini 2.5 Flash with structured output instructions, falling back to an offline deterministic clinical rule engine when no API key is present.
- **`server/src/controllers/checkin.controller.js`:** Controllers for submit, history lookup, brief retrieval, and on-demand synthesis.
- **`server/src/routes/checkin.routes.js`:** API routes mounted at `/api/checkin` in `server/src/app.js`.
- **`server/src/tests/checkin.test.js`:** Automated test suite covering input validation, red-flag escalation, role security, and AI brief synthesis.

### C. Patient Mobile App (`mobile/`)
- **`mobile/lib/features/checkin/checkin_models.dart`:** Data classes for `CheckinAnswerPayload`, `CheckinSessionResult`, and `VisitAiSummary`.
- **`mobile/lib/features/checkin/prenatal_questions.dart`:** Researched question bank with gestational-age filtering (`PrenatalQuestionsBank`).
- **`mobile/lib/features/checkin/guided_checkin_page.dart`:** 4-step progressive card UI with thumb-friendly controls, optional details, and an **Emergency Intercept Modal** with direct tap-to-call triage advice.
- **`mobile/lib/features/checkin/checkin_repository.dart`:** Methods for `submitPeriodicCheckin`, `getCheckinHistory`, and `getAiVisitSummary`.
- **`mobile/lib/features/home/home_tab.dart`:** "Weekly Check-In" dashboard card.
- **`mobile/lib/features/home/home_page.dart`:** Calculates gestational week from due date and launches check-in.
- **`mobile/test/checkin_flow_test.dart`:** Automated Flutter widget and flow tests.

### D. Clinician Web Portal (`client/`)
- **`client/src/components/clinician/PreVisitAiBriefCard.jsx`:** 30-second collapsible pre-visit brief card rendering priority status, red-flag alerts, 3-pillar trajectory, patient questions, and clinician action points. Includes an on-demand re-synthesize button.
- **`client/src/services/clinicianService.js`:** Updated to fetch `aiSummary` in `fetchPatientDashboard` and generate briefs via `generatePreVisitSummary`.
- **`client/src/pages/clinician/ClinicianDashboard.jsx`:** Embedded brief card with live patch updates.
- **`client/src/tests/preVisitAiBrief.test.jsx`:** Vitest tests verifying ungenerated state, urgent alerts, 3-pillar rendering, and safety disclaimers.

---

## 4. API Endpoints

| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/checkin/sessions` | Patient | Record check-in answers across Physical, Mental, and Routine dimensions |
| `POST` | `/api/checkin/quick-pulse` | Patient | Submit 30-second comfort pulse check (every 2-4 days) |
| `POST` | `/api/checkin/ad-hoc` | Patient | 24/7 Spontaneous patient symptom or concern log (with emergency intercept) |
| `GET` | `/api/checkin/status` | Patient / Clinician | Retrieve check-in cadence status and upcoming due type |
| `GET` | `/api/checkin/history` | Authenticated | Retrieve historical check-in sessions (supports `?lookbackDays=28`) |
| `GET` | `/api/checkin/summary/:appointmentId` | Clinician / Patient | Retrieve the synthesized AI pre-visit clinical brief |
| `POST` | `/api/checkin/summary/:appointmentId/generate` | Clinician | Generate or re-synthesize interval brief (from last visit to this appointment) |

---

## 5. Automated Test Evidence

- **Server Test Suite:** 14/14 tests passed in `checkin.test.js` (including ad-hoc concern escalation, quick pulses, status cadence, and interval scoping).
- **Mobile Test Suite:** 7/7 tests passed in `checkin_flow_test.dart` (including dynamic cadence card, ad-hoc concern modal, and quick pulse sheet).
- **Web Client Test Suite:** 8/8 tests passed in `preVisitAiBrief.test.jsx` (including interval display and safety disclaimers).

