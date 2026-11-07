# Health-On (MedBrief) — Complete Setup & Installation Guide

This guide provides end-to-end instructions for installing, configuring, and running the **Health-On (MedBrief)** maternal health platform on both **Windows** (PowerShell / Command Prompt) and **Linux** (Ubuntu, Debian, Fedora, Arch, WSL2).

---

## Table of Contents

1. [Prerequisites Matrix](#1-prerequisites-matrix)
2. [Automated 1-Step Setup](#2-automated-1-step-setup)
   - [Linux / macOS Auto-Setup](#linux--macos-auto-setup)
   - [Windows Auto-Setup](#windows-auto-setup)
3. [Manual Step-by-Step Installation](#3-manual-step-by-step-installation)
   - [Step 1: Clone & Repository Structure](#step-1-clone--repository-structure)
   - [Step 2: Environment Configuration (.env files)](#step-2-environment-configuration-env-files)
   - [Step 3: Supabase Database & Storage Setup](#step-3-supabase-database--storage-setup)
   - [Step 4: Backend API Server (`server/`)](#step-4-backend-api-server-server)
   - [Step 5: React Doctor Dashboard (`client/`)](#step-5-react-doctor-dashboard-client)
   - [Step 6: Document OCR Microservice (`PaddleOCRFastAPI/`)](#step-6-document-ocr-microservice-paddleocrfastapi)
   - [Step 7: Whisper Speech-to-Text Microservice (`whisper-service/`)](#step-7-whisper-speech-to-text-microservice-whisper-service)
   - [Step 8: Redis Audio Cache (Optional)](#step-8-redis-audio-cache-optional)
   - [Step 9: Mobile Patient App (`mobile/`)](#step-9-mobile-patient-app-mobile)
   - [Step 10: Community Peer Support Subsystem (Optional)](#step-10-community-peer-support-subsystem-optional)
4. [Running the Full Stack](#4-running-the-full-stack)
   - [Multi-Service Launcher Scripts](#multi-service-launcher-scripts)
   - [Service Port & Health Check Matrix](#service-port--health-check-matrix)
5. [Operating System Gotchas & Troubleshooting](#5-operating-system-gotchas--troubleshooting)
   - [Windows-Specific Troubleshooting](#windows-specific-troubleshooting)
   - [Linux-Specific Troubleshooting](#linux-specific-troubleshooting)
   - [Authentication & Supabase Troubleshooting](#authentication--supabase-troubleshooting)

---

## 1. Prerequisites Matrix

Before installing, ensure your host machine has the required runtimes and tools installed:

| Tool / Runtime | Minimum Version | Windows Installation Command | Linux (Ubuntu/Debian) Command |
|---|---|---|---|
| **Node.js** | `>= 20.12.0` (Recommended: **v24**) | `winget install OpenJS.NodeJS.LTS` | `curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh \| bash && nvm install 24` |
| **npm** | `>= 10.0.0` | Bundled with Node.js | Bundled with Node.js |
| **Python** | `3.10` – `3.12` | `winget install Python.Python.3.12` | `sudo apt update && sudo apt install python3 python3-pip python3-venv python3-dev` |
| **Git** | `>= 2.30` | `winget install Git.Git` | `sudo apt install git` |
| **Docker Desktop** *(Optional, for Redis/OCR)* | `>= 24.0` | `winget install Docker.DockerDesktop` | `sudo apt install docker.io docker-compose-v2` |
| **Flutter SDK** *(Optional, for Mobile App)* | `>= 3.22.0` | Download from [flutter.dev](https://docs.flutter.dev/get-started/install/windows/mobile) | Download from [flutter.dev](https://docs.flutter.dev/get-started/install/linux/mobile) |
| **Android Platform Tools (ADB)** | Current | Included in Android Studio or `winget install Google.PlatformTools` | `sudo apt install adb` |
| **PostgreSQL CLI (`psql`)** *(Optional for community scripts)* | `>= 14.0` | `winget install PostgreSQL.PostgreSQL` | `sudo apt install postgresql-client` |
| **FFmpeg** *(For audio conversion)* | `>= 4.4` | `winget install Gyan.FFmpeg` | `sudo apt install ffmpeg` |

> [!TIP]
> **Node.js 24 Note**: MedBrief services use Node's native `--env-file` parameter. Using Node 20.12+ or Node 24 avoids external env loading discrepancies.

---

## 2. Automated 1-Step Setup

We provide automated setup scripts that verify prerequisites, create `.env` and `config.json` files from templates, install all Node.js and Python dependencies, and prepare your workspace.

### Linux / macOS Auto-Setup

1. Open your terminal in the repository root:
   ```bash
   chmod +x setup.sh start-all.sh
   ./setup.sh
   ```
2. The script will:
   - Check Node.js, Python, Git, Docker, and Flutter.
   - Automatically copy `server/.env.example` $\rightarrow$ `server/.env` if not present.
   - Automatically copy `client/.env.example` $\rightarrow$ `client/.env` if not present.
   - Automatically copy `mobile/config.example.json` $\rightarrow$ `mobile/config.json` if not present.
   - Install backend dependencies (`server/npm install`).
   - Install frontend dependencies (`client/npm install`).
   - Create Python virtual environments and install packages for `PaddleOCRFastAPI` and `whisper-service`.
   - Install Flutter dependencies (`mobile/flutter pub get`) if Flutter is detected.
   - Generate encryption keypairs for storage envelope encryption.
3. Start all services:
   ```bash
   ./start-all.sh
   ```

---

### Windows Auto-Setup

You can use either **PowerShell** or standard **Command Prompt (CMD)**:

#### Option A: Using PowerShell (Recommended)
1. Open PowerShell **as Administrator** or standard user and allow script execution:
   ```powershell
   Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
   ```
2. Navigate to the project root and run:
   ```powershell
   .\setup.ps1
   ```
3. Start all services:
   ```powershell
   .\start-all.ps1
   ```

#### Option B: Using Command Prompt (CMD)
1. Navigate to the project root and run:
   ```cmd
   setup.bat
   ```
2. Start all services:
   ```cmd
   start-all.bat
   ```

---

## 3. Manual Step-by-Step Installation

If you prefer to configure each component manually or are troubleshooting a specific service, follow the detailed steps below.

### Step 1: Clone & Repository Structure

Ensure you are in the project root:
```bash
cd health-on-project
```

Verify the key directories exist:
- `server/` — Node.js Express backend
- `client/` — React Vite clinician web dashboard
- `mobile/` — Flutter mobile companion app
- `PaddleOCRFastAPI/` — Python PaddleOCR service
- `whisper-service/` — Faster-Whisper local STT service
- `supabase/` — PostgreSQL migrations and schemas

---

### Step 2: Environment Configuration (.env files)

#### 1. Backend API (`server/.env`)
Copy the template:
- **Linux/macOS**: `cp server/.env.example server/.env`
- **Windows (PowerShell)**: `Copy-Item server\.env.example server\.env`
- **Windows (CMD)**: `copy server\.env.example server\.env`

Open `server/.env` and configure your credentials:
```env
PORT=4000
HOST=0.0.0.0
NODE_ENV=development
CLIENT_APP_URL=http://localhost:5173

# Supabase Credentials (from Supabase Dashboard -> Project Settings -> API)
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# AI & LLM Provider (Google Gemini)
GEMINI_API_KEY=your-gemini-api-key
GEMINI_MODEL=gemini-flash-lite-latest

# Microservice URLs
OCR_SERVICE_URL=http://localhost:8000
WHISPER_SERVICE_URL=http://localhost:8001
REDIS_URL=redis://127.0.0.1:6379

# Storage Envelope Encryption (generate with `npm run generate-keys` in server/)
STORAGE_ENCRYPTION_KEY_ID="v1"
STORAGE_ENCRYPTION_RSA_PUBLIC_KEY="<base64-public-key>"
STORAGE_ENCRYPTION_RSA_PRIVATE_KEY="<base64-private-key>"

# Development mode self-verification for clinicians
DEMO_SELF_VERIFY=true
LOG_LEVEL=debug
```

#### 2. Clinician Web Client (`client/.env`)
Copy the template:
- **Linux/macOS**: `cp client/.env.example client/.env`
- **Windows (PowerShell)**: `Copy-Item client\.env.example client\.env`
- **Windows (CMD)**: `copy client\.env.example client\.env`

Configure `client/.env`:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_API_BASE_URL=http://localhost:4000
VITE_DEBUG_API=true
VITE_PATIENT_SIMILARITY_ENABLED=true
VITE_PATIENT_SIMILARITY_USE_SYNTHETIC_DATA=true
VITE_ASSISTANT_ENABLED=true
```

#### 3. Mobile Companion App (`mobile/config.json`)
Copy the template:
- **Linux/macOS**: `cp mobile/config.example.json mobile/config.json`
- **Windows (PowerShell)**: `Copy-Item mobile\config.example.json mobile\config.json`
- **Windows (CMD)**: `copy mobile\config.example.json mobile\config.json`

Ensure `mobile/config.json` points to:
```json
{
  "SUPABASE_URL": "https://your-project-id.supabase.co",
  "SUPABASE_PUBLISHABLE_KEY": "your-supabase-anon-key",
  "API_BASE_URL": "http://127.0.0.1:4000"
}
```

---

### Step 3: Supabase Database & Storage Setup

Health-On uses Supabase PostgreSQL with strict Row-Level Security (RLS) and private Storage Buckets.

#### 1. Hosted Supabase (Recommended)
1. Create a free project at [supabase.com](https://supabase.com).
2. Go to **SQL Editor** in the Supabase Dashboard.
3. Apply the migration scripts located in `supabase/migrations/` in chronological order:
   - `20260919000000_init_schema.sql`
   - `20260921000000_add_clinician_details.sql`
   - `20260921000001_update_clinician_verification.sql`
   - `20260923000000_expand_metric_dictionary.sql`
   - `20260924000000_reports_sharing_and_profiles.sql`
   - `20260924000001_add_appointment_questionnaires.sql`
   - `20260925000000_add_questionnaire_response_detail.sql`
   - `20260925000001_clinician_checklists.sql`
   - `20260926000000_text_questions.sql`
   - `20260926000001_unflag_confident_unmatched_metrics.sql`
   - `20260926000002_comprehensive_metric_dictionary.sql`
   - `20260928000000_metric_source_location.sql`
   - `20261028000000_community_storage.sql` to `20261028000014_maternity_lab_import.sql`
   - `20261029000000_consult_sessions.sql` to `20261029000002_transcription.sql`
   - `20261102000000_consult_audio_gap_recovery.sql` to `20261102000002_consult_drafts.sql`
   - `20261103000000_pregnancy_checkin_ai.sql`
   - `20261103100000_pregnancy_checkin_cadence.sql`
   - `20261104000000_atomic_draft_review.sql`
   - `20261104000000_patient_device_metrics.sql`
   *(Tip: If using Supabase CLI, run `supabase db push`).*

#### 2. Create Storage Buckets
In the Supabase Dashboard under **Storage**, create these buckets (keep them **Private**):
- `reports` — Uploaded physical lab PDF/JPEG reports.
- `audio-chunks` — Consultation audio segments from doctor and patient devices.
- `consult-audio` — Stitched consultation audio archives.

---

### Step 4: Backend API Server (`server/`)

1. Navigate to `server`:
   ```bash
   cd server
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Generate storage envelope encryption keys:
   ```bash
   npm run generate-keys
   ```
   *Copy the output public and private base64 strings into `server/.env` under `STORAGE_ENCRYPTION_RSA_PUBLIC_KEY` and `STORAGE_ENCRYPTION_RSA_PRIVATE_KEY`.*
4. Run automated test suites to verify configuration:
   ```bash
   npm test
   ```
   *(430+ tests should pass).*
5. Launch the backend API:
   ```bash
   npm run dev
   ```
   *The server starts on `http://localhost:4000`.*

---

### Step 5: React Doctor Dashboard (`client/`)

1. In a new terminal, navigate to `client`:
   ```bash
   cd client
   ```
2. Install Node dependencies:
   ```bash
   npm install
   ```
3. Run component test suite:
   ```bash
   npm test
   ```
4. Start the Vite development server:
   ```bash
   npm run dev
   ```
   *Open `http://localhost:5173` in your browser.*

---

### Step 6: Document OCR Microservice (`PaddleOCRFastAPI/`)

You can run PaddleOCR either via **Docker** (recommended) or in a **local Python virtual environment**:

#### Option A: Docker (Fastest, zero host Python issues)
```bash
docker compose -f PaddleOCRFastAPI/docker-compose.yml up -d
```
*Listens on `http://127.0.0.1:8000`.*

#### Option B: Local Python Virtual Environment
**On Linux:**
```bash
cd PaddleOCRFastAPI
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

**On Windows:**
```powershell
cd PaddleOCRFastAPI
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload
```

---

### Step 7: Whisper Speech-to-Text Microservice (`whisper-service/`)

Provides local, privacy-first transcription for the consultation audio pipeline.

**On Linux:**
```bash
cd whisper-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
bash run.sh
```

**On Windows:**
```powershell
cd whisper-service
python -m venv venv
.\venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m uvicorn main:app --host 127.0.0.1 --port 8001
```

Verify service status:
```bash
curl http://localhost:8001/health
```

---

### Step 8: Redis Audio Cache (Optional)

The Redis cache provides fast local caching for audio chunks before they are finalized and stitched.

```bash
docker compose -f server/docker-compose.redis.yml up -d
```
*Listens on `127.0.0.1:6379`.*

---

### Step 9: Mobile Patient App (`mobile/`)

1. Navigate to `mobile`:
   ```bash
   cd mobile
   ```
2. Fetch Flutter packages:
   ```bash
   flutter pub get
   ```
3. Run the automated check-in and cadence widget tests:
   ```bash
   flutter test
   ```

#### Connecting a Real Android Phone via USB:
1. Enable **Developer Options** and turn ON **USB Debugging** on your phone.
2. Connect the phone via USB cable.
3. Verify ADB detects the phone:
   ```bash
   adb devices
   ```
4. **CRITICAL STEP**: Forward port 4000 over USB to the phone:
   ```bash
   adb reverse tcp:4000 tcp:4000
   ```
5. Run the app:
   ```bash
   flutter run --dart-define-from-file=config.json
   ```

#### Running on Android Emulator:
If using the emulator, edit `mobile/config.json` and set:
`"API_BASE_URL": "http://10.0.2.2:4000"` (Android emulator's alias for the host machine's loopback).

---

### Step 10: Community Peer Support Subsystem (Optional)

The community subsystem can run either **in-process** within the main Express API or as isolated standalone processes.

To run standalone:
- **Identity Service** (Port 4101):
  ```bash
  cd server && node --env-file="path/to/identity.env" src/community/identity-service.js
  ```
- **Safety Service** (Port 4102):
  ```bash
  cd server && NODE_ENV=development COMMUNITY_LLM_BYPASS=true node --env-file="path/to/saftey.env" src/community/safety-service.js
  ```
- **Jobs Worker**:
  ```bash
  cd server && node --env-file="path/to/jobs.env" src/community/worker.js
  ```

---

## 4. Running the Full Stack

### Multi-Service Launcher Scripts

Instead of opening 5+ individual terminals, use the included orchestrators:

#### On Linux / macOS:
```bash
./start-all.sh
```
*Subcommands available:*
- `./start-all.sh --core-only` (Runs API 4000, Web Client 5173, and Whisper 8001)
- `./start-all.sh --with-ocr` (Also spins up PaddleOCR)
- `./start-all.sh --with-redis` (Also spins up Redis cache)
- `./start-all.sh --status` (Checks all ports and prints health table)
- `./start-all.sh --stop` (Terminates all running background services)

#### On Windows:
```cmd
start-all.bat
```
*(Or `.\start-all.ps1` in PowerShell)*

---

### Service Port & Health Check Matrix

| Service | Port | Health Check / Local URL | Purpose |
|---|---|---|---|
| **Public Node API** | `4000` | `http://localhost:4000/health` | Core REST API, WebSockets, AI brief synthesis |
| **React Doctor Dashboard** | `5173` | `http://localhost:5173` | Clinician portal & consultation review modal |
| **PaddleOCR Service** | `8000` | `http://localhost:8000/docs` | Lab report extraction & metric digitizer |
| **Faster-Whisper STT** | `8001` | `http://localhost:8001/health` | Privacy-first local consultation transcription |
| **Community Identity** | `4101` | `http://127.0.0.1:4101/health` | Zero-knowledge identity isolation |
| **Community Safety** | `4102` | `http://127.0.0.1:4102/health` | Content safety & PII redaction |
| **Redis Audio Cache** | `6379` | `redis-cli ping` $\rightarrow$ `PONG` | High-speed temporary audio chunk buffer |

---

## 5. Operating System Gotchas & Troubleshooting

### Windows-Specific Troubleshooting

#### 1. PowerShell Script Execution Disabled
**Symptom:** `File .\setup.ps1 cannot be loaded because running scripts is disabled on this system.`  
**Fix:** Run this once in PowerShell:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

#### 2. Line Endings (CRLF vs LF)
**Symptom:** Shell scripts (`run.sh`, `start-all.sh`) fail with `\r: command not found`.  
**Fix:** Configure Git to checkout with proper line endings:
```powershell
git config --global core.autocrlf input
```

#### 3. Phone Loses Connection to Backend
**Symptom:** Flutter app on physical phone shows `Check your internet connection and try again`.  
**Fix:**
1. Check that phone is on the same network or connected via USB.
2. Re-run ADB port reverse (it resets whenever the cable is unplugged):
   ```powershell
   adb reverse tcp:4000 tcp:4000
   ```
3. Verify that `mobile/config.json` has `"API_BASE_URL": "http://127.0.0.1:4000"`.

#### 4. Port Conflicts (e.g. Port 4000 or 5173 already in use)
**Symptom:** `Error: listen EADDRINUSE: address already in use :::4000`  
**Fix:** Identify and stop the zombie process:
```powershell
netstat -ano | findstr :4000
taskkill /F /PID <PID_NUMBER>
```

---

### Linux-Specific Troubleshooting

#### 1. NVM Node Version Not Recognized in Scripts
**Symptom:** `node: --env-file is not allowed in NODE_OPTIONS` or older system node is executed.  
**Fix:** Ensure NVM is loaded in your shell profile (`~/.bashrc`):
```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
nvm use 24
```

#### 2. Missing OpenCV / OpenGL Libraries for PaddleOCR
**Symptom:** `ImportError: libGL.so.1: cannot open shared object file: No such file or directory`  
**Fix:** Install Linux graphics and OpenMP shared libraries:
```bash
sudo apt update && sudo apt install -y libgl1-mesa-glx libgomp1 libglib2.0-0
```

#### 3. Missing `psql` for Community Database Commands
**Symptom:** `psql: command not found`  
**Fix:**
```bash
sudo apt install -y postgresql-client
```

---

### Authentication & Supabase Troubleshooting

#### 1. Clinician Verification in Local Development
By default, new clinician registrations require administrator verification.
In local development, set:
```env
DEMO_SELF_VERIFY=true
NODE_ENV=development
```
This enables a **Verify Account** button on the `verification-pending` page.
Alternatively, verify via CLI:
```bash
cd server
npm run verify-clinician -- your-email@example.com
```

#### 2. Supabase Magic Link Auth Redirect
If magic links for patient invites fail to redirect to localhost:
1. Open Supabase Dashboard $\rightarrow$ **Authentication** $\rightarrow$ **URL Configuration**.
2. Add `http://localhost:5173/*` and `http://localhost:4000/*` to **Redirect URLs**.
3. Set **Site URL** to `http://localhost:5173`.
