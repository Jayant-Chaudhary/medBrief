-- ============================================================
-- Rollback for Prenatal Periodic Check-In Cadence & Interval AI Summary
-- ============================================================

alter table visit_ai_summaries
  drop column if exists interval_start,
  drop column if exists interval_end,
  drop column if exists interval_description;

alter table patient_checkin_answers
  drop constraint if exists patient_checkin_answers_category_check;

alter table patient_checkin_answers
  add constraint patient_checkin_answers_category_check
  check (category in ('physical', 'mental', 'medical'));

alter table patient_checkin_sessions
  drop constraint if exists patient_checkin_sessions_session_type_check;

alter table patient_checkin_sessions
  add constraint patient_checkin_sessions_session_type_check
  check (session_type in ('routine_weekly', 'pre_visit'));

