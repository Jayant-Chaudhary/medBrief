-- SYNTHETIC FIXTURE ONLY. Safe to run repeatedly after migration
-- 20261030000000_medication_template_feedback.sql has been applied.
-- These fictional entries are unreviewed and must never be used for care.
begin;

insert into medication_substances
  (medication_key, display_name, synonyms, source_name, source_reference, reviewed_at, is_active)
values
  ('demo.medication.alpha', 'DEMO ONLY — Example medicine Alpha', array['demo alpha'], 'DEMO ONLY — synthetic fixture, not clinical data', 'internal://demo/medication-alpha', null, true),
  ('demo.medication.beta', 'DEMO ONLY — Example medicine Beta', array['demo beta'], 'DEMO ONLY — synthetic fixture, not clinical data', 'internal://demo/medication-beta', null, true)
on conflict (medication_key) do update set
  display_name = excluded.display_name,
  synonyms = excluded.synonyms,
  source_name = excluded.source_name,
  source_reference = excluded.source_reference,
  reviewed_at = null,
  is_active = true,
  updated_at = now();

insert into medication_allergen_associations
  (medication_key, allergen_key, allergen_display, association_type, source_name, source_reference, reviewed_at)
values
  ('demo.medication.alpha', 'demo_allergen_alpha', 'DEMO ONLY — Example allergen Alpha', 'ingredient', 'DEMO ONLY — synthetic fixture, not clinical data', 'internal://demo/association-alpha', null),
  ('demo.medication.beta', 'demo_allergen_beta', 'DEMO ONLY — Example allergen Beta', 'ingredient', 'DEMO ONLY — synthetic fixture, not clinical data', 'internal://demo/association-beta', null)
on conflict (medication_key, allergen_key, association_type) do update set
  allergen_display = excluded.allergen_display,
  source_name = excluded.source_name,
  source_reference = excluded.source_reference,
  reviewed_at = null;

commit;
