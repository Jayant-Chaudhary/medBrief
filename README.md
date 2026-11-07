# Health-On (Maternal Health Platform)

Welcome to **Health-On** (also internally referred to as MedBrief), a comprehensive platform designed for maternal health clinics. The platform streamlines patient onboarding, appointment tracking, vitals logging, pre-visit questionnaires, longitudinal prenatal check-ins, automated clinical briefs, and digitized physical lab reports using an Optical Character Recognition (OCR) pipeline.

This project is structured as a monorepo containing the frontend web client, mobile patient app, backend server, a dedicated Python-based OCR microservice, and database configurations.

## Architecture & Tech Stack

The application follows a modern full-stack architecture:

- **Client (Clinician & Web Dashboard)**
  - **Framework**: React 18 with Vite
  - **Styling**: Tailwind CSS & Lucide React for icons
  - **Routing**: React Router DOM
  - **Integration**: `@supabase/supabase-js` for authentication and real-time updates
  - **Testing**: Vitest with `@testing-library/react`

- **Mobile (Patient Companion App)**
  - **Framework**: Flutter (Android-first)
  - **State & Architecture**: Clean MVC repository/controller architecture with Riverpod-ready reactive patterns
  - **Design System**: Warm maternal theme with accessible high-contrast typography, guided progressive wizards, and haptic feedback
  - **Testing**: Flutter Test suite (`flutter test`)

- **Server (Backend API)**
  - **Framework**: Node.js & Express.js
  - **AI Engine**: Google Gemini API (`gemini-flash-lite-latest`) with deterministic clinical rule-based fallback
  - **Validation**: Zod schema validation on all incoming payload boundaries
  - **Testing**: Jest & Supertest
  - **Features**: Business logic, interval-scoped check-in synthesis, OCR dictionary normalization, and appointment invites

- **OCR Service (PaddleOCRFastAPI)**
  - **Framework**: FastAPI (Python)
  - **Engine**: PaddleOCR for extracting text from physical medical reports
  - **Containerization**: Docker support included

- **Database (Supabase / Postgres)**
  - **Type**: Relational PostgreSQL via Supabase
  - **Security**: Strict Row-Level Security (RLS) policies on every table protecting patient PHI
  - **Storage**: Supabase Storage (private buckets) for lab reports, prescriptions, and media

---

## Repository Structure

```text
health-on-project/
├── client/                 # React clinician & patient web portal
├── mobile/                 # Flutter mobile patient companion application
├── server/                 # Node.js Express backend API & AI synthesis engine
├── PaddleOCRFastAPI/       # FastAPI microservice for document OCR
├── supaBase/               # Database migrations, RLS policies, and seed data
├── docs/                   # Architecture, audit, and feature documentation
│   ├── consult-audio/      # Consultation audio recording & transcription pipeline
│   └── prenatal-checkin/   # Detailed prenatal check-in & AI brief documentation
├── ocr/                    # Additional OCR related scripts/tools
└── readme.md               # Monorepo overview and developer setup
```

---

## Features & Modules

### 1. Role-Based Access & Security
- Discrete authentication flows and permission layers for `patient` and `clinician`.
- Strict PostgreSQL Row-Level Security (RLS) policies ensure patients only access their own records and clinicians only access their assigned clinic patients.

### 2. Appointment Management
- Clinicians schedule upcoming visits with automated magic-link invites sent via email.
- Complete appointment status lifecycle (`scheduled` → `confirmed` → `completed` → `cancelled`).

### 3. Pre-Visit Questionnaires & Checklists
- Pre-appointment questionnaires completed by patients prior to appointments to highlight immediate visit concerns.
- Post-appointment follow-up action checklists for medications and diagnostic tests.

### 4. Automated Lab Report Digitization (OCR)
- Patients upload physical lab photos (e.g., Complete Blood Count, iron panels).
- PaddleOCR microservice parses raw document text into standardized clinical metrics (e.g., mapping `"HGB"` to `"hemoglobin"`).
- Automated AI triage flags low-confidence parses for clinician verification.

### 5. Longitudinal Vitals Tracking
- Ongoing timeline tracking systolic/diastolic blood pressure, pulse, weight, fundal height, and fetal heart rate.
- Visual alerts for clinical thresholds (e.g., blood pressure > 140/90 mmHg for preeclampsia surveillance).

---

### 6. AI-Powered Prenatal Check-In & Pre-Visit Clinical Brief

A continuous, multi-tier prenatal surveillance system keeping expectant mothers connected with their care team between physical visits, paired with an automated AI synthesis engine that prepares a **30-second Pre-Visit Clinical Brief** for the doctor before every appointment.

For the in-depth specification, research foundation, database schema, and API contracts, see [docs/prenatal-checkin/PRENATAL_CHECKIN_AND_AI_BRIEF.md](./docs/prenatal-checkin/PRENATAL_CHECKIN_AND_AI_BRIEF.md).

