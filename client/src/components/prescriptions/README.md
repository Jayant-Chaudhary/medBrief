# Prescription suggestions inside a visit

Open an active patient visit, open Consultation, and find Prescription.

## UI

- The default view contains patient factors, a live **Use a template** search, and a direct medicine editor with inline ghost text inside name, dose, frequency and duration fields. Selecting a search result fills its saved regimen; selecting another template replaces the previous template's copied medicines.
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

The adapter covers baseline and obstetric history, dated antenatal measurements, scan and vaccination history, repeat investigations, and delivery/postnatal values. Imported investigation values are matched by the maternity card's stable investigation key, not by a fresh report lookup. Each populated value retains its episode, date, row and source where supplied. The latest dated card observation is used per field; weeks and days are never combined from different visits. Explicit visit-specific doctor overrides remain authoritative. Missing card values stay unknown, and a card loading failure is shown rather than silently falling back to an older uploaded report.

New default fields are merged into saved catalogues without losing custom fields, renamed labels or hidden settings. Neonatal fields are available for review but are not automatically included in maternal similarity snapshots. The build and all 39 model/adapter tests pass. Interactive browser verification remains pending.

## Backend suggestions and decision feedback (1 November 2026)

The prescription workspace now reads templates, drafts, allergy records and factors through the authenticated decision-support API. Suggestions are requested only after the clinician confirms an indication. The backend stores the visit's structured snapshot and eligible templates; the UI ranks eligible templates with the similarity method and records the exact displayed list and scores. Selecting a template, marking it not suitable, or deferring it records the clinician's decision. Draft items linked to an accepted/edited suggestion keep the captured regimen synchronized as the draft changes. The feedback review overlay shows decisions, candidates and the recorded factor/lab snapshot.

Accepted and edited choices provide **preference examples** for the similarity matcher. They are not treatment outcomes. The current Gower-style matcher is still an untrained retrieval heuristic: numeric values use observed-range distance, categorical values use exact agreement, and missing values reduce coverage. It does not predict diagnoses, safety, or effectiveness. The evaluation event stores every linked lab metric for future analysis, while similarity currently uses only configured confirmed factors. See [medication-feedback-and-similarity.md](../../../../docs/medication-feedback-and-similarity.md).

## Live ranked search and ghost completion (2 November 2026)

This supersedes the explicit search/indication steps described above. In an active visit, focus **Use a template**, beside the medicine editor, to see saved templates. Type part of a template name, tag, or medicine name to narrow the list. Typing filters the fitted ranking rather than fitting a different model to each search. Results sort by descending model score, with zero-match and unscored templates retained at the bottom; applicability conflicts follow non-conflicting templates and are flagged for review. The list scrolls and supports up to 500 results, matching the API evaluation limit. Cards show medicine names, **patient similarity**, factor counts and coverage. Rule-only templates explicitly show **rules matched** instead. Missing comparisons remain labelled as unavailable, rather than a fabricated 0% similarity. No percentage is presented as prediction accuracy.

The library and name completion render immediately from loaded templates, including when factor data is incomplete or the eligibility service fails. Search waits for a 300 ms pause before evaluating through the authenticated visit API. Search text stays in the client; only structured factors go into the evaluation request. The server continues to check visit access and gestational eligibility. The filtered display order and scores of server-eligible entries are recorded for decision feedback. Other entries remain visible for review. Older responses are ignored, and factor/template/visit changes invalidate old evaluation metadata immediately. Failed requests show Retry without blanking the list. Factor-load errors pause background evaluation and medicine-recommendation ghosts, while saved-template browsing and name completion remain available.

Suggestions now appear as Copilot-style grey text **inside the medicine inputs**, rather than a separate saved-template panel. Empty name, dose, frequency and duration fields show the corresponding saved text; typing a matching prefix leaves only the untyped suffix grey. Tab accepts the current field's completion, Esc dismisses it, and Shift+Tab, modified keys, composition and cursor movement retain native behavior. The overlay uses the input's padding, font and scroll position, with a transparent input background. Unaccepted text is never stored in the draft. If no actual medicine rows exist, the editor renders a transient suggestion row; it becomes a real row only on typing or explicit acceptance.

Medicine-field completion uses the highest-ranked active saved template whose medicine matches the typed prefix. Zero-match, rule-only and unscored templates can supply saved text; no regimen values are generated. Known applicability conflicts and server review-only entries do not supply inline completions. Existing medicine rows prefer their recorded template source, and already-present medicines are skipped for new rows. Search-box template-name completion remains separate: Tab there completes only the template name.

Clicking a search result or pressing Enter immediately fills saved medicines, dose, frequency and duration into the editable draft. Switching to another template removes the previous template's copied rows, including when both templates contain the same medicine with different regimens. Independently entered medicines, patient instructions and follow-up are retained. Repeated selection does not duplicate medicines. If a selected medicine was already independently entered, missing fields are filled while existing doctor-entered values are preserved; that row remains independent on later template switches. Rapid selections are serialized with only the most recent queued selection retained. The draft updates immediately, saves through the existing HTTP API and records eligible selection feedback. Copy and feedback failures are shown separately; edits made while saving are retained. Review top template details still opens the optional selection/allergy dialog. Known applicability conflicts open review and block copying. Medicine–allergy flags remain visible beside affected draft items. No prescription is published by selecting a template.

The previous separate medicine-ghost card is no longer rendered in the visit workspace. Similarity scoring is unchanged; inline completion reuses saved text and does not use the legacy recommendation-ghost threshold to hide the input overlays.

The client result limit/debounce are in `prescriptionConfig.js`; the API display limit is in `server/src/config/medicationDecision.config.js`. Both limits are 500. No new packages, environment variables, database tables or migrations are required. Changes are limited to prescription UI/search helpers, rendering verification and the existing decision-support display-list limit/tests.

Verification commands:

- From `client`: `npm.cmd run build`.
- From `client`: `node scripts/verifyPrescriptionRendering.mjs` verifies the actual inline-field components render four ghost overlays, keep actual input values empty and perform no draft writes. A partial-name fixture verifies only the untyped suffix is grey.
- From `client`: `node --test src/components/prescriptions/templateModel.test.js src/components/prescriptions/factorModel.test.js src/components/prescriptions/maternityFactors.test.js src/components/prescriptions/similarityModel.test.js src/components/prescriptions/templateSearchModel.test.js src/components/prescriptions/inlineGhostModel.test.js`.
- From `server`: `npm.cmd test -- --runInBand --coverage=false src/tests/medicationDecision.test.js`.

The build, inline-field rendering check, 33 targeted search/similarity/inline-completion checks and seven decision-support API tests pass. Checks cover ranking, zero-match retention, suffix completion and keyboard handling, replacement between templates (including different regimens for the same medicine), preservation of manual values and delayed responses. Three existing `templateModel.test.js` failures were also reproduced using the committed HEAD versions: `matches normalized confirmed factors and purpose`, `unknown required factors are missing, not matches`, and `unknown age and pregnancy stay unknown; untagged and archived templates are not suggested`. They concern the existing associated-ailment matching expectations and were not changed here. Neither package defines a lint or type-check script.

Interactive browser/device verification has not been run. Manual check with synthetic records only:

1. Start the server and client, sign in as a clinician, and open an active synthetic visit with approved templates and recorded factors.
2. With an empty draft, confirm grey saved text appears inside the four medicine inputs, while the actual values remain blank. Type the start of a saved medicine name: the rest should stay grey. Tab accepts only the current field; Esc dismisses. Check Shift+Tab, cursor movement and input-method composition.
3. Focus template search; confirm descending scores with zero-match and unscored entries retained. Search by a medicine or tag, then clear to restore the list. Template-name Tab completion must not copy medicines.
4. Select template A, then B: B's saved medicines, doses, frequencies and durations should replace A's copied rows, with no stacking. Test both templates sharing the same medicine with different doses. Try rapid A/B/C selection and confirm the last selected template remains. Independently entered medicines and patient instructions must stay.
5. Use Review top template details to inspect item selection and allergy details. Known conflicts should remain review-only; relevant allergy flags should appear on copied draft items. Check the layout at a narrow/mobile width.
6. Throttle the connection, change the query quickly, and update a factor. Confirm current local results remain available and delayed responses never replace current eligibility metadata. Simulate failed evaluation and failed draft save; verify separate retry/error messages. Confirm eligible candidates and later clinician decisions in Suggestion feedback.
