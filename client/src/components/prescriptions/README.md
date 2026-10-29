# Prescription suggestions inside a visit

Open an active patient visit, open Consultation, and find Prescription.

## UI

- The default view contains a small patient-context row, up to three ranked template options, and a direct medicine editor with dose, frequency and duration fields.
- Review opens a template with item selection, criteria breakdown, unknowns and conflicts. Adding keeps existing draft content and skips duplicate item names.
- Add medicine inserts an editable row directly in the Prescription section; no draft dialog is required. Strength, route, item type and instructions are folded into secondary details. Items can be medicines, injections or vaccinations.
- Templates opens search and management inside the visit. Templates can be created, edited, duplicated, archived and restored.
- Save for reuse copies draft items and existing confirmed context into a proposed template. Matching rules are set once in an expandable section. No age range is invented. The clinician must remove patient-specific free text before saving.
- Prescription files are collapsed under an optional attachment section.

## Automatic context and input reduction

There is no per-visit factor-entry form. buildPatientContext reuses the patient age already supplied to the dashboard. It also supports explicit patient.confirmedConditions, patient.confirmedAbsentFactors, patient.pregnancyStage and appointment.purpose when supplied as structured fields. Each available fact shows its source.

The current dashboard view model supplies age but does not supply those other matching fields. They stay unknown. There are no new backend requests, automatic diagnoses from labs, or guesses from consultation prose. The next integration should map the agreed A/B/C/D parameters to existing profile, questionnaire and verified clinical fields, including dates and provenance. Data should be collected once and updated when needed. No new Supabase integration is included in this UI prototype.

## Match definition

Percentage = matched criteria / all configured criteria, rounded to an integer. All criteria have equal weight. Age range is one criterion; purpose and pregnancy stage are one each; each distinct factor is one. Unknown criteria earn no points, and counts are shown alongside the percentage. Conflicting required criteria and known exclusions block applying. Optional differences lower the score but do not block applying. An exclusion is cleared only when explicitly recorded as absent. General templates without criteria have no percentage.

Candidates require at least one positive match and no known conflicts. Incomplete candidates may appear with unknowns visibly marked. This is a descriptive criteria score, not a probability of treatment suitability, an allergy check, a dose check or a validated clinical recommendation. No ML is involved.

## Persistence and scope

Local library keys include clinician ID. Draft keys include clinician, patient and appointment IDs. Existing data is preserved if malformed; changes from another tab pause writes. No prescription is finalized or transmitted to a patient by this feature. End-visit summaries continue to use the existing upload workflow. Clear separation is shown in the UI.

## Verification

- npm run build
- node --test src/components/prescriptions/templateModel.test.js
- In-memory server rendering with synthetic fixtures checked three ranked options, score display and absence of the previous inline factor-entry form.

Full interactive browser verification remains pending.


## Editable Factors area (30 October 2026)

See [FACTOR_CATALOGUE.md](./FACTOR_CATALOGUE.md) for the full source-linked list of 45 starter fields and exact repository mappings. Factors sits inside the Prescription section. Edit / add factors opens grouped patient values and clinician-owned field definitions. Add a text, number or choice field to make it immediately available for entry in this and future visits. Types and units are immutable after definition; names and visibility can be edited.

The view adapter now reads already-shared report rows from the dashboard. This supersedes the earlier age-only description above: supported measurements are populated with source dates and units when present. Unknowns and OCR-review values stay out of matching. This adds no backend requests and does not modify the data pipeline. Doctor overrides are local per clinician, patient and visit; definitions are local per clinician.

Template setup now offers typed factor rules with equals/minimum/maximum comparisons. The doctor selects the values; the catalogue has no diagnostic thresholds or treatment rules. Existing templates remain compatible. Run both templateModel.test.js and factorModel.test.js with node --test. All 25 tests and the frontend build pass. In-memory rendering also checked profile/report factor display and preservation of direct medicine entry; interactive browser verification remains pending.


## Automatic prescription capture (30 October 2026)

Save as template is no longer required. Named structured prescription items are captured automatically, with a short debounce and a page-exit flush. Each visit has one stable automatic template ID; edits update its version and unchanged content is not rewritten. Empty prescriptions create nothing, and clearing the prescription archives its automatic copy.

The record is labelled in progress until the existing End visit action succeeds and the dashboard marks the visit completed. In-progress automatic copies are not suggested or applicable; completed copies can become options for other visits. The current visit's own copy is excluded from its suggestions. No additional doctor confirmation or template-name entry is required.

The reusable payload contains structured medicine fields and numeric/choice factor snapshots. Consultation notes, free-text patient instructions, item instructions and follow-up are not copied automatically. Factor snapshots measure similarity; differences do not invent contraindication rules. Explicit manually configured exclusions and required comparisons continue to apply. Manual template creation, editing and archiving remain available. Customized names and rules are retained when the visit's medicines update.

This remains local browser storage, not a backend prescription archive or a trained statistical model. Library and draft corruption or concurrent-tab changes pause automatic writes.


## Maternity-card values

The catalogue now contains 83 fields. Prescription Factors reads the existing saved maternity card for the current patient, refreshes on window focus, and offers Refresh card. No backend schema or pipeline implementation was changed. Saved values are loaded from the existing get-card API; factor definitions and doctor overrides remain browser-local.

The adapter covers baseline and obstetric history, dated antenatal measurements, scan and vaccination history, repeat investigations, and delivery/postnatal values. Each populated value retains its episode, date, row and source where supplied. Latest dated observations are used per field; weeks and days are never combined from different visits. Newer lab reports take precedence over older maternity observations. Explicit doctor overrides remain authoritative. Failure to load the card is visible and pauses automatic reusable-copy capture rather than replacing prior snapshots with incomplete data.

New default fields are merged into saved catalogues without losing custom fields, renamed labels or hidden settings. Neonatal fields are available for review but are not automatically included in maternal similarity snapshots. The build and all 39 model/adapter tests pass. Interactive browser verification remains pending.
