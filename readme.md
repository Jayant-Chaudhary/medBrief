# Health-On (Maternal Health Platform)

Welcome to **Health-On** (also internally referred to as MedBrief), a comprehensive platform designed for maternal health clinics. The platform streamlines patient onboarding, appointment tracking, vitals logging, pre-visit questionnaires, and automates the digitization of physical lab reports using an Optical Character Recognition (OCR) pipeline.

This project is structured as a monorepo containing the frontend client, backend server, a dedicated Python-based OCR microservice, and database configurations.

## Architecture & Tech Stack

The application follows a modern full-stack architecture:

- **Client (Frontend)**
  - **Framework**: React 18 with Vite
  - **Styling**: Tailwind CSS & Lucide React for icons
  - **Routing**: React Router DOM
  - **Integration**: `@supabase/supabase-js` for authentication and real-time updates

- **Server (Backend)**
  - **Framework**: Node.js & Express.js
  - **Validation**: Zod
  - **Testing**: Jest & Supertest
  - **Features**: Handles business logic, triggers standardization of OCR results, and sends appointment invites (via Nodemailer)

- **OCR Service (PaddleOCRFastAPI)**
  - **Framework**: FastAPI (Python)
  - **Engine**: PaddleOCR for extracting text from physical medical reports
  - **Containerization**: Docker support included

- **Database (Supabase / Postgres)**
  - **Type**: Relational PostgreSQL via Supabase
  - **Storage**: Supabase Storage for lab reports and prescriptions
  - **Schema**: Encompasses patient profiles, appointments, vitals, lab report metrics, and checklists.

## Repository Structure

```text
health-on-project/
├── client/                 # React frontend application
├── mobile/                 # Flutter patient app (Android first)
├── server/                 # Node.js Express backend API
├── PaddleOCRFastAPI/       # FastAPI service for document OCR
├── supabase/               # Database migrations and seed data
├── docs/                   # Architecture and deployment documentation
├── ocr/                    # Additional OCR related scripts/tools
└── readme.md               # This README file
```

## Features (MVP)

1. **Role-Based Access**: Specialized views for `patient` and `clinician`.
2. **Appointment Management**: Clinicians can schedule appointments and send magic-link invites to patients.
3. **Pre-Visit Workflows**: Patients can fill out Yes/No questionnaires that highlight red flags for clinicians.
4. **Automated Lab Report Processing**:
   - Patients upload physical lab reports (e.g., blood work).
   - The OCR microservice parses the text.
   - The backend maps raw OCR text (e.g., "HGB") to standard medical dictionary keys ("hemoglobin") and converts units.
   - Low-confidence parses are flagged for manual clinical review ("AI Triage Alerts").
5. **Vitals Tracking**: Continuous timeline of patient vitals across appointments.
6. **AI-Powered Prenatal Check-In & Pre-Visit Clinical Brief Flow**:
   - **Longitudinal Micro Check-Ins (<2 mins)**: Asynchronous weekly mobile check-ins and 48-hour pre-visit surveys covering 4 structured pillars: Physical & Obstetric, Emotional & Mood (EPDS/GAD-2 screening), Daily Routine & Vitamins, and Open Agenda for the Doctor.
   - **Trimester-Adaptive 9-Month Flow**:
     - *1st Trimester (Weeks 1–13)*: Early surveillance for bleeding, cramping, and severe hyperemesis/dehydration; daily folic acid adherence; early emotional fatigue.
     - *2nd Trimester (Weeks 14–27)*: Quickening/fetal kick surveillance (week 24+), sudden facial/hand edema (week 20+), contraction rhythm (week 22+), lightheadedness, and iron supplementation.
     - *3rd Trimester (Weeks 28–36)*: Daily fetal kick counts (DFM), persistent severe headache & visual aura (preeclampsia watch), labor dread / birth anxiety screening, and sleep fragmentation.
     - *Term & Delivery (Weeks 37–40+)*: Active labor contractions (5-1-1 rule), fluid leakage/rupture of membranes, bloody show, and continuous fetal movement monitoring.
   - **Immediate Emergency Intercept**: If a patient reports acute danger signs (e.g., vaginal bleeding, blurred vision, or absent fetal kicks), the survey halts immediately and displays emergency clinic triage instructions with one-tap dialing.
   - **Doctor-Facing 30-Second Clinical Brief**: Gemini 2.5 Flash synthesizes the last 28 days of check-in answers, vitals trajectories, and patient-typed concerns into a prioritized pre-visit card (Urgent Red Flags, 3-Pillar Trajectory, Patient Agenda, and Clinician Talking Points) directly on the web consultation dashboard.
7. **Post-Visit Summaries**: Prescriptions, consultation notes, and action-item checklists.

## Getting Started

### Prerequisites

- Node.js (v20+)
- Python (3.9+)
- Docker (optional, for OCR microservice)
- A Supabase Project

### 1. Client Setup

Navigate to the client directory and install dependencies:

```bash
cd client
npm install
```

Start the development server:

```bash
npm run dev
```

### 2. Server Setup

Navigate to the server directory and install dependencies:

```bash
cd server
npm install
```

Create a `.env` file in the `server` directory based on required environment variables (e.g., Supabase keys, DB connection strings, SMTP credentials).

Start the backend in development mode:

```bash
npm run dev
```

### 3. OCR Microservice Setup

Navigate to the `PaddleOCRFastAPI` directory. It is highly recommended to use a virtual environment:

```bash
cd PaddleOCRFastAPI
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

Run the FastAPI application:

```bash
uvicorn main:app --reload
```
Alternatively, you can use the provided `docker-compose.yml` to spin up the OCR service via Docker.

### 4. Database Setup

Ensure you have the Supabase CLI installed, or use the Supabase web dashboard to run the SQL definitions located in `docs/folderstructure` (or in the `supabase/migrations` folder) to initialize your tables, enums, and Row Level Security (RLS) policies.

## Documentation

Android patient app setup and authentication workflow: [mobile/README.md](./mobile/README.md).

For a deep dive into the database schema, table structures, and detailed folder mapping, please refer to [docs/folderstructure](./docs/folderstructure). deployment instructions can be found in `docs/deploy-railway.md`.

## License

Please refer to the `LICENSE` file in individual subdirectories if applicable.
