-- ============================================================
-- Rollback: Patient Device Metrics Schema
-- ============================================================

drop policy if exists "Clinicians view assigned patient device metrics" on patient_device_metrics;
drop policy if exists "Patients manage own device metrics" on patient_device_metrics;
drop index if exists idx_patient_device_metrics_lookup;
drop table if exists patient_device_metrics cascade;