#### A. Patient Experience & 3-Tier Check-In Cadence (Flutter Mobile)

Expectant mothers interact with three intuitive check-in modalities designed to capture timely data while preventing survey fatigue:

1. **Tier 1 — Routine Weekly Milestone Review (Every 7 Days)**
   - Guided 4-step progressive wizard taking under 2 minutes.
   - Questions dynamically adapt to gestational age (Trimester 1, 2, 3, and Term):
     - **Physical Sensations**: Gestational-week filtered surveillance (nausea/hyperemesis in T1; quickening & fetal movement in T2/T3; Braxton Hicks vs active labor in Term; edema, lightheadedness, and pain).
     - **Emotional Well-Being**: Validated perinatal mental health screening based on Edinburgh Postnatal Depression Scale (EPDS) and GAD-2 anxiety measures.
     - **Daily Routine & Vitamins**: Daily adherence tracking for prenatal vitamins (folic acid, iron, calcium), hydration, and sleep quality.
     - **Agenda for Today**: Free-text prompt allowing the mother to record questions or topics she wants to discuss with her doctor.

2. **Tier 2 — Quick 30-Second Pulse Check (Every 2–4 Days)**
   - A lightweight heartbeat check between weekly reviews.
   - 1-to-5 visual emoji comfort scale (`Very uncomfortable` to `Feeling great`).
   - One-tap quick symptom chips (`None`, `Nausea`, `Back pain`, `Pelvic pressure`, `Swelling`, `Headache`, `Fatigue`, `Heartburn`).
   - Optional short note for the doctor.

3. **Tier 3 — 24/7 Ad-Hoc Concern Logger (Always Available)**
   - Unscheduled spontaneous reporting anytime a patient experiences a new symptom, ache, or question (e.g., *"Today I felt stomach aches regularly after lunch"* or asking about dietary choices).
   - Allows logging severity (`mild`, `moderate`, `severe`) and categorizing concerns.

4. **Dynamic Home Cadence State Engine**
   - The mobile Home Tab calculates patient check-in recency in real time:
     - When a 7-day milestone is due: surfaces **"Weekly Check-In Due"** (`Start 2m`).
     - When interval pulse is due: surfaces **"Quick Pulse Due"** (`Quick Check 30s`).
     - When all check-ins for the day are complete: displays a reassuring green card **"You're all caught up! Check-in recorded today • Next pulse in X days"** (clean confirmation badge without duplicate buttons).
     - Directly beneath, the **"Have a concern right now? Log Concern"** card remains accessible 24/7.

5. **Real-Time Immediate Emergency Intercept**
   - If a mother reports critical danger signs (e.g., vaginal bleeding, blurred vision, sudden facial swelling, fluid leakage, or absent fetal movement), the survey halts immediately.
   - Displays a prominent red emergency triage card with hospital guidance and a 1-tap dial button for the clinic or emergency services.

---

#### B. Doctor Experience & Interval-Scoped AI Brief (React Web Portal)

Doctors do not have time to comb through raw logs or past transcripts during 12-minute appointments. The platform automatically condenses interval data into a prioritized 30-second brief:

```text
┌────────────────────────────────────────────────────────────────────────────────┐
│ ✦ Pre-Visit Clinical Brief  • ROUTINE BASELINE   Interval: 9 days since visit  │
├───────────────────────┬────────────────────────┬───────────────────────────────┤
│ ∿ Physical Sensations │ ☲ Emotional Well-Being │ 💊 Daily Routine & Meds       │
│ Back pain noted on    │ Positive mood (4/5).   │ Consistent daily adherence    │
│ ad-hoc log 2026-11-03.│ Mild anxiety (2/5).    │ to prenatal vitamins.         │
│ Comfort rating 2/5.   │ Sleep restfulness 4/5. │                               │
├───────────────────────┴────────────────────────┴───────────────────────────────┤
│ ❓ Patient's Agenda for Today                                                  │
│ "Is it okay to have a lot of peanuts?"                                         │
├────────────────────────────────────────────────────────────────────────────────┤
│ 📋 Suggested Clinical Focus                                                    │
│ Address persistent musculoskeletal back pain. Answer dietary peanut question.  │
└────────────────────────────────────────────────────────────────────────────────┘
```

- **Smart Visit-to-Visit Interval Scoping**:
  - The backend dynamically identifies the patient's **last completed physical visit** (`status = 'completed'`) and synthesizes all check-ins, pulses, vitals, and ad-hoc concerns recorded between that date and the upcoming appointment.
- **Historical Snapshot Preservation**:
  - Past completed visits retain an immutable snapshot of their historical summaries in `visit_ai_summaries`, ensuring an unalterable medical audit trail.
