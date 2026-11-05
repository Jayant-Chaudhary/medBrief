-- ============================================================
-- Maternity card: values imported from uploaded lab reports.
--
-- Confirmed values from reports the patient shared with the clinician are
-- copied onto the card's investigations as new rows (lab_report_id set).
-- Nothing already on the card is ever overwritten.
--
-- Safe to run more than once.
-- ============================================================

-- A clinician removing an imported value hides it rather than deleting it,
-- so the next import does not bring it straight back.
alter table pregnancy_investigations
  add column if not exists dismissed_at timestamptz;

-- One row per test per report per pregnancy, so importing twice is a no-op.
-- Hand-entered rows have no lab_report_id; NULLs never collide, so they are
-- not limited by this.
create unique index if not exists uq_pregnancy_investigations_report_test
  on pregnancy_investigations (pregnancy_episode_id, lab_report_id, investigation_key);
