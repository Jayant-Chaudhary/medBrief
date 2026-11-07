# MedBrief Consultation Audio: Live Demonstration & Rehearsal Playbook

**Version:** 1.0.0  
**Target Audience:** Clinicians, Demo Operators, Field Engineers  
**Clinical Rule:** **MedBrief flags and prioritizes. It never diagnoses.**

---

## 1. Safety and Clinical Principles

Before conducting any demonstration, remember:
1. **Physician in the Loop**: AI-drafted consultation notes are preliminary drafts. Nothing is auto-committed without physician review and explicit approval.
2. **Tracer Verification**: Every numeric lab, ultrasound, or vital measurement in the draft is traced directly to verified medical records. Spoken numbers not found in records are flagged as *"stated verbally, unverified"*, and pending tests are marked *"[value pending verification]"*.
3. **Zero Sensitive Data Leaks**: MedBrief logs only opaque IDs, sequence numbers, timings, and error codes. No patient names, audio, or transcript texts appear in server logs, socket messages, or browser console.

---

## 2. Pre-Demo Setup & Pre-Flight Checklist

Run the automated pre-flight checker 15 minutes before the demo:

```bash
# Verify environment keys, ffmpeg binary, and health status
node tools/verify-render-deployment.js --url=https://your-api.onrender.com
```

### Hardware & Network Requirements
- **Doctor Device**: Laptop or desktop running Google Chrome or Microsoft Edge. Microphone access granted.
- **Patient Device**: Android smartphone with MedBrief Mobile APK installed (or second browser window/simulator).
- **Network**: Wi-Fi or cellular network. Ensure WebSockets (WSS) and HTTPS are allowed on the network.
- **Render Instance Warm-Up**: Ping `GET /health` once so the server is fully awake before the audience arrives.

---

## 3. Step-by-Step Live Demonstration Script

### Step 1: Starting the Consultation (Doctor Web Portal)
1. Doctor logs into the MedBrief Clinician Dashboard.
2. Selects an active maternal antenatal visit appointment.
3. Clicks **"Start Consultation Audio"**.
4. The system initializes session state `created`, displays a **6-Digit Room Code** and a large QR Code.

> **Presenter Talking Point:**  
> *"MedBrief creates an ephemeral, end-to-end encrypted consultation room. The room code pairs both the clinician and the mother's device without requiring the patient to log in with complex credentials."*

---

### Step 2: Patient Pairs & Grants Consent (Patient Mobile Device)
1. On the patient's phone, open the MedBrief app and tap **"Join Consultation"**.
2. Enter the 6-digit room code (or scan the doctor's QR code).
3. The patient reviews the plain-language consent screen explaining that consultation audio will be recorded and transcribed to assist their doctor.
4. Patient taps **"I Consent"**.

> **Presenter Talking Point:**  
> *"Consent is captured explicitly at the start of every session. Both devices must record agreement before any audio capture can begin."*

---

### Step 3: Audio Level Calibration & Clock Synchronization
1. Both screens show a 3-second **Microphone Level Check**.
2. Presenters speak briefly (e.g. *"Namaste, hello"*). The visual VU meter bounces green.
3. The server performs an automated clock handshake with both devices, calculating round-trip latency and clock drift.
4. When both devices report ready, the doctor clicks **"Start Recording"**.

---

### Step 4: The Consultation Conversation
Conduct a brief 1-to-2 minute simulated conversation. Example script:

* **Doctor:** *"Good morning, Asha. How have you been feeling since our last visit two weeks ago?"*
* **Patient:** *"Good morning doctor. I have had mild nausea in the mornings, and a slight backache after standing for long periods."*
* **Doctor:** *"Let us review your latest lab reports. Your hemoglobin was measured at 10.8 g/dL, which is stable, and your blood pressure today is 118/76 mmHg. Have you noticed any severe headaches, blurred vision, or swelling in your feet?"*
* **Patient:** *"No severe headaches or swelling, doctor, just regular fatigue."*
* **Doctor:** *"Very good. We will continue your iron and folic acid supplements, and schedule your next ultrasound scan in 4 weeks."*

> **What happens behind the scenes:**  
> - Both devices cut compressed audio chunks every 15–25 seconds at natural pause boundaries.
> - Chunks upload over HTTPS POST to private Supabase Storage.
> - Background workers process chunks immediately, transcribing audio without waiting for the visit to end.

---

### Step 5: Concluding the Visit
1. Doctor clicks **"End Consultation"**.
2. Both devices immediately stop recorders, flush the final partial audio chunk, and upload their final marker.
3. The session state shifts: `ending` $\rightarrow$ `processing`.
4. The orchestrator checks chunk completeness, performs timeline merge and acoustic crosstalk deduplication, builds the verified tracer catalog, and runs parallel clinical drafting via Google Gemini Flash.
5. Within 5–10 seconds, the doctor's dashboard receives the real-time push: **"Clinical Notes Ready for Review"**.

---

### Step 6: Doctor Review & Approval
1. The Doctor's dashboard displays:
   - **SOAP Clinical Draft**: Chief complaint, vitals observed, clinical assessment, and recommendations.
   - **Interactive Citations**: Clickable `[1]`, `[2]` buttons highlighting the exact spoken transcript turns that support each statement.
   - **Verified Tracer Links**: Clickable tags showing the source lab report for *"Hemoglobin 10.8 g/dL"*.
   - **Patient Summary**: Plain-language takeaway points and red-flag warning signs for the mother.
2. Doctor reviews the draft, makes any desired edits, and clicks **"Approve & Commit Notes"**.
3. Notes are securely saved to the patient's longitudinal electronic health record.

---

## 4. Troubleshooting & Contingency Playbook

### Scenario A: Patient phone drops network or loses Wi-Fi
- **Symptom:** Patient screen shows "Reconnecting..." badge.
- **Behind the scenes:** The patient app continues recording locally. It buffers chunks in isolated app storage and automatically retries with exponential backoff.
- **What to say:**  
  *"The MedBrief mobile client is designed for rural clinics with patchy connectivity. It continues recording uninterrupted and queues uploads in encrypted local storage until connectivity resumes."*

---

### Scenario B: Patient device never joins or phone battery dies
- **Symptom:** Only the doctor device is active in the room.
- **Behind the scenes:** When the doctor ends the consultation, the orchestrator detects the patient side never reported. It flags `patient_incomplete: true` in the audit log and proceeds to generate the doctor draft without hanging.
- **What to say:**  
  *"MedBrief gracefully falls back to single-device mode. If a mother does not have a smartphone or her battery dies, the clinician's device captures the consultation seamlessly."*

---

### Scenario C: Browser blocks microphone permission
- **Symptom:** Doctor dashboard shows *"Microphone Access Denied"*.
- **Fix:** Click the lock or settings icon to the left of the URL bar in Chrome/Edge, change Microphone from "Block" to "Allow", and reload the page.

---

### Scenario D: Clinician mentions a lab value that is not in the system
- **Symptom:** Doctor verbally stated a number that has no matching lab report in Supabase.
- **What happens:** MedBrief's deterministic tracer post-check detects the unverified number. The note explicitly appends: `[value pending verification]` or `stated verbally, unverified`.
- **What to say:**  
  *"This demonstrates MedBrief's safety guardrail in action. Because this measurement was not in the verified lab database, the model is strictly forbidden from claiming it as verified, preventing clinical hallucinations."*

---

## 5. Live Demo Quick Reference Cards

| Stage | Expected Duration | Primary Screen |
|---|---|---|
| Room Code & Pairing | 15 seconds | Doctor Web + Patient Phone |
| Consent & Audio Level Check | 10 seconds | Dual VU Meter Animation |
| Consultation Conversation | 60–120 seconds | Split-screen conversation |
| End Requested $\rightarrow$ Draft Ready | $\le$ 10 seconds | Loading spinner $\rightarrow$ Notes Banner |
| Physician Review & Commit | 30 seconds | Clinician SOAP Note Interface |
