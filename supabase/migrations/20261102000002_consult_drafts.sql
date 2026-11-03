-- ============================================================
-- Consultation Audio Pipeline — Phase 8 Schema Migration
-- Consult Drafts with Row Level Security
-- Target: Supabase (PostgreSQL)
-- ============================================================

create table if not exists consult_drafts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references consult_sessions(id) on delete cascade,
  appointment_id uuid not null references appointments(id) on delete cascade,
  status text not null default 'needs_review' check (status in ('needs_review', 'approved', 'rejected')),
  provider text not null check (provider in ('gemini', 'local', 'fake')),
  model_version text not null,
  doctor_notes jsonb not null,
  patient_summary jsonb not null,
  clinical_flags jsonb not null,
  tracers_used jsonb not null default '[]'::jsonb,
  review_reasons text[] not null default '{}',
  latency_ms integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_consult_drafts_session on consult_drafts(session_id, created_at desc);
create index if not exists idx_consult_drafts_appointment on consult_drafts(appointment_id);

alter table consult_drafts enable row level security;

-- Policies matching consult_sessions participant access
create policy "Doctors can view consult drafts" on consult_drafts
  for select using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = consult_drafts.session_id and cs.doctor_id = auth.uid()
    )
  );

create policy "Patients can view consult drafts" on consult_drafts
  for select using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = consult_drafts.session_id and cs.patient_id = auth.uid()
    )
  );

create policy "Doctors can update consult drafts" on consult_drafts
  for update using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = consult_drafts.session_id and cs.doctor_id = auth.uid()
    )
  );
