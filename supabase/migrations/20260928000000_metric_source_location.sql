-- ============================================================
-- Where each lab value was printed on the uploaded report.
--
-- Lets the clinician click a value and see the exact line of the original
-- report it was read from, with the value highlighted: verifying a number
-- becomes a glance instead of a search through the whole PDF or photo.
--
-- source_page: 1-based page of the uploaded file.
-- source_box:  { "row": [x0,y0,x1,y1], "value": [x0,y0,x1,y1] } as fractions
--              of that page (0..1), so it does not depend on whether the
--              value came from PDF text (points) or OCR (image pixels), or on
--              the size the page is drawn at. "value" may be null.
--
-- Both stay null for values stored before this migration and for OCR runs
-- that had no real box geometry; the UI then offers the full report instead.
-- Idempotent.
-- ============================================================

alter table lab_report_metrics
  add column if not exists source_page integer check (source_page is null or source_page >= 1),
  add column if not exists source_box  jsonb;
