-- ============================================================
-- Consultation Audio Pipeline — Phase 5 Schema Migration
-- Target: Supabase (PostgreSQL)
-- ============================================================

-- CONSULT AUDIO GAPS
create table consult_audio_gaps (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references consult_sessions(id) on delete cascade,
  device        text not null check (device in ('doctor', 'patient')),
  gap_id        uuid not null,
  start_ms      bigint not null check (start_ms >= 0),
  duration_ms   integer not null check (duration_ms > 0),
  reason_code   text not null check (
    reason_code in ('phone_call', 'focus_lost', 'permission_revoked', 'recorder_error', 'unknown')
  ),
  received_at   timestamptz not null default now(),
  constraint uq_consult_audio_gaps_session_device_gap unique (session_id, device, gap_id)
);

create index idx_consult_audio_gaps_session on consult_audio_gaps(session_id);
create index idx_consult_audio_gaps_session_device on consult_audio_gaps(session_id, device);

-- ============================================================
-- ROW LEVEL SECURITY (RLS)
-- ============================================================

alter table consult_audio_gaps enable row level security;

-- Policies for consult_audio_gaps
create policy "Participants can view session gaps" on consult_audio_gaps
  for select using (
    exists (
      select 1 from consult_sessions cs
      where cs.id = consult_audio_gaps.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );

create policy "Participants can insert session gaps" on consult_audio_gaps
  for insert with check (
    exists (
      select 1 from consult_sessions cs
      where cs.id = consult_audio_gaps.session_id
        and (cs.doctor_id = auth.uid() or cs.patient_id = auth.uid())
    )
  );
