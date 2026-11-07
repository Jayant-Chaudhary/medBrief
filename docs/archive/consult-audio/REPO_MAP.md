# MedBrief Repository Map: Consult-Audio Context

This document maps the architectural patterns, database schemas, API structures, frontend, and mobile apps in MedBrief to guide the consult-audio implementation.

---

## 1. Backend Structure (Node.js / Express)

- **Entry Point:** [server/src/app.js](file:///home/jayant/Code/health-on/health-on-project/server/src/app.js)
  - Uses Express 4 with middleware for JSON bodies (`5mb` default limit, `64kb` for community routes), URL-encoded parsing, cookies, CORS, request IDs (`X-Request-Id`), and global error handling.
  - Server listens on port configured via `PORT` (default: 4000).
- **Environment & Config:** [server/src/config/env.js](file:///home/jayant/Code/health-on/health-on-project/server/src/config/env.js)
  - Validates required environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CLIENT_APP_URL`, `OCR_SERVICE_URL`, `OCR_CONFIDENCE_REVIEW_THRESHOLD`.
  - Config object exports values with typed parsing and sensible fallbacks.
- **Logging & Privacy:** [server/src/utils/logger.js](file:///home/jayant/Code/health-on/health-on-project/server/src/utils/logger.js)
  - Leveled logger (`debug`, `info`, `warn`, `error`).
  - Strict regex-based redaction (`/authorization|password|token|secret|cookie|api[-_]?key|service[-_]?role/i`).
  - Structured metadata serialization and request ID tracing.
- **Routing Organization:** [server/src/routes/](file:///home/jayant/Code/health-on/health-on-project/server/src/routes)
  - Organized modularly: `auth.routes.js`, `appointments.routes.js`, `labReports.routes.js`, `vitals.routes.js`, `postVisit.routes.js`, `checklist.routes.js`, etc.
  - Each route file defines an Express Router attached to controllers in [server/src/controllers/](file:///home/jayant/Code/health-on/health-on-project/server/src/controllers).
- **Authentication & Authorization Middleware:**
  - [server/src/middleware/authGuard.js](file:///home/jayant/Code/health-on/health-on-project/server/src/middleware/authGuard.js): Validates Supabase JWT from `Authorization: Bearer <token>`, fetches user profile and clinician verification status, and sets `req.user = { id, email, role, fullName, isVerified }`.
  - [server/src/middleware/roleGuard.js](file:///home/jayant/Code/health-on/health-on-project/server/src/middleware/roleGuard.js): Enforces required roles (`clinician`, `patient`, `receptionist`).

---

## 2. Database & Migrations (Supabase PostgreSQL)

- **Migration Tool:** Timestamp-ordered SQL files in [supabase/migrations/](file:///home/jayant/Code/health-on/health-on-project/supabase/migrations), managed by Supabase CLI (`supabase db push` / `supabase migration up`).
- **Row Level Security (RLS):** Enabled by default on every table. The backend interacts through `supabaseAdminClient.js` using the Supabase Service Role Key to bypass RLS when performing trusted system orchestration, while direct client interactions abide by table policies.
- **Core Entities & Tables:**
  - `profiles`: `id` (references `auth.users`), `role` (`patient`, `clinician`, `receptionist`), `full_name`, `phone`, `created_at`.
  - `appointments`: `id` (uuid), `patient_id` (uuid -> profiles), `clinician_id` (uuid -> profiles), `scheduled_at` (timestamptz), `status` (`invited`, `active`, `checked_in`, `completed`, `cancelled`).
  - `appointment_invites`: `id`, `appointment_id`, `patient_email`, `token`, `expires_at`, `used_at`.
  - `lab_reports`: `id`, `patient_id`, `appointment_id`, `storage_path` (bucket: `lab-reports`), `ocr_status`, `raw_ocr_payload`, `report_date`.
  - `metric_dictionary`: Standard clinical metric catalog (`standard_key`, `display_name`, `category`, `unit_standard`, `aliases`).
  - `lab_report_metrics`: `id`, `lab_report_id`, `raw_key`, `standard_key`, `raw_value`, `parsed_value`, `unit_raw`, `unit_standard`, `confidence_score`, `needs_review`.
  - `vitals_logs`: `id`, `patient_id`, `appointment_id`, `metric_key`, `value`, `unit`, `recorded_at`, `source`.
  - `consultation_notes`: `id`, `appointment_id`, `clinician_id`, `notes_text`, `created_at`, `updated_at`.
  - `prescriptions`: `id`, `appointment_id`, `storage_path` (bucket: `prescriptions`), `typed_instructions`.

---

## 3. Storage Setup

- **Supabase Storage:**
  - Existing buckets: `lab-reports`, `prescriptions`, `community-media`.
  - Consult audio will introduce a private bucket `consult-audio` storing chunks under `consults/{session_id}/{device}/{seq}.{ext}`.

---

## 4. Test Runner & Linting

- **Test Framework:** Jest v30 configured in [server/jest.config.js](file:///home/jayant/Code/health-on/health-on-project/server/jest.config.js).
- **Execution:**
  - Unit/integration: `npm test` runs `**/tests/**/*.test.js`.
  - End-to-end: `npm run test:e2e` sets `RUN_E2E=true` for `*.e2e.test.js`.
- **Environment:** `testEnvironment: 'node'`, timeout 5000ms (300000ms for e2e).

---

## 5. Existing AI / Model Integrations

- **OCR Service:**
  - Python FastAPI service (`PaddleOCRFastAPI`) hosted externally (configured via `OCR_SERVICE_URL`).
  - Ingests scanned lab reports, parses layout and bounding boxes, extracts key-value pairs, and maps them to `metric_dictionary`.
- **LLM Integrations (Gemini / OpenAI):**
  - None present in the current codebase.
  - Gemini integration will be introduced in Phase 8 for clinical note drafting with schema-enforced output.

---

## 6. Frontend: Doctor Dashboard (React)

- **Location:** [client/](file:///home/jayant/Code/health-on/health-on-project/client)
- **Stack:** Vite 5, React 18, React Router v7, Tailwind CSS, Lucide React, Supabase JS.
- **Structure:**
  - `src/App.jsx`, `src/main.jsx`: Router configuration.
  - `src/context/`: `AuthContext.jsx` for session persistence.
  - `src/pages/`: Clinician dashboards, patient record views, lab report review screens.
  - `src/services/`: API client fetching from backend `/api/...`.
- **Consult Audio Integration Point:**
  - Will add doctor session management, room code generation, browser audio recording with pure function chunking, and draft review UI.

---

## 7. Mobile App: Patient Companion (Flutter)

- **Location:** [mobile/](file:///home/jayant/Code/health-on/health-on-project/mobile)
- **Stack:** Flutter SDK >=3.10.0 <4.0.0, `supabase_flutter: ^2.18.3`, `flutter_secure_storage: ^11.2.0`, `http: ^1.6.0`, `firebase_messaging: ^17.0.1`.
- **Structure:**
  - `lib/main.dart`, `lib/app.dart`: Entry and core routing.
  - `lib/features/`: Feature modules (`auth`, `checkin`, `home`, `reports`, `summary`, `community`).
- **Consult Audio Integration Point:**
  - Will add a consult join flow (room code entry, room-level consent, microphone level check, background audio service, chunk upload queue with local retry).
