# Health-On (MedBrief) — System Architecture & Technical Specification

This document provides a comprehensive architectural breakdown of the **Health-On (MedBrief)** platform, detailing system topology, component interactions, database schemas, security layers, and asynchronous event pipelines.

---

## 1. High-Level System Architecture

Health-On employs a hybrid microservices-and-modular-monolith architecture designed for high availability, low-latency offline resilience, and strict clinical privacy.

```mermaid
flowchart TD
    subgraph Clients["User Applications"]
        DoctorWeb["React Doctor Dashboard\n(Vite 5, React 18, Tailwind CSS)\nPort 5173"]
        PatientMobile["Flutter Companion App\n(Android 12+, Riverpod / MVC)\nPort 4000 via ADB / Wi-Fi"]
    end

    subgraph CoreBackend["Core Backend API & Orchestration"]
        APIGateway["Express.js API Gateway & WebSocket Server\n(Node.js 20+ / 24)\nPort 4000"]
        SynthesisEngine["AI Pre-Visit Brief Synthesizer\n(Gemini Flash-Lite / Rule-Based Fallback)"]
        AudioOrchestrator["Consultation Audio Orchestrator\n(Dual-Device Ingestion & Gap Recovery)"]
        AssistantEngine["Clinical In-App Assistant\n(Screen Reader & Action Executor)"]
    end

    subgraph Microservices["Dedicated Microservices"]
        PaddleOCR["Document OCR Service\n(FastAPI + PaddleOCR v4)\nPort 8000"]
        WhisperSTT["Speech-to-Text Microservice\n(FastAPI + Faster-Whisper / CUDA)\nPort 8001"]
        RedisBuffer["Redis Audio Buffer Cache\n(Docker, Port 6379)"]
        CommunityIdentity["Community Identity Service\n(Isolated Process / Port 4101)"]
        CommunitySafety["Community Safety & Moderation\n(Gemini / Ollama / Port 4102)"]
    end

    subgraph StorageLayer["Data & Persistence Layer"]
        PostgresDB[("Supabase PostgreSQL\n(Strict RLS on all 30+ tables)")]
        PrivateStorage[("Supabase Private Storage\n(Encrypted Blobs: Reports & Audio)")]
    end

    DoctorWeb <-->|HTTPS REST & WebSockets| APIGateway
    PatientMobile <-->|HTTPS REST & Audio Chunks| APIGateway

    APIGateway --> SynthesisEngine
    APIGateway --> AudioOrchestrator
    APIGateway --> AssistantEngine

    APIGateway <-->|POST /predict| PaddleOCR
    AudioOrchestrator <-->|POST /transcribe| WhisperSTT
    AudioOrchestrator <-->|Temporary Chunks| RedisBuffer
    APIGateway <-->|Loopback Auth| CommunityIdentity
    APIGateway <-->|PII Redaction| CommunitySafety

    APIGateway <-->|SQL Queries via RLS| PostgresDB
    AudioOrchestrator <-->|Archive Chunks & Notes| PrivateStorage
    PaddleOCR <-->|Fetch Source PDFs| PrivateStorage
```

---

## 2. Core Service Topology

### 2.1 Backend API Server (`server/`)
- **Runtime**: Node.js v24 (leveraging native `--env-file` parameter and modern ES features).
- **HTTP Framework**: Express.js with Zod schema validation across all route boundaries.
- **Real-Time Communication**: Socket.IO server used strictly for server-to-client push events (e.g. consultation state changes, audio upload acknowledgments).
- **Resilience**: Zero socket dependency for business state mutations; all mutations occur via idempotent HTTPS REST transactions.

### 2.2 React Web Dashboard (`client/`)
- **Stack**: React 18, Vite 5, Tailwind CSS, Lucide React, and React Router DOM.
- **Target Audience**: OB/GYN clinicians, nurses, and maternal health clinic staff.
- **Capabilities**: Real-time consultation audio review modal, 30-second AI clinical brief cards, interactive vitals flowsheets, lab report triage queues, and appointment magic-link invites.

### 2.3 Mobile Companion App (`mobile/`)
- **Stack**: Flutter 3.22+ (Android-first).
- **Target Audience**: Expectant mothers across all trimesters.
- **Capabilities**: Guided 4-step weekly milestone wizards, 30-second quick pulse check-ins, ambient consultation audio recording with pause detection, digitized lab report uploads, and anonymous peer support.

### 2.4 Document OCR Microservice (`PaddleOCRFastAPI/`)
- **Stack**: Python 3.12, FastAPI, PaddleOCR v4, `pdfplumber`, `PyMuPDF`.
- **Function**: Ingests uploaded physical lab photos and PDFs, strips visual noise, parses tabular data, and extracts quantitative biochemical metrics.

### 2.5 Local Speech-to-Text Microservice (`whisper-service/`)
- **Stack**: Python 3.12, FastAPI, `faster-whisper`, CUDA hardware acceleration.
- **Function**: Transcribes streamed consultation audio chunks locally on port `8001` with zero data leaving the clinic boundary.

---

## 3. Data Flow Pipelines

### 3.1 AI-Powered Prenatal Check-In & Pre-Visit Brief Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Mother as Expectant Mother (Mobile)
    participant API as Node.js API (Port 4000)
    participant DB as PostgreSQL (Supabase)
    participant AI as Synthesis Engine (Gemini / Fallback)
    actor Doctor as Clinician (Web Dashboard)

    Mother->>API: Submits Weekly Review / Quick Pulse / Concern
    API->>DB: Stores Check-In Answers (RLS: patient-only)
    Note over API,DB: Immediate Emergency Intercept checks for severe symptoms

    Doctor->>API: Views Patient Dashboard for Upcoming Visit
    API->>DB: Queries all Check-Ins within Appointment Interval
    API->>AI: Synthesizes Interval Trajectory, Flags & Talking Points
    alt Gemini API Available
        AI-->>API: Returns Structured JSON Brief (Priority: Red/Amber/Green)
    else Offline / Rate-Limited
        AI-->>API: Deterministic Rule Engine synthesizes Brief offline
    end
    API->>DB: Caches AI Summary in visit_ai_summaries
    API-->>Doctor: Renders 30-Second Pre-Visit Brief Card
```

---

### 3.2 Ambient Dual-Device Consultation Audio Pipeline

```mermaid
sequenceDiagram
    autonumber
    actor Doctor as Doctor Device (Web)
    actor Mother as Patient Device (Mobile)
    participant API as Audio Orchestrator (Port 4000)
    participant Redis as Redis Cache (Port 6379)
    participant STT as Whisper / Sarvam STT
    participant DB as Supabase DB & Storage

    Doctor->>API: Initiates Consult Room (POST /api/consults)
    Mother->>API: Joins Room via 6-Digit Code
    Doctor->>API: Starts Recording State ('recording')
    
    par Doctor Audio Streaming
        Doctor->>API: HTTPS POST /chunks (15-25s chunks, WebM/Opus)
    and Patient Audio Streaming
        Mother->>API: HTTPS POST /chunks (15-25s chunks, AAC/WAV)
    end

    API->>Redis: Temporarily buffers chunks with sequence IDs
    API->>DB: Archives raw chunk to encrypted Supabase private bucket
    
    Doctor->>API: Concludes Consultation (POST /session/end)
    API->>API: Resolves dropped chunk gaps & aligns timelines
    API->>STT: Transcribes audio chunks (local Whisper or Sarvam)
    STT-->>API: Returns aligned transcript segments
    API->>API: Gemini drafts SOAP Clinical Notes (Subjective, Objective, Assessment, Plan)
    API-->>Doctor: Presents Editable Draft in Doctor Review Modal
    Doctor->>API: Approves & signs notes (State: 'draft_approved')
```

---

## 4. Database Schema & Security Models

### 4.1 Key Table Entities

```text
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│            profiles             │       │          appointments           │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ id (UUID, PK)                   │◄──────┤ patient_id (UUID, FK)           │
│ role (clinician | patient)      │       │ clinician_id (UUID, FK)         │
│ email, full_name, phone         │       │ scheduled_at, status            │
│ is_verified (clinicians)        │       │ room_code, invite_token         │
└─────────────────────────────────┘       └────────────────┬────────────────┘
                 │                                         │
                 │ 1:N                                     │ 1:N
                 ▼                                         ▼
┌─────────────────────────────────┐       ┌─────────────────────────────────┐
│    patient_checkin_sessions     │       │        consult_sessions         │
├─────────────────────────────────┤       ├─────────────────────────────────┤
│ id (UUID, PK)                   │       │ id (UUID, PK)                   │
│ patient_id (UUID, FK)           │       │ appointment_id (UUID, FK)       │
│ cadence_tier (weekly/pulse/etc) │       │ state (recording/draft_ready)   │
│ comfort_rating (1 to 5)         │       │ doctor_device_id                │
│ answers (JSONB)                 │       │ patient_device_id               │
└─────────────────────────────────┘       └────────────────┬────────────────┘
                                                           │
                                                           │ 1:N
                                                           ▼
                                          ┌─────────────────────────────────┐
                                          │          audio_chunks           │
                                          ├─────────────────────────────────┤
                                          │ id (UUID, PK)                   │
                                          │ session_id (UUID, FK)           │
                                          │ device_type (doctor | patient)  │
                                          │ sequence_number (INT)           │
                                          │ storage_path, duration_ms       │
                                          │ checksum_sha256                 │
                                          └─────────────────────────────────┘
```

---

## 5. Security, Cryptography & Clinical Safeguards

### 5.1 Row-Level Security (RLS)
Every PostgreSQL table enforces strict RLS policies:
- Patients can only query and mutate their own records (`auth.uid() = patient_id`).
- Clinicians can only access records of patients explicitly linked to their appointments or care team.
- Anonymous identity mappings in community peer support are completely inaccessible to clinical roles.

### 5.2 Storage Envelope Encryption
All audio files and digitized medical reports stored in Supabase private storage are protected with **Envelope Encryption**:
- **Data Encryption Key (DEK)**: Randomly generated AES-256-GCM symmetric key per file.
- **Key Encryption Key (KEK)**: Server-side RSA-4096 keypair (`STORAGE_ENCRYPTION_RSA_PUBLIC_KEY` and `STORAGE_ENCRYPTION_RSA_PRIVATE_KEY`).
- Encrypted payloads are stored alongside their initialization vector (IV) and authentication tag.

### 5.3 Zero-Knowledge Community Isolation
The peer support community decouples medical records from community conversations:
1. **Layer 1**: Supabase Auth ID (`auth.users.id`).
2. **Layer 2**: Randomly generated server-side community pseudonym.
3. **Layer 3**: User-chosen public handle.
Identity reveal is only possible through formal multi-party audit procedures.
