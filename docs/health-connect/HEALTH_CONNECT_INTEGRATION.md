# Health Connect Wearable & Physical Activity Integration

Comprehensive architecture, clinical research, database schemas, API contracts, and user interactions for Android Health Connect wearable integration in MedBrief.

---

## 1. Executive Summary & Clinical Background

### The Clinical Problem
In standard prenatal care, physical symptom reporting and vital monitoring between visits suffer from severe limitations:
1. **Recall Bias & Subjectivity:** Patients cannot accurately quantify activity changes, fatigue, or sleep fragmentation over multi-week intervals.
2. **Hidden Cardiovascular Strain:** Resting heart rate physiologically rises 10–20 bpm during pregnancy. Sustained resting tachycardia (>100 bpm) can be an early indicator of maternal infection, worsening anemia, or cardiac decompensation, but is rarely caught outside routine clinic visits.
3. **Preeclampsia & Fluid Retention Detection:** Early warning signs like sudden drops in mobility, sleep disturbances, home blood pressure elevations ($\ge 140/90$ mmHg), and rapid occult fluid retention (>1.5 kg/week) are often missed until acute presentation.

### The Solution
An end-to-end, privacy-compliant, non-breaking wearable integration pipeline:
- **Patient Side (Flutter / Android Health Connect):** Aggregates daily steps, resting heart rate, sleep duration, smart blood pressure, and weight directly from Android Health Connect (backed by smartwatches like Galaxy Watch/Pixel Watch, smart rings, and connected BP cuffs). Includes a one-tap connection & sync card on the home tab.
- **Backend (Node.js & Supabase Postgres):** Idempotent daily metric upserts, trajectory & baseline calculations, and seamless ingestion into the Gemini 2.5 Flash / offline deterministic AI Pre-Visit Brief.
- **Clinician Side (React Dashboard):** A dedicated **Physical Activity & Wearables Card** displaying 7-day average steps, percentage trends vs baseline, resting heart rate with tachycardia alerts, sleep hours with deficit warnings, and verified Health Connect telemetry badges.

---

## 2. Non-Negotiable Safety & Privacy Rules

1. **Flags and Prioritises; Never Diagnoses:** The feature surfaces observations, alerts, and priority tiers (`low`, `moderate`, `high`, `urgent`). Neither UI copy nor LLM outputs ever issue a definitive medical diagnosis.
2. **Strict Privacy in Logs:** No patient names, raw audio, or sensitive health numbers are recorded in server logs, analytics, or error outputs. Only IDs, counts, timings, and status codes.
3. **Synthetic Data for Testing:** All automated test suites use synthetic dates and simulated health values.
4. **Row Level Security (RLS):** Strict RLS policies on `patient_device_metrics` ensure patients access only their own metrics and clinicians only view metrics of assigned patients.

---

## 3. Architecture & File Catalog

### A. Database Migrations (`supaBase/`)
- **`supaBase/migrations/20261104000000_patient_device_metrics.sql`:**
  - Table `patient_device_metrics`: Daily aggregated physical and wearable records.
  - Unique constraint on `(patient_id, metric_date, source)` ensuring idempotent upserts.
  - Row Level Security (RLS) enabled with role-scoped policies for patients and assigned clinicians.
- **`supaBase/rollbacks/20261104000000_patient_device_metrics.sql`:** Clean rollback script.

