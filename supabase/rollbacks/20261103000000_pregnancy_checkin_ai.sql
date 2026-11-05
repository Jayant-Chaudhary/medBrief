-- ============================================================
-- Rollback for 20261103000000_pregnancy_checkin_ai.sql
-- ============================================================

drop table if exists visit_ai_summaries cascade;
drop table if exists patient_checkin_answers cascade;
drop table if exists patient_checkin_sessions cascade;

