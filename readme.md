# MedBrief — Maternal Health Platform

MedBrief connects pregnant patients and their clinician around every appointment. Patients complete a pre-visit check-in (symptoms, vitals, a red-flag questionnaire) and upload lab reports; the platform reads those reports with OCR, standardizes the values, and shows the clinician a ready-to-use brief with trends and a triage queue. After the visit, the clinician records notes, prescriptions and action items that the patient can follow.

> MVP scope: a single doctor / single clinic. `clinician_id` is an explicit foreign key everywhere, so adding more clinicians later is a data change, not a schema change.

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Repository layout](#repository-layout)
- [Tech stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [API overview](#api-overview)
- [OCR pipeline](#ocr-pipeline)
- [Database](#database)
- [Testing](#testing)
- [Deployment](#deployment)
- [Further documentation](#further-documentation)

## Features

**Patients**
- Sign up, onboarding, and joining via a clinician's emailed invite link
- Pre-visit check-in: symptoms, vitals logging, and a yes/no red-flag questionnaire with autosave
- Pre-visit checklist generated per appointment (static rules, with rules that trigger on OCR failure or missing reports)
- Upload lab reports (PDF, PNG, JPG), preview OCR results, and choose which appointments each report is shared with
- Post-visit summary with action items and prescriptions
- Light / dark theme

**Clinicians**
- Onboarding and verification flow (with a demo self-verify switch for development)
- Dashboard, schedule, patient list and new-appointment creation with email invites
- Patient history grid and metric trend charts across visits
- Triage queue that flags abnormal or low-confidence lab values
- Reusable questionnaire and checklist templates
- Consultation notes, prescription upload, post-visit action items
- *Lab Inbox* and *Analytics* pages are placeholders ("Coming soon")

**Lab report intelligence**
- Digital PDFs are parsed directly; scans and photos fall back to PaddleOCR
- Extracted metrics are matched to a metric dictionary and unit-converted to a standard form
- Low-confidence or unparseable values are marked `needs_review` instead of being trusted blindly

## Architecture

```
                    ┌────────────────────┐
                    │  React client       │  Vite + Tailwind (port 5173)
                    └─────────┬──────────┘
                              │ REST (JWT from Supabase Auth)
                    ┌─────────▼──────────┐        ┌─────────────────────────┐
                    │  Express API        │──────► │ Supabase                │
                    │  (port 4000)        │        │ Postgres + Auth +       │
                    └─────────┬──────────┘        │ Storage (RLS policies)  │
                              │ multipart          └─────────────────────────┘
                    ┌─────────▼──────────┐
                    │ PaddleOCRFastAPI    │  POST /document/process (port 8000)
                    │  └─ ocr/ pipeline   │  pdfplumber → PaddleOCR fallback
                    └────────────────────┘
```

Upload flow: `POST /api/lab-reports/upload` → file stored in Supabase Storage → OCR service extracts → metrics standardized → `lab_reports` and `lab_report_metrics` saved. If OCR is down the report is still saved with `ocr_status = failed` so it can be reviewed by hand.

## Repository layout

```
.
├── client/              React + Tailwind frontend (pages, components, services, hooks)
├── server/              Node.js / Express API
│   ├── src/controllers  Request handlers
│   ├── src/routes       Route definitions per resource
│   ├── src/services     Business logic (triage, checklist, OCR, standardization, invites, storage)
│   ├── src/middleware   authGuard, roleGuard, validateBody (zod), upload, logging, errors
│   ├── src/tests        Jest + supertest suites
│   └── scripts          verifyClinician, restandardizeMetrics, ocrSmoke
├── ocr/                 Python extraction pipeline (digital + OCR engines, structure parser)
├── PaddleOCRFastAPI/    FastAPI service that hosts the OCR pipeline (vendored from neozhu/PaddleOCRFastAPI)
├── supabase/            config.toml, SQL migrations, seed data
└── docs/                Architecture and schema notes
```

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | React 18, React Router 7, Vite 5, Tailwind CSS 3, lucide-react, date-fns |
| Backend | Node.js, Express 4, zod, multer, nodemailer, axios |
| Database / Auth / Storage | Supabase (Postgres, Row Level Security, buckets `lab-reports` and `prescriptions`) |
| OCR | Python, FastAPI, PaddleOCR / PaddleX, pdfplumber, PyMuPDF |
| Testing | Jest, supertest, Python `unittest` |
| Hosting | Vercel (client, see `client/vercel.json`), Docker for the OCR service |

## Prerequisites

- Node.js 18+ and npm
- A Supabase project, or the [Supabase CLI](https://supabase.com/docs/guides/cli) + Docker for a local stack
- Python 3.9+ (3.12 recommended) or Docker, for the OCR service
- An SMTP account for invite emails (optional in development)

## Getting started

### 1. Clone and install

```bash
git clone https://github.com/jayant-chaudhary/health-on-project.git
cd health-on-project

npm --prefix server install
npm --prefix client install
```

### 2. Set up the database

Using the Supabase CLI (local stack, API on `54321`, DB on `54322`):

```bash
supabase start
supabase db reset        # applies supabase/migrations/* then supabase/seed/seed.sql
```

For a hosted project, link it and push the migrations with `supabase db push`, then run `supabase/seed/seed.sql`. Copy the project URL, anon key and service-role key for the next step.

### 3. Configure environment variables

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

Fill in the Supabase values — see [Configuration](#configuration).

### 4. Start the OCR service

```bash
cd PaddleOCRFastAPI
python -m venv .venv && source .venv/bin/activate     # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --port 8000
```

Or with Docker: `docker compose up --build` from `PaddleOCRFastAPI/`.

`GET http://localhost:8000/health` reports `ocr_models: pending` while models load/download on first run, then `ready`. Digital PDFs are served before that.

### 5. Start the API and the client

```bash
npm --prefix server run dev      # http://localhost:4000  (health: /health)
npm --prefix client run dev      # http://localhost:5173
```

The app works without the OCR service running; uploads will simply be saved as `failed` for manual review.

## Configuration

### `server/.env`

| Variable | Purpose |
| --- | --- |
| `PORT` | API port (default `4000`) |
| `NODE_ENV` | `development` / `production` / `test` |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase connection; the service-role key stays server-side only |
| `CLIENT_APP_URL` | Frontend origin, used for CORS and invite links |
| `OCR_SERVICE_URL` | Base URL of the OCR service (default `http://localhost:8000`) |
| `OCR_TIMEOUT_MS` | How long an upload waits for extraction (default `180000`) |
| `OCR_CONFIDENCE_REVIEW_THRESHOLD` | Metrics below this confidence go to review (default `0.85`) |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | Invite email delivery |
| `INVITE_TOKEN_TTL_HOURS` | Invite link lifetime (default `72`) |
| `LOG_LEVEL`, `LOG_FORMAT` | `debug\|info\|warn\|error\|silent`; `pretty` or `json` |
| `DEMO_SELF_VERIFY` | Lets clinicians verify themselves. **Set to `false` for real use** |

### `client/.env`

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Supabase project (anon key only) |
| `VITE_API_BASE_URL` | Express API URL (default `http://localhost:4000`) |
| `VITE_DEBUG_API` | Log every API call to the browser console |

OCR service tuning variables (`OCR_DET_MODEL`, `OCR_DEVICE`, `OCR_MAX_UPLOAD_BYTES`, …) are documented in [`server/OCR_INTEGRATION.md`](server/OCR_INTEGRATION.md).

## API overview

All routes are under `/api` and require a Supabase JWT unless noted. Role restrictions are enforced by `roleGuard`. `GET /health` is unauthenticated.

| Prefix | Purpose |
| --- | --- |
| `/api/auth` | signup, login, logout, `me`, invite lookup and acceptance |
| `/api/profile` | read/update profile, clinician demo-verify |
| `/api/patients` | patient list (clinician) |
| `/api/appointments` | create (clinician), list, get, update status |
| `/api/vitals` | log (patient) and list vitals |
| `/api/questionnaire` | templates (clinician), patient responses, responses per appointment |
| `/api/templates` | reusable clinician checklist/questionnaire templates |
| `/api/checklist` | per-appointment pre-visit checklist and item toggling |
| `/api/lab-reports` | upload, list, history, metric trends, triage queue, share/unshare with appointments, delete |
| `/api/post-visit` | visit summary, consultation notes, prescriptions, action items |
| `/api/ocr` | `GET /health` (no auth), `POST /recognize` (raw text lines for an image) |

See `server/src/routes/` for the exact endpoints and request schemas.

## OCR pipeline

Located in `ocr/` and served by `PaddleOCRFastAPI/` at `POST /document/process`.

- **Images** (png/jpg/jpeg) go straight to PaddleOCR.
- **PDFs** are first read by the digital engine (pdfplumber + PyMuPDF); if the result is scanned, garbled, empty or yields no test rows, PaddleOCR is used and the better reading wins.
- Results map to `ocr_status`: `success`, `partial` (low confidence or no rows), or `failed`.
- A metric is flagged `needs_review` when the value is non-numeric, a bound like `<0.5`, has an unconvertible unit, or is under the confidence threshold.

Details: [`ocr/README.md`](ocr/README.md) and [`server/OCR_INTEGRATION.md`](server/OCR_INTEGRATION.md).

## Database

Schema lives in `supabase/migrations/` (Postgres with RLS). Main tables:

`profiles`, `patient_details`, `clinician_details`, `appointments`, `appointment_invites`, `vitals_logs`, `questionnaire_templates`, `questionnaire_responses`, `lab_reports`, `lab_report_metrics`, `metric_dictionary`, `appointment_lab_reports`, `checklist_rule_templates`, `pre_visit_checklist_items`, `clinician_templates`, `consultation_checklist_items`, `consultation_notes`, `prescriptions`, `post_visit_action_items`, `quick_action_templates`.

Key enums: `user_role` (patient, clinician, receptionist), `appointment_status` (invited, active, checked_in, completed, cancelled), `ocr_status` (pending, success, partial, failed).

The metric dictionary is reference data and ships as migrations — add new lab spellings there, not in the seed.

Maintenance scripts (from `server/`):

```bash
npm run verify-clinician        # mark a clinician account as verified
npm run restandardize-metrics   # re-run standardization over stored lab metrics
node scripts/ocrSmoke.js path/to/report.pdf   # run one file through OCR and print the result
```

## Testing

```bash
# API: unit + route tests with Supabase and OCR mocked
cd server && npm test

# API end-to-end against a running OCR service
OCR_SERVICE_URL=http://localhost:8000 npm run test:e2e

# OCR pipeline routing tests (no engines needed)
cd ocr && python -m unittest discover -s tests
```

## Deployment

- **Client:** deploy `client/` to Vercel (`vercel.json` configures the Vite build and SPA rewrites). Set the `VITE_*` variables in the project settings.
- **API:** run `npm start` in `server/` on any Node host; set the environment from `server/.env.example`.
- **OCR service:** build the Docker image in `PaddleOCRFastAPI/`. Run one worker per container and keep it off the public internet — the API server should be the only caller.
- **Before going live:** set `DEMO_SELF_VERIFY=false`, use real SMTP credentials, and never expose `SUPABASE_SERVICE_ROLE_KEY` to the client.

## Further documentation

- [`docs/folderstructure`](docs/folderstructure) — original architecture and schema design notes
- [`ocr/README.md`](ocr/README.md) — extraction pipeline internals
- [`server/OCR_INTEGRATION.md`](server/OCR_INTEGRATION.md) — how the API talks to the OCR service
- [`PaddleOCRFastAPI/README.md`](PaddleOCRFastAPI/README.md) — the OCR service and its endpoints (upstream: neozhu/PaddleOCRFastAPI, see its `LICENSE`)
