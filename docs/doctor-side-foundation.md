# Doctor-side maternal record foundation

This first slice adds clinician-entered pregnancy records to the existing React client and Express/Supabase API. It does not package Electron or run any prediction model.

## Data model

- `pregnancy_episodes` holds the pregnancy-specific intake/history data. Existing `patient_details` due date, gravida, and para values are copied into an episode for the patient's most recent linked clinician when the migration runs.
- `antenatal_visits` stores the repeatable card table: date, weight, blood pressure, gestational age, fundal height, presentation, relation to brim, fetal heart rate, urine albumin/sugar, TSH, hemoglobin, next visit, signature, and advice.
- `pregnancy_investigations` stores each investigation as a dated result row and can refer to a report the clinician already has access to.
- `pregnancy_ultrasounds`, `pregnancy_vaccinations`, and `pregnancy_deliveries` hold their respective repeatable records and delivery/postpartum fields.
- Existing uploaded lab reports and standardized metrics remain the source of report data. The maternal-record screen displays a read-only summary of only reports shared with the clinician; values are not copied into the record automatically.

Apply `supaBase/migrations/20261025000000_maternal_records_and_ml_foundation.sql` before using the new API.

## API

- `GET /api/maternal-records/patients/:patientId`
- `POST /api/maternal-records/patients/:patientId/episodes`
- `PATCH /api/maternal-records/episodes/:episodeId`
- `POST /api/maternal-records/episodes/:episodeId/records/:collection`
- `PATCH /api/maternal-records/records/:collection/:recordId`
- `DELETE /api/maternal-records/records/:collection/:recordId`
- `PUT /api/maternal-records/episodes/:episodeId/delivery`
- `GET /api/ml/status`

All maternal-record routes require an authenticated, verified clinician and check that the patient/episode belongs to that clinician's appointment panel. RLS remains enabled; the Express server performs the row-level checks because it uses the Supabase service-role client.

## ML provider boundary

`server/src/services/ml/` defines independent tasks for maternal risk scoring, pregnancy similarity, and medication-template recommendations. Each task can receive its own service URL (`ML_MATERNAL_RISK_URL`, `ML_PATIENT_SIMILARITY_URL`, `ML_TEMPLATE_RECOMMENDATION_URL`) or use the shared `ML_SERVICE_URL`. If no URL is configured, the disabled provider returns `model_not_configured` and an empty result set; it does not fabricate scores.

The HTTP adapter expects versioned, task-specific responses validated by `contracts.js`. Future feature builders should pass minimized structured data only, without patient names, contact details, or uploaded files. Current code does not call the prediction tasks or update models from clinician feedback. `ml_prediction_runs`, `clinical_alerts`, `clinical_alert_feedback`, and cohort-run tables reserve the persistence boundary for those later features.

## Electron compatibility

The React client remains build-target agnostic. The website defaults to `BrowserRouter`; set `VITE_ROUTER_MODE=hash` for an Electron renderer loaded from the packaged app. Set `VITE_API_BASE_URL` to the API origin for each deployment. Electron packaging, preload/IPC design, and desktop release configuration are out of scope for this slice.
