# Health-On (MedBrief) — Core Features Deep Dive

This document details the eight core modules of the **Health-On (MedBrief)** platform, explaining the clinical rationale, technical mechanics, workflows, and safety safeguards for each capability.

---

## 1. AI-Powered Prenatal Surveillance & 3-Tier Check-In Cadence

Expectant mothers frequently experience evolving symptoms between routine prenatal visits (which may be 4 to 6 weeks apart in early pregnancy). Without continuous touchpoints, mild complications (such as emerging preeclampsia, hyperemesis gravidarum, or perinatal depression) can advance undetected.

Health-On deploys a **3-Tier Check-In Cadence** designed to prevent survey fatigue while maximizing timely clinical surveillance:

### Tier 1 — Routine Weekly Milestone Review (Every 7 Days)
- **Time Commitment**: Under 2 minutes.
- **Dynamic Gestational Adaptation**:
  - **Trimester 1 (Weeks 1–12)**: Focused on hyperemesis, nausea, cramping, and spotting.
  - **Trimester 2 (Weeks 13–27)**: Quickening surveillance, fetal movement counting, round ligament pain.
  - **Trimester 3 & Term (Weeks 28+)**: Braxton Hicks contractions vs active labor, edema, visual disturbances, and fetal kick counts.
- **Mental Health Screening**: Embedded screening items based on the Edinburgh Postnatal Depression Scale (EPDS) and GAD-2 anxiety measures.
- **Adherence & Daily Routine**: Prenatal vitamin tracking (folic acid, iron, calcium) and sleep quality.

### Tier 2 — 30-Second Quick Pulse (Every 2–4 Days)
- Lightweight check-in between weekly reviews.
- 1-to-5 visual emoji comfort scale (`Very uncomfortable` $\rightarrow$ `Feeling great`).
- One-tap quick symptom chips (`None`, `Nausea`, `Pelvic pressure`, `Swelling`, `Headache`, `Fatigue`, `Heartburn`).

### Tier 3 — 24/7 Ad-Hoc Concern Logger
- Always accessible for unscheduled issues, sudden pain, or questions for the doctor.

### Emergency Intercept Shield
If an expectant mother reports red-flag symptoms (severe persistent headache, visual scotoma, epigastric pain, or bright red vaginal bleeding), the questionnaire flow immediately halts and displays urgent emergency instructions and clinic hotlines.

---

## 2. Pre-Visit 30-Second AI Clinical Brief

Clinicians are constrained by short consultation windows (typically 10–15 minutes). Reading raw symptom survey logs or multiple pages of patient history is impractical during clinic hours.

The **AI Clinical Brief** synthesizes an entire interval's worth of check-in answers into a high-density, structured summary displayed on the doctor's dashboard:

```text
┌────────────────────────────────────────────────────────────────────────┐
│  PATIENT CLINICAL BRIEF — INTERVAL: Oct 14 – Nov 04 (3 Check-ins)     │
│  Triage Priority: ⚠️ AMBER (Attention Recommended)                     │
├────────────────────────────────────────────────────────────────────────┤
│  • Trajectory: Mild pedal edema reported across last 2 pulses.         │
│  • Blood Pressure: Home readings trending up (132/86 mmHg).            │
│  • Patient Agenda: Mother wants to ask about third-trimester vaccines. │
│  • Suggested Focus: Check deep tendon reflexes and urine dipstick.     │
└────────────────────────────────────────────────────────────────────────┘
```

- **Interval Scoping**: Only synthesizes events occurring between the previous consultation and the current visit.
- **Priority Badging**: Classifies overall interval trajectory as **Red** (urgent), **Amber** (review), or **Green** (reassuring).
- **Deterministic Offline Rule Engine**: If the Gemini API key is missing or network connectivity is lost, an offline rule-based clinical engine deterministically evaluates the responses with 100% operational uptime.

---

## 3. Ambient Dual-Device Consultation Audio Pipeline

