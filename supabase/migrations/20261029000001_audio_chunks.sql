-- ============================================================
-- Consultation Audio Pipeline — Phase 2 Schema Migration
-- Target: Supabase (PostgreSQL)
-- ============================================================

-- AUDIO CHUNKS
create table audio_chunks (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references consult_sessions(id) on delete cascade,
  device        text not null check (device in ('doctor', 'patient')),
  seq           integer not null,
  start_ms      bigint not null,
  duration_ms   integer not null,
  avg_dbfs      numeric(5,2),
  codec         text not null default 'audio/wav',
  size_bytes    integer not null default 0,
  silent        boolean not null default false,
  storage_path  text, -- null for silent chunks
  status        text not null default 'received' check (
    status in ('received', 'queued', 'transcribing', 'transcribed', 'failed', 'silent')
  ),
  is_late       boolean not null default false,
  received_at   timestamptz not null default now(),
  constraint uq_audio_chunks_session_device_seq unique (session_id, device, seq)
);

create index idx_audio_chunks_session on audio_chunks(session_id);
create index idx_audio_chunks_session_device on audio_chunks(session_id, device);
create index idx_audio_chunks_status on audio_chunks(status) where status = 'received';

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table audio_chunks enable row level security;

-- Policies for audio_chunks
create policy "Participants can view session audio chunks" on audio_chunks
  for select using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = audio_chunks.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );

create policy "Participants can insert session audio chunks" on audio_chunks
  for insert with check (
    exists (
      select 1 from consult_sessions cs
      where cs.id = audio_chunks.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );
