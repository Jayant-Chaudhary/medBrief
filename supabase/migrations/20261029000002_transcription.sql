-- ============================================================
-- Consultation Audio Pipeline — Phase 3 Schema Migration
-- Target: Supabase (PostgreSQL)
-- ============================================================

-- 1. TRANSCRIPTION JOBS
create table transcription_jobs (
  id               uuid primary key default gen_random_uuid(),
  chunk_id         uuid not null references audio_chunks(id) on delete cascade,
  status           text not null default 'queued' check (
    status in ('queued', 'transcribing', 'completed', 'failed')
  ),
  attempts         integer not null default 0,
  next_attempt_at  timestamptz not null default now(),
  locked_at        timestamptz,
  last_error_code  text, -- Error code only (never clinical content or transcript)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index idx_transcription_jobs_chunk on transcription_jobs(chunk_id);
create index idx_transcription_jobs_queue on transcription_jobs(status, next_attempt_at, locked_at)
  where status in ('queued', 'transcribing');

-- 2. SEGMENTS
create table segments (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references consult_sessions(id) on delete cascade,
  chunk_id    uuid references audio_chunks(id) on delete set null,
  device      text not null check (device in ('doctor', 'patient')),
  speaker     text not null default 'unknown' check (
    speaker in ('doctor', 'patient', 'overlap', 'unknown')
  ),
  start_ms    bigint not null, -- Mapped to session timeline
  end_ms      bigint not null, -- Mapped to session timeline
  text        text not null,   -- Health data: strictly protected by RLS, never logged
  source      text not null default 'chunk' check (source in ('chunk', 'batch')),
  provider    text not null default 'local',
  language    text,
  confidence  numeric(4,3),
  flags       text[] not null default '{}',
  created_at  timestamptz not null default now()
);

create index idx_segments_session on segments(session_id);
create index idx_segments_chunk on segments(chunk_id);
create index idx_segments_session_start on segments(session_id, start_ms);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table transcription_jobs enable row level security;
alter table segments enable row level security;

-- Policies for segments
create policy "Participants can view session segments" on segments
  for select using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = segments.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );

create policy "Backend can insert session segments" on segments
  for insert with check (
    exists (
      select 1 from consult_sessions cs
      where cs.id = segments.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );

-- Policies for transcription_jobs
create policy "Doctors can view session transcription jobs" on transcription_jobs
  for select using (
    exists (
      select 1 from audio_chunks ac
      join consult_sessions cs on cs.id = ac.session_id
      where ac.id = transcription_jobs.chunk_id
        and cs.doctor_id = auth.uid()
    )
  );
