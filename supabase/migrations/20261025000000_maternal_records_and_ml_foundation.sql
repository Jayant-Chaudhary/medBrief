-- Maternal record capture foundation.
-- Existing patient, appointment, report and prescription data is retained.

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

-- Preserve profile-level pregnancy details already entered in the portal by
-- creating an episode for the patient's most recent linked clinician.
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
  and not exists (
    select 1 from pregnancy_episodes pe where pe.patient_id = pd.profile_id and pe.clinician_id = a.clinician_id
  )
order by pd.profile_id, a.scheduled_at desc
on conflict do nothing;

-- One row per antenatal appointment/check, with the card's repeatable fields.
create table if not exists antenatal_visits (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  appointment_id uuid references appointments(id) on delete set null,
  visit_date date not null,
  weight_kg numeric check (weight_kg is null or weight_kg >= 0),
  bp_systolic numeric,
  bp_diastolic numeric,
  gestational_weeks integer check (gestational_weeks is null or gestational_weeks between 0 and 60),
  gestational_days integer check (gestational_days is null or gestational_days between 0 and 6),
  fundal_height_cm numeric,
  present_position text,
  relation_presentation_to_brim text,
  fetal_heart_rate text,
  urine_albumin text,
  urine_sugar text,
  tsh numeric,
  hemoglobin_percent numeric,
  next_visit_date date,
  signature text,
  advice text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_antenatal_visits_episode_date
  on antenatal_visits(pregnancy_episode_id, visit_date desc);

-- Each investigation is a row; this supports the fixed test rows on the card
-- while allowing a clinician to add a test without a schema change.
create table if not exists pregnancy_investigations (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  investigation_key text,
  investigation_name text not null,
  performed_on date,
  result_text text,
  result_value numeric,
  result_unit text,
  lab_report_id uuid references lab_reports(id) on delete set null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pregnancy_investigations_episode
  on pregnancy_investigations(pregnancy_episode_id, performed_on desc);

create table if not exists pregnancy_ultrasounds (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  performed_on date,
  report_text text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pregnancy_ultrasounds_episode
  on pregnancy_ultrasounds(pregnancy_episode_id, performed_on desc);

create table if not exists pregnancy_vaccinations (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episodes(id) on delete cascade,
  vaccine_name text not null,
  dose_label text,
  administered_on date,
  notes text,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pregnancy_vaccinations_episode
  on pregnancy_vaccinations(pregnancy_episode_id, administered_on desc);

create table if not exists pregnancy_deliveries (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null unique references pregnancy_episodes(id) on delete cascade,
  delivery_type text,
  indication text,
  delivered_at timestamptz,
  baby_sex text,
  baby_weight_kg numeric check (baby_weight_kg is null or baby_weight_kg >= 0),
  apgar_score text,
  postnatal_advice text,
  next_visit_date date,
  updated_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Model calls are isolated behind task-specific providers. These tables hold
-- future predictions/feedback; no rows are created until a model is configured.
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

-- Application API uses the service-role key; server-side ownership checks are
-- required on every operation. Direct client access remains closed by RLS.