Capturing accurate, detailed clinical notes during an obstetrical consultation often forces doctors to type into an EHR during the appointment, disrupting face-to-face rapport.

Health-On introduces a **dual-device ambient consultation recording pipeline**:

- **Dual-Device Simultaneous Recording**: Both the clinician's web browser and the patient's smartphone record the visit simultaneously. This spatial diversity eliminates directional blind spots and acoustic muffling.
- **Streaming Chunks**: Audio is captured in 15–25 second chunks using client-side pause detection (`SILENCE_DBFS = -45 dB`) and uploaded idempotently over HTTPS.
- **STT Provider Agnostic**: The backend seamlessly switches between local **Faster-Whisper** (`port 8001` on CUDA GPU) and **Sarvam AI** cloud speech models.
- **Automated SOAP Notes Drafting**: Audio transcript segments are merged, attributed by speaker, and synthesized by Google Gemini into a structured SOAP note (Subjective, Objective, Assessment, Plan).
- **Clinician Review Modal**: The doctor reviews, edits, and electronically signs the notes before they become part of the medical record.

---

## 4. Automated Lab Report Digitization (OCR)

Expectant mothers frequently undergo tests at external commercial laboratories and bring paper printouts or photos of lab reports to appointments.

Health-On uses **PaddleOCR** paired with **pdfplumber** to digitize these reports:
- **Biochemical Metric Normalization**: Maps hospital-specific terminology into unified clinical concepts (e.g. `"HGB"`, `"Hb"`, `"Hgb"` $\rightarrow$ `"hemoglobin"`).
- **Reference Range Validation**: Flags values falling outside gestational-age-specific reference intervals.
- **Safety Triage Queue**: Unmatched metrics or reports with OCR confidence below 85% are placed in a triage queue for clinician review before being committed to the patient's permanent flowsheet.

---

## 5. Longitudinal Vitals & Clinical Alerting

Maternal vital signs require longitudinal tracking rather than single-point evaluation:
- **Tracked Parameters**: Systolic & Diastolic Blood Pressure, Maternal Pulse, Fundal Height, Fetal Heart Rate (FHR), and Maternal Weight.
- **Preeclampsia Surveillance**: Automated alerts when blood pressure crosses $\ge$ 140/90 mmHg, calculating Mean Arterial Pressure (MAP) trends across visits.
- **Android Health Connect Integration**: Synchronizes readings from Bluetooth-enabled blood pressure cuffs and home scales.

---

## 6. Clinical In-App Assistant

An agentic AI assistant integrated into the clinician's portal:
- **Screen Reader**: Reads active patient records, appointment flowsheets, and lab metrics.
- **Action Execution**: Autofills follow-up appointments, prepares lab orders, and drafts checklist items.
- **Safety Boundary**: The assistant can fill forms and stage actions, but the clinician must review and press the final submit button.

---

## 7. Post-Visit Action Checklists & Medication Decision Support

- **Interactive Checklists**: Clinician consultation notes and follow-up plans automatically convert into an interactive to-do list on the patient's phone (e.g., take iron supplement with orange juice, schedule 28-week anatomy scan).
- **Medication Safety Checks**: Prescribed medications are checked against gestational age contraindications, FDA pregnancy categories, and patient-specific drug allergies.

---

## 8. Anonymous Peer-Support Community Subsystem

Pregnancy can be isolating, and mothers frequently seek peer advice. Health-On provides an integrated community forum with strict privacy boundaries:
- **Zero-Knowledge 3-Tier Identity Isolation**:
  - Layer 1: Supabase Auth ID (`auth.users.id`).
  - Layer 2: Server-side random community pseudonym.
  - Layer 3: Mother's chosen public username.
  - Clinicians and moderators cannot link a community post to a patient's real medical profile.
- **Automated AI Moderation**: Every post is screened by Google Gemini or local Ollama to redact phone numbers, addresses, and full names before publication.
- **Distress Escalation**: Posts exhibiting severe distress trigger supportive resources without deanonymizing the user.
