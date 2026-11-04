-- ============================================================
-- Prenatal Periodic Check-In Cadence & Interval AI Summary
-- Target: Supabase (PostgreSQL)
-- Adds quick_pulse & ad_hoc_concern session types, and
-- interval tracking for pre-visit clinical briefs.
-- ============================================================

-- 1. Update session_type check constraint on patient_checkin_sessions
alter table patient_checkin_sessions
  drop constraint if exists patient_checkin_sessions_session_type_check;

alter table patient_checkin_sessions
  add constraint patient_checkin_sessions_session_type_check
  check (session_type in ('routine_weekly', 'quick_pulse', 'ad_hoc_concern', 'pre_visit'));

-- 2. Update category check constraint on patient_checkin_answers
alter table patient_checkin_answers
  drop constraint if exists patient_checkin_answers_category_check;

alter table patient_checkin_answers
  add constraint patient_checkin_answers_category_check
  check (category in ('physical', 'mental', 'medical', 'concern'));

-- 3. Add interval tracking columns to visit_ai_summaries
alter table visit_ai_summaries
  add column if not exists interval_start timestamptz,
  add column if not exists interval_end timestamptz,
  add column if not exists interval_description text;

