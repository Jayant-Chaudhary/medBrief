-- ============================================================
-- Prenatal Periodic Check-In & AI Doctor Summary Schema
-- Target: Supabase (PostgreSQL)
-- Flags and prioritises, never diagnoses.
-- ============================================================

-- 1. PATIENT CHECKIN SESSIONS
-- Tracks completions of periodic weekly check-ins and pre-visit check-ins.
create table if not exists patient_checkin_sessions (
  id                  uuid primary key default gen_random_uuid(),
  patient_id          uuid not null references profiles(id) on delete cascade,
  appointment_id      uuid references appointments(id) on delete set null,
  session_type        text not null check (session_type in ('routine_weekly', 'pre_visit')),
  gestational_week    integer check (gestational_week >= 1 and gestational_week <= 45),
  status              text not null default 'completed' check (
    status in ('in_progress', 'completed', 'flagged_urgent')
  ),
  created_at          timestamptz not null default now(),
  completed_at        timestamptz
);

create index if not exists idx_checkin_sessions_patient on patient_checkin_sessions(patient_id, created_at desc);
create index if not exists idx_checkin_sessions_appointment on patient_checkin_sessions(appointment_id) where appointment_id is not null;

-- 2. PATIENT CHECKIN ANSWERS
-- Stores individual answers across Physical, Mental, and Medical dimensions.
create table if not exists patient_checkin_answers (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null references patient_checkin_sessions(id) on delete cascade,
  category        text not null check (category in ('physical', 'mental', 'medical')),
  question_key    text not null,
  question_text   text not null,
  answer_type     text not null check (answer_type in ('boolean', 'scale', 'text')),
  bool_value      boolean,
  scale_value     integer,
  text_value      text,
  is_red_flag     boolean not null default false,
  created_at      timestamptz not null default now()
);

create index if not exists idx_checkin_answers_session on patient_checkin_answers(session_id);
create index if not exists idx_checkin_answers_red_flag on patient_checkin_answers(session_id) where is_red_flag is true;

-- 3. VISIT AI SUMMARIES
-- Pre-visit clinical brief synthesized for clinicians.
create table if not exists visit_ai_summaries (
  id                          uuid primary key default gen_random_uuid(),
  appointment_id              uuid not null unique references appointments(id) on delete cascade,
  patient_id                  uuid not null references profiles(id) on delete cascade,
  clinician_id                uuid not null references profiles(id) on delete cascade,
  clinical_risk_level         text not null default 'low' check (
    clinical_risk_level in ('low', 'moderate', 'high', 'urgent')
  ),
  red_flags                   jsonb not null default '[]'::jsonb,
  mental_health_assessment    text,
  physical_symptom_trajectory text,
  medication_compliance       text,
  patient_top_questions       jsonb not null default '[]'::jsonb,
  doctor_talking_points       text,
  raw_llm_output              jsonb,
  model_version               text not null default 'gemini-2.5-flash',
  generated_at                timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

create index if not exists idx_visit_ai_summaries_appointment on visit_ai_summaries(appointment_id);
create index if not exists idx_visit_ai_summaries_clinician on visit_ai_summaries(clinician_id);
create index if not exists idx_visit_ai_summaries_patient on visit_ai_summaries(patient_id);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table patient_checkin_sessions enable row level security;
alter table patient_checkin_answers enable row level security;
alter table visit_ai_summaries enable row level security;

-- Policies for patient_checkin_sessions
drop policy if exists "Patients manage own checkin sessions" on patient_checkin_sessions;
create policy "Patients manage own checkin sessions" on patient_checkin_sessions
  for all using (auth.uid() = patient_id) with check (auth.uid() = patient_id);

drop policy if exists "Clinicians view assigned checkin sessions" on patient_checkin_sessions;
create policy "Clinicians view assigned checkin sessions" on patient_checkin_sessions
  for select using (
    exists (
      select 1 from appointments a
      where a.id = patient_checkin_sessions.appointment_id
        and a.clinician_id = auth.uid()
    )
    or exists (
      select 1 from appointments a
      where a.patient_id = patient_checkin_sessions.patient_id
        and a.clinician_id = auth.uid()
    )
  );

-- Policies for patient_checkin_answers
drop policy if exists "Patients manage own checkin answers" on patient_checkin_answers;
create policy "Patients manage own checkin answers" on patient_checkin_answers
  for all using (
    exists (
      select 1 from patient_checkin_sessions s
      where s.id = patient_checkin_answers.session_id
        and s.patient_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from patient_checkin_sessions s
      where s.id = patient_checkin_answers.session_id
        and s.patient_id = auth.uid()
    )
  );

drop policy if exists "Clinicians view checkin answers" on patient_checkin_answers;
create policy "Clinicians view checkin answers" on patient_checkin_answers
  for select using (
    exists (
      select 1 from patient_checkin_sessions s
      join appointments a on a.patient_id = s.patient_id
      where s.id = patient_checkin_answers.session_id
        and a.clinician_id = auth.uid()
    )
  );

-- Policies for visit_ai_summaries
drop policy if exists "Patients view own visit AI summaries" on visit_ai_summaries;
create policy "Patients view own visit AI summaries" on visit_ai_summaries
  for select using (auth.uid() = patient_id);

drop policy if exists "Clinicians view assigned visit AI summaries" on visit_ai_summaries;
create policy "Clinicians view assigned visit AI summaries" on visit_ai_summaries
  for select using (auth.uid() = clinician_id);

drop policy if exists "Clinicians insert visit AI summaries" on visit_ai_summaries;
create policy "Clinicians insert visit AI summaries" on visit_ai_summaries
  for insert with check (auth.uid() = clinician_id);

drop policy if exists "Clinicians update assigned visit AI summaries" on visit_ai_summaries;
create policy "Clinicians update assigned visit AI summaries" on visit_ai_summaries
  for update using (auth.uid() = clinician_id);