### B. Server Implementation (`server/`)
- **`server/src/config/deviceMetrics.config.js`:** Centralized thresholds (resting tachycardia: 100 bpm, systolic BP: 140 mmHg, diastolic BP: 90 mmHg, mobility drop: 40%, sleep deficit: 5.5h).
- **`server/src/validators/deviceMetrics.validators.js`:** Zod schemas validating batch metric arrays with bounds checking.
- **`server/src/services/deviceMetrics.service.js`:** Upserting daily metrics, querying intervals, and computing longitudinal trajectories with baseline comparisons.
- **`server/src/services/checkinAi.service.js`:** Enhanced to ingest wearable trajectories into Gemini 2.5 Flash and offline deterministic pre-visit summaries.
- **`server/src/controllers/checkin.controller.js`:** Handlers for `syncMetrics`, `getMetrics`, and `getMetricsTrajectory`.
- **`server/src/routes/checkin.routes.js`:** Endpoints mounted under `/api/checkin/device-metrics`.
- **`server/src/tests/deviceMetrics.test.js`:** 8 automated Jest tests verifying validation, role security, trajectory calculations, and AI brief synthesis.

### C. Patient Mobile App (`mobile/`)
- **`mobile/android/app/src/main/AndroidManifest.xml`:**
  - Package visibility query for Health Connect (`com.google.android.apps.healthdata`).
  - Read permissions for steps, heart rate, resting heart rate, sleep, weight, blood pressure, and glucose.
  - Privacy rationale activity alias (`ViewPermissionUsageActivity`).
- **`mobile/pubspec.yaml`:** Dependency `health: ^13.2.0`.
- **`mobile/lib/features/health_connect/health_connect_models.dart`:** `DailyDeviceMetric` and `DeviceMetricsTrajectory` data models.
- **`mobile/lib/features/health_connect/health_connect_service.dart`:** Service wrapping the `health` plugin, aggregating fine-grained data points to daily metrics.
- **`mobile/lib/features/health_connect/health_connect_repository.dart`:** Network repository syncing metrics to the backend.
- **`mobile/lib/features/health_connect/health_connect_card.dart`:** Dashboard card widget showing connection status, today's summary stats, and one-tap sync.
- **`mobile/lib/features/home/home_tab.dart`:** Mounted `HealthConnectCard`.
- **`mobile/test/health_connect_test.dart`:** 6 automated Flutter tests covering models, aggregation, repository sync, and widget rendering.

### D. Clinician Web Portal (`client/`)
- **`client/src/components/clinician/WearableMetricsCard.jsx`:** Collapsible 3-column physical activity widget displaying steps trend, resting heart rate, sleep duration, wearable BP, and alert flags.
- **`client/src/services/clinicianService.js`:** Added `deviceTrajectory` to `fetchPatientDashboard` and exported `getDeviceMetricsTrajectory`.
- **`client/src/pages/clinician/ClinicianDashboard.jsx`:** Mounted `WearableMetricsCard` alongside `PreVisitAiBriefCard`.
- **`client/src/tests/wearableMetrics.test.jsx`:** 4 automated Vitest tests verifying empty state, active metrics, alert badges, and non-diagnostic disclaimers.

---

## 4. API Endpoints

| Method | Endpoint | Role | Description |
| :--- | :--- | :--- | :--- |
| `POST` | `/api/checkin/device-metrics/sync` | Patient | Upload daily aggregated wearable records from Health Connect |
| `GET` | `/api/checkin/device-metrics` | Authenticated | Query daily records in a date range (patients: own; clinicians: assigned patient) |
| `GET` | `/api/checkin/device-metrics/trajectory` | Authenticated | Retrieve longitudinal trajectory, trend percentages, and clinical alert flags |

---

## 5. Automated Test Evidence

- **Server Test Suites:**
  - `deviceMetrics.test.js`: 8/8 passed (validation, role authorization, trajectory calculation, AI pre-visit synthesis).
  - `checkin.test.js`: 14/14 passed (regression check).
- **Mobile Test Suites:**
  - `health_connect_test.dart`: 6/6 passed (model serialization, daily point aggregation, API sync, card widget).
  - `checkin_flow_test.dart`: 7/7 passed (regression check).
- **Client Test Suites:**
  - `wearableMetrics.test.jsx`: 4/4 passed (empty placeholder, active metrics, alert flags, safety disclaimer).
  - `preVisitAiBrief.test.jsx`: 8/8 passed (regression check).