- **Google Gemini Synthesis Engine (`gemini-flash-lite-latest`)**:
  - Synthesizes complex multi-day longitudinal check-in data into structured JSON:
    - **Priority Tier**: `CRITICAL ATTENTION`, `PRIORITY WATCH`, or `ROUTINE BASELINE`.
    - **Obstetric Alerts**: Immediate surfacing of elevated blood pressure or red flags.
    - **3-Pillar Trajectories**: Physical sensations, emotional well-being, and medication adherence.
    - **Patient's Agenda**: Direct verbatim patient questions highlighted prominently so doctors address patient concerns first.
    - **Suggested Clinical Focus**: Concrete talking points and physical examination focus areas for the clinician.
- **Deterministic Rule-Based Fallback**:
  - If the Gemini API key is not configured or network limits are hit, an offline clinical rule engine extracts all flags and trajectories deterministically, ensuring 100% operational uptime.
- **On-Demand Re-Synthesis**:
  - Clinicians can click **Refresh** on the brief card to re-synthesize live if a patient submitted a last-minute pulse or concern in the waiting room.

---

### 7. Post-Visit Summaries & Action Items
- Clinicians record digital consultation notes, updated diagnoses, and prescriptions.
- Action items are pushed to the patient mobile app as a simple interactive checklist.

---

## Getting Started

### Prerequisites

- **Node.js**: v20+
- **Flutter SDK**: 3.22+ (for mobile app)
- **Python**: 3.9+ (for OCR microservice)
- **Supabase**: Cloud project or local Supabase CLI
- **Google Gemini API Key**: (Optional for AI synthesis, automatic offline fallback included)

---

### 1. Database Setup (Supabase)

Run the SQL migration scripts in order within the Supabase SQL Editor:

1. `supaBase/migrations/20261103000000_pregnancy_checkin_ai.sql` — Creates `patient_checkin_sessions`, `patient_checkin_answers`, `visit_ai_summaries`, and RLS security policies.
2. `supaBase/migrations/20261103100000_pregnancy_checkin_cadence.sql` — Adds multi-tier cadence support (`routine_weekly`, `quick_pulse`, `ad_hoc_concern`), comfort ratings, and interval tracking.

---

### 2. Backend Server Setup (`server/`)

Navigate to the `server` directory and install dependencies:

```bash
cd server
npm install
```

Configure your environment variables in `server/.env` (see `server/.env.example`):

```env
PORT=5000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-flash-lite-latest
```

Run automated backend tests (14 tests covering cadence, emergency intercepts, and interval scoping):

```bash
npm test
```

Start the development API server:

```bash
npm run dev
```

---

### 3. Patient Mobile App Setup (`mobile/`)

Navigate to the `mobile` directory and install Flutter packages:

```bash
cd mobile
flutter pub get
```

Run the automated widget and flow tests (7 tests covering question filtering, wizards, quick pulse, and cadence cards):

```bash
flutter test test/checkin_flow_test.dart
```

Launch the mobile app on an Android emulator or connected device:

```bash
flutter run
```

---

### 4. Clinician Web Client Setup (`client/`)

Navigate to the `client` directory and install dependencies:

```bash
cd client
npm install
```

Run web component tests (8 tests covering brief cards, priority tiers, and interval display):

```bash
npm test
```

Start the Vite development web server:

```bash
npm run dev
```

---

### 5. Document OCR Microservice (`PaddleOCRFastAPI/`)

Navigate to the `PaddleOCRFastAPI` directory and start using a virtual environment:

```bash
cd PaddleOCRFastAPI
python -m venv venv
# On Windows:
venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Alternatively, launch via Docker Compose:

```bash
docker-compose up --build
```

---

## Safety & Clinical Compliance Principles

1. **Flags and Prioritises, Never Diagnoses**:
   - The platform strictly provides clinical triage flags, symptom trajectories, and suggested discussion topics. No AI output or UI label ever generates a medical diagnosis.
2. **Zero PHI in Logs or Errors**:
   - No audio, transcript text, patient names, or health values are ever written to console logs, analytics, or error reporters. Only anonymized IDs, counts, and error status codes are emitted.
3. **Synthetic Test Data Only**:
   - All automated test suites, fixtures, and local seeds strictly use synthetic placeholder patient data.
4. **Resilient Offline Architecture**:
   - The clinical brief system operates seamlessly even in low-bandwidth or offline environments via deterministic clinical rule matching.

---

## Documentation Links

- **Prenatal Check-In & AI Pre-Visit Brief Architecture**: [docs/prenatal-checkin/PRENATAL_CHECKIN_AND_AI_BRIEF.md](./docs/prenatal-checkin/PRENATAL_CHECKIN_AND_AI_BRIEF.md)
- **Consultation Audio Pipeline**: [docs/consult-audio/IMPLEMENTATION.md](./docs/consult-audio/IMPLEMENTATION.md)
- **Mobile Companion Guide**: [mobile/README.md](./mobile/README.md)
- **Database Schema Deep-Dive**: [docs/folderstructure](./docs/folderstructure)
- **Deployment Guide (Railway)**: [docs/deploy-railway.md](./docs/deploy-railway.md)

---

## License

Please refer to the `LICENSE` file in individual subdirectories if applicable.
