# Medication–allergen reference data

The decision-support schema stores a normalized medicine catalog in
`medication_substances` and reviewed medicine-to-allergen relationships in
`medication_allergen_associations`. Patient allergy entries use the same
`allergen_key` as `patient_allergies.substance_key`, so the UI can compare exact
keys and show the association's source and type.

Only rows with `reviewed_at` set are used for medicine search and allergy
flags. The migration intentionally adds no clinical reference rows. Before
importing data, choose a reliable source and confirm its license, coverage,
canonical ingredient keys, allergen key mapping, update process, and review
owner. Unreviewed or unmapped medicines display as not checked.

The clinician UI creates patient allergy rows and derives a normalized key
from the entered allergen name. Imported associations must use that same
normalization (lowercase words joined with underscores), or the keys must be
reconciled before release. This is an exact reference-data match; it does not
infer cross-reactivity or replace clinician review.

Apply `supaBase/migrations/20261030000000_medication_template_feedback.sql`
before using the API. The migration also creates API-backed prescription
templates, drafts, and factor state. Existing browser data is read once and
copied to the server when the corresponding server records are empty; the
browser copy is retained as a recovery backup.
# Development fixtures

`supaBase/seeds/medication_allergy_demo.sql` adds two fictional medication entries and exact-match fixtures. The rows have no clinical source and stay unreviewed. They are excluded from the catalog and allergy match APIs by default.

To use them in a local or staging environment:

1. Apply `20261030000000_medication_template_feedback.sql` first.
2. Run `supaBase/seeds/medication_allergy_demo.sql` in that non-production database.
3. Set `ALLOW_DEMO_MEDICATION_DATA=true` for the backend process, with `NODE_ENV` other than `production`.
4. In the patient allergy editor, use `DEMO ONLY — Example allergen Alpha` or `DEMO ONLY — Example allergen Beta`; then choose the corresponding DEMO ONLY medicine from the template ingredient catalog.

Do not run the fixture against a production database. No synthetic patient allergy or feedback records are included.
