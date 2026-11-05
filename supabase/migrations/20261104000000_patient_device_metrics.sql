-- ============================================================
-- Patient Device Metrics & Health Connect Integration Schema
-- Target: Supabase (PostgreSQL)
-- Flags and prioritises, never diagnoses.
-- ============================================================

-- 1. PATIENT DEVICE METRICS
-- Stores daily aggregated physical and wearable health metrics
-- synced via Android Health Connect, Apple Health, or verified devices.
create table if not exists patient_device_metrics (
  id                      uuid primary key default gen_random_uuid(),
  patient_id              uuid not null references profiles(id) on delete cascade,
  metric_date             date not null,
  steps                   integer check (steps >= 0),
  distance_meters         numeric check (distance_meters >= 0),
  active_minutes          integer check (active_minutes >= 0),
  resting_heart_rate      numeric check (resting_heart_rate >= 30 and resting_heart_rate <= 250),
  sleep_minutes           integer check (sleep_minutes >= 0 and sleep_minutes <= 1440),
  weight_kg               numeric check (weight_kg >= 20 and weight_kg <= 300),
  blood_pressure_systolic integer check (blood_pressure_systolic >= 50 and blood_pressure_systolic <= 260),
  blood_pressure_diastolic integer check (blood_pressure_diastolic >= 30 and blood_pressure_diastolic <= 180),
  blood_glucose_mg_dl     numeric check (blood_glucose_mg_dl >= 20 and blood_glucose_mg_dl <= 600),
  source                  text not null default 'health_connect' check (
    source in ('health_connect', 'apple_health', 'manual', 'simulator')
  ),
  created_at              timestamptz not null default now(),
  synced_at               timestamptz not null default now(),
  constraint uq_patient_metric_date_source unique (patient_id, metric_date, source)
);

create index if not exists idx_patient_device_metrics_lookup
  on patient_device_metrics(patient_id, metric_date desc);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table patient_device_metrics enable row level security;

-- Patients manage their own device metrics
drop policy if exists "Patients manage own device metrics" on patient_device_metrics;
create policy "Patients manage own device metrics" on patient_device_metrics
  for all using (auth.uid() = patient_id) with check (auth.uid() = patient_id);

-- Clinicians can view device metrics for patients they have appointments with
drop policy if exists "Clinicians view assigned patient device metrics" on patient_device_metrics;
create policy "Clinicians view assigned patient device metrics" on patient_device_metrics
  for select using (
    exists (
      select 1 from appointments a
      where a.patient_id = patient_device_metrics.patient_id
        and a.clinician_id = auth.uid()
    )
  );

