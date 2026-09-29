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
6. **Post-Visit Summaries**: Prescriptions, consultation notes, and action-item checklists.

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

For a deep dive into the database schema, table structures, and detailed folder mapping, please refer to [docs/folderstructure](./docs/folderstructure). deployment instructions can be found in `docs/deploy-railway.md`.

## License

Please refer to the `LICENSE` file in individual subdirectories if applicable.