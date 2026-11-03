-- ============================================================
-- Consultation Audio Pipeline — Phase 6 Schema Migration
-- Target: Supabase (PostgreSQL)
-- ============================================================

-- 1. CONSULT SESSIONS: Add incomplete_sides and draft_outdated
alter table public.consult_sessions
  add column if not exists incomplete_sides text[] not null default '{}',
  add column if not exists draft_outdated boolean not null default false;

create index if not exists idx_consult_sessions_ending_deadline
  on public.consult_sessions(status, end_deadline_at)
  where status = 'ending';

-- 2. CONSULT AUDIO GAPS: Allow 'missing_chunk' reason code
alter table public.consult_audio_gaps drop constraint if exists consult_audio_gaps_reason_code_check;
alter table public.consult_audio_gaps add constraint consult_audio_gaps_reason_code_check check (
  reason_code in (
    'phone_call', 'focus_lost', 'permission_revoked', 'recorder_error',
    'unknown', 'retention_expired', 'storage_lost', 'user_discarded', 'missing_chunk'
  )
);
