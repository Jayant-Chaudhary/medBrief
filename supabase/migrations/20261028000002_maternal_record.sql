-- ============================================================
-- Maternal record (maternity card) storage
--
-- One pregnancy = one "episode". Every part of the maternity card
-- (patient & baseline, antenatal visits, investigations, ultrasound,
-- vaccinations, delivery) is saved against that episode.
--
-- Existing patient, appointment, report and prescription data is kept.
-- Safe to run more than once.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Keeps updated_at current on every edit.
-- ------------------------------------------------------------
create or replace function maternal_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- 1. PREGNANCY EPISODE  (card: patient details + baseline)
-- ============================================================
create table if not exists pregnancy_episodes (
  id uuid primary key default gen_random_uuid(),
  patient_id uuid not null references profiles(id) on delete cascade,
  clinician_id uuid not null references profiles(id),
  status text not null default 'ongoing' check (status in ('ongoing', 'completed', 'other')),
  first_anc_date date,
  last_menstrual_period date,
  due_date date,
  date_of_quickening date,
  gravida integer check (gravida is null or gravida >= 0),
  para integer check (para is null or para >= 0),
  living integer check (living is null or living >= 0),
  abortions integer check (abortions is null or abortions >= 0),
  blood_group text check (blood_group is null or blood_group in ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
  history_notes text,                -- "Relevant history / allergies"
  chest_history text,
  cvs_history text,
  alcohol_history text,
  smoking_history text,
  vomiting_history text,
  discharge_history text,
  bleeding_history text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pregnancy_episodes_patient
  on pregnancy_episodes(patient_id, created_at desc);
create index if not exists idx_pregnancy_episodes_clinician
  on pregnancy_episodes(clinician_id, status);

-- Carry over pregnancy details patients already entered in their profile,
-- creating an episode for their most recent clinician.
insert into pregnancy_episodes (patient_id, clinician_id, status, due_date, gravida, para)
select distinct on (pd.profile_id)
  pd.profile_id,
  a.clinician_id,
  'ongoing',
  pd.due_date,
  pd.gravida,
  pd.para
from patient_details pd
join appointments a on a.patient_id = pd.profile_id
where (pd.due_date is not null or pd.gravida is not null or pd.para is not null)
  and a.clinician_id is not null
  and not exists (
    select 1 from pregnancy_episodes pe
    where pe.patient_id = pd.profile_id and pe.clinician_id = a.clinician_id
  )
order by pd.profile_id, a.scheduled_at desc
on conflict do nothing;

-- ============================================================
-- 2. ANTENATAL VISITS  (card: one row per visit)
-- ============================================================
create table if not exists antenatal_visits (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  visit_date date not null,
  weight_kg numeric check (weight_kg is null or weight_kg >= 0),
  bp_systolic numeric check (bp_systolic is null or bp_systolic >= 0),
  bp_diastolic numeric check (bp_diastolic is null or bp_diastolic >= 0),
  gestational_weeks integer check (gestational_weeks is null or gestational_weeks between 0 and 60),
  gestational_days integer check (gestational_days is null or gestational_days between 0 and 6),
  fundal_height_cm numeric check (fundal_height_cm is null or fundal_height_cm >= 0),
  present_position text,
  relation_presentation_to_brim text,
  fetal_heart_rate text,
  urine_albumin text,
  urine_sugar text,
  tsh numeric check (tsh is null or tsh >= 0),
  hemoglobin_g_dl numeric check (hemoglobin_g_dl is null or hemoglobin_g_dl >= 0),
  next_visit_date date,
  signature text,                    -- clinician name / signature
  advice text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (next_visit_date is null or next_visit_date >= visit_date)
);

create index if not exists idx_antenatal_visits_episode_date
  on antenatal_visits(pregnancy_episode_id, visit_date desc);

-- ============================================================
-- 3. INVESTIGATIONS  (card: investigations box + baseline Hb/TSH)
-- One row per test, so any test can be added without a schema change.
-- lab_report_id links a value read from an uploaded report (OCR).
-- ============================================================
create table if not exists pregnancy_investigations (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  investigation_key text,            -- metric_dictionary.standard_key when known
  investigation_name text not null,
  performed_on date,
  result_text text,
  result_value numeric,
  result_unit text,
  is_baseline boolean not null default false,   -- first-attendance investigation
  notes text,                        -- notes / reference range
  lab_report_id uuid references lab_reports(id) on delete set null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pregnancy_investigations_episode
  on pregnancy_investigations(pregnancy_episode_id, performed_on desc);
create index if not exists idx_pregnancy_investigations_report
  on pregnancy_investigations(lab_report_id) where lab_report_id is not null;

-- ============================================================
-- 4. ULTRASOUND  (card: ultrasound examination box)
-- ============================================================
create table if not exists pregnancy_ultrasounds (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  performed_on date,
  gestational_weeks integer check (gestational_weeks is null or gestational_weeks between 0 and 60),
  gestational_days integer check (gestational_days is null or gestational_days between 0 and 6),
  report_text text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pregnancy_ultrasounds_episode
  on pregnancy_ultrasounds(pregnancy_episode_id, performed_on desc);

-- ============================================================
-- 5. VACCINATIONS  (card: vaccinations / injections box)
-- ============================================================
create table if not exists pregnancy_vaccinations (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  vaccine_name text not null,
  dose_label text,
  administered_on date,
  next_dose_date date,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (next_dose_date is null or administered_on is null or next_dose_date >= administered_on)
);

create index if not exists idx_pregnancy_vaccinations_episode
  on pregnancy_vaccinations(pregnancy_episode_id, administered_on desc);

-- ============================================================
-- 6. DELIVERY & POSTNATAL  (card: delivery strip, one per pregnancy)
-- ============================================================
create table if not exists pregnancy_deliveries (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null unique references pregnancy_episodes(id) on delete cascade,
  delivery_type text,
  indication text,
  delivered_at timestamptz,
  baby_sex text,
  baby_weight_kg numeric check (baby_weight_kg is null or baby_weight_kg >= 0),
  apgar_1min integer check (apgar_1min is null or apgar_1min between 0 and 10),
  apgar_5min integer check (apgar_5min is null or apgar_5min between 0 and 10),
  apgar_score text,                  -- kept for older free-text entries
  postnatal_advice text,
  next_visit_date date,
  updated_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ============================================================
-- 7. FUTURE AI FEATURES (empty until a model is configured)
-- ============================================================
create table if not exists ml_prediction_runs (
  id uuid primary key default gen_random_uuid(),
  clinician_id uuid not null references profiles(id),
  pregnancy_episode_id uuid references pregnancy_episodes(id) on delete cascade,
  task text not null check (task in ('maternal_risk', 'patient_similarity', 'medication_template_recommendation')),
  provider text not null,
  model_version text,
  status text not null check (status in ('completed', 'unavailable', 'failed')),
  input_window_start timestamptz,
  input_window_end timestamptz,
  result jsonb,
  error_code text,
  created_at timestamptz not null default now()
);

create index if not exists idx_ml_prediction_runs_episode
  on ml_prediction_runs(pregnancy_episode_id, created_at desc);

create table if not exists clinical_alerts (
  id uuid primary key default gen_random_uuid(),
  prediction_run_id uuid not null references ml_prediction_runs(id) on delete cascade,
  patient_id uuid not null references profiles(id) on delete cascade,
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  clinician_id uuid not null references profiles(id),
  status text not null default 'new' check (status in ('new', 'acknowledged', 'resolved', 'dismissed', 'deferred')),
  risk_level text,
  score numeric check (score is null or (score >= 0 and score <= 1)),
  explanation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (prediction_run_id, pregnancy_episode_id)
);

create index if not exists idx_clinical_alerts_clinician_status
  on clinical_alerts(clinician_id, status, created_at desc);
create index if not exists idx_clinical_alerts_patient_episode
  on clinical_alerts(patient_id, pregnancy_episode_id, created_at desc);

create table if not exists pregnancy_cohort_runs (
  id uuid primary key default gen_random_uuid(),
  prediction_run_id uuid not null references ml_prediction_runs(id) on delete cascade,
  clinician_id uuid not null references profiles(id),
  model_version text,
  status text not null check (status in ('completed', 'unavailable', 'failed')),
  created_at timestamptz not null default now()
);

create table if not exists pregnancy_cohort_members (
  id uuid primary key default gen_random_uuid(),
  cohort_run_id uuid not null references pregnancy_cohort_runs(id) on delete cascade,
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  similarity_score numeric check (similarity_score is null or (similarity_score >= 0 and similarity_score <= 1)),
  match_reasons jsonb not null default '[]'::jsonb,
  unique (cohort_run_id, pregnancy_episode_id)
);

create index if not exists idx_pregnancy_cohort_members_episode
  on pregnancy_cohort_members(pregnancy_episode_id, cohort_run_id);

create table if not exists clinical_alert_feedback (
  id uuid primary key default gen_random_uuid(),
  prediction_run_id uuid not null references ml_prediction_runs(id) on delete cascade,
  clinician_id uuid not null references profiles(id),
  feedback text not null check (feedback in ('confirmed', 'incorrect', 'already_addressed', 'deferred')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_clinical_alert_feedback_run
  on clinical_alert_feedback(prediction_run_id, created_at desc);

-- ============================================================
-- 8. UPGRADE: if an earlier version of this script already ran,
--    add the columns that version did not have. No-ops otherwise.
-- ============================================================
alter table pregnancy_episodes
  add column if not exists living integer check (living is null or living >= 0),
  add column if not exists abortions integer check (abortions is null or abortions >= 0),
  add column if not exists blood_group text,
  add column if not exists history_notes text;

alter table antenatal_visits
  add column if not exists hemoglobin_g_dl numeric check (hemoglobin_g_dl is null or hemoglobin_g_dl >= 0);

-- The first draft called the Hb column "hemoglobin_percent" although the card
-- records g/dL. Copy any values across, then drop the misleading column.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'antenatal_visits' and column_name = 'hemoglobin_percent'
  ) then
    update antenatal_visits
      set hemoglobin_g_dl = hemoglobin_percent
      where hemoglobin_g_dl is null and hemoglobin_percent is not null;
    alter table antenatal_visits drop column hemoglobin_percent;
  end if;
end;
$$;

alter table pregnancy_investigations
  add column if not exists is_baseline boolean not null default false,
  add column if not exists notes text;

alter table pregnancy_ultrasounds
  add column if not exists gestational_weeks integer check (gestational_weeks is null or gestational_weeks between 0 and 60),
  add column if not exists gestational_days integer check (gestational_days is null or gestational_days between 0 and 6);

alter table pregnancy_vaccinations
  add column if not exists next_dose_date date;

alter table pregnancy_deliveries
  add column if not exists apgar_1min integer check (apgar_1min is null or apgar_1min between 0 and 10),
  add column if not exists apgar_5min integer check (apgar_5min is null or apgar_5min between 0 and 10);

-- ============================================================
-- 9. updated_at triggers
-- ============================================================
do $$
declare
  t text;
begin
  foreach t in array array[
    'pregnancy_episodes', 'antenatal_visits', 'pregnancy_investigations',
    'pregnancy_ultrasounds', 'pregnancy_vaccinations', 'pregnancy_deliveries',
    'clinical_alerts'
  ]
  loop
    execute format('drop trigger if exists trg_%1$s_updated_at on %1$I', t);
    execute format(
      'create trigger trg_%1$s_updated_at before update on %1$I
         for each row execute function maternal_set_updated_at()', t);
  end loop;
end;
$$;

-- ============================================================
-- 10. SECURITY
-- RLS on with no policies = the browser cannot read or write these
-- tables directly. Only the server (service-role key) can, and it must
-- check that the clinician treats the patient before every operation.
-- ============================================================
alter table pregnancy_episodes enable row level security;
alter table antenatal_visits enable row level security;
alter table pregnancy_investigations enable row level security;
alter table pregnancy_ultrasounds enable row level security;
alter table pregnancy_vaccinations enable row level security;
alter table pregnancy_deliveries enable row level security;
alter table ml_prediction_runs enable row level security;
alter table clinical_alerts enable row level security;
alter table clinical_alert_feedback enable row level security;
alter table pregnancy_cohort_runs enable row level security;
alter table pregnancy_cohort_members enable row level security;

commit;