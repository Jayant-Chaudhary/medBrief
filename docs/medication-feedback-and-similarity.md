# Medication template similarity and feedback

## Template library and visit workflow

1. The clinician creates and maintains reusable templates in **Medication Templates**, outside any patient visit. A template contains reusable medicine items, instructions/follow-up, optional ailment tags, structured factor rules, and general applicability criteria. It is owned by the clinician and is not attached to the patient or visit where it was created.
2. Template creation is also reachable from the consultation side panel. That creates a reusable library entry; the patient visit only supplies the context for later search.
3. In a visit, the clinician records or reviews structured factors and selects **Search templates**. The client compares those factors to clinician-authored template rules and accepted/edited prior examples. Visit purpose is not a template eligibility rule.
4. The server returns all clinician-owned active templates in the applicable gestational range. It does not filter by consultation purpose or infer an ailment from lab values. The client ranks candidates and presents up to three for clinician review. Ailment tags are descriptive and can contribute to matching only when the corresponding factor is explicitly present in the recorded patient context.
5. The evaluation event stores all linked lab report metrics, vitals, allergy review, gestational context, the confirmed factor snapshot, and the candidates actually displayed (including score/method/coverage).
6. The clinician can add a template to the visit draft, mark it not suitable, or defer it. A selected subset or skipped duplicate is logged as edited. A recommendation choice never finalizes or sends a prescription.
7. Draft medicine items carry the feedback-event ID. Subsequent draft saves update that feedback's captured final regimen and change its action to edited if the regimen changes.
8. The Suggestion feedback view shows totals, decision, reason/comment, displayed candidates, input snapshot, report values and final selected items.

## Similarity method and limits

The current model is an **untrained mixed-data nearest-neighbour similarity heuristic**. Numeric factors use absolute distance normalized by the observed range in the reference examples; categorical factors use exact agreement. Missing factors lower coverage. Known rule conflicts still block a candidate. Candidate scores are descriptive similarity with data coverage, not diagnosis probability, medication safety, or efficacy.

The reference examples are the factor snapshots associated with clinician `accepted` or `edited` template decisions. Those decisions are preference labels only; they are not clinical outcomes. Rejected/deferred records remain in the audit/feedback view but do not become positive similarity examples. There is no model fitting service, learned feature weights, calibration, or efficacy prediction.

The evaluation event also retains all linked lab metrics so future analysis can decide which fields are useful. The current similarity score only uses the configured, verified `factorSnapshot`; it does not indiscriminately treat every raw OCR value as a feature. Keep raw lab data and the model feature set distinct until field mappings, data quality, and validation are established.

## Supabase

This UI/API integration uses the existing tables and functions from `20261030000000_medication_template_feedback.sql`; it adds no new schema requirement. If that migration has already been applied to the app's Supabase project, no further migration is needed for this code. The demo SQL in `supaBase/seeds/medication_allergy_demo.sql` is separate, is not configured as a Supabase CLI seed, and is never run by `db push` by itself.

## Matcher implementation boundary

Similarity is calculated in the Electron/web client from reusable templates and accepted/edited examples returned by the authenticated backend API. The backend event is written before the client finalizes its displayed list; the client then updates the event with the exact displayed candidate scores. Both calls are required for a fully auditable evaluation. Patient allergies stay in the consultation side panel and are shown as medicine association flags during review; the matcher does not remove a candidate or make the clinician's prescribing decision.
