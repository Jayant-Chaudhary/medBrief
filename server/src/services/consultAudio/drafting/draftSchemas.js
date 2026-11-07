/**
 * Schema Definitions for Clinical Notes Drafting (Phase 8).
 *
 * Implements Zod validation schemas and OpenAPI/Gemini JSON schemas for:
 * 1. Doctor Notes Draft (chief complaint, vitals observed, assessment, plan & recommendations with cited_segment_ids)
 * 2. Patient Summary (patient-facing summary, action checklist, warning signs)
 * 3. Clinical Flags (operational prioritization flags with severity and cited_segment_ids)
 *
 * Note on Medical Safety (AGENTS.md):
 * - The platform flags and prioritizes; it NEVER diagnoses.
 * - Assessment is descriptive clinical synthesis only.
 */

const { z } = require('zod');

// 1. Zod Schemas

const DoctorRecommendationSchema = z.object({
  recommendation: z.string().min(1, 'Recommendation text is required'),
  cited_segment_ids: z.array(z.string()).min(1, 'At least one supporting segment_id must be cited'),
});

const DoctorNotesSchema = z.object({
  chief_complaint: z.string().default(''),
  vitals_observed: z.string().default(''),
  // May come back empty for a short or off-topic visit. The draft is still
  // saved; draft.service adds a review reason so the doctor writes it.
  assessment: z.string().default(''),
  plan_and_recommendations: z.array(DoctorRecommendationSchema).default([]),
});

const PatientSummarySchema = z.object({
  summary_text: z.string().default(''),
  action_checklist: z.array(z.string()).default([]),
  warning_signs: z.array(z.string()).default([]),
});

const ClinicalFlagItemSchema = z.object({
  flag_name: z.string().min(1, 'Flag name is required'),
  severity: z.enum(['low', 'medium', 'high']).default('low'),
  description: z.string().min(1, 'Description is required'),
  cited_segment_ids: z.array(z.string()).min(1, 'Supporting segment_id must be cited'),
});

const ClinicalFlagsSchema = z.object({
  flags: z.array(ClinicalFlagItemSchema).default([]),
});

const FullDraftSchema = z.object({
  doctor_notes: DoctorNotesSchema,
  patient_summary: PatientSummarySchema,
  clinical_flags: z.array(ClinicalFlagItemSchema),
});

/**
 * Model output sometimes contains a flag with no supporting segment. One such
 * item must not fail the whole draft, so uncited flags are removed and counted
 * (the count becomes a review reason; flag text is never logged).
 */
function dropUncitedFlags(raw) {
  const flags = Array.isArray(raw) ? raw : raw?.flags;
  if (!Array.isArray(flags)) return { raw, dropped: 0 };
  const kept = flags.filter(
    (f) => Array.isArray(f?.cited_segment_ids) && f.cited_segment_ids.length > 0
  );
  return { raw: { ...(Array.isArray(raw) ? {} : raw), flags: kept }, dropped: flags.length - kept.length };
}

/** Same rule for doctor-note plan items: no cited segment, no item (counted, never logged). */
function dropUncitedRecommendations(raw) {
  const items = raw?.plan_and_recommendations;
  if (!Array.isArray(items)) return { raw, dropped: 0 };
  const kept = items.filter(
    (r) => Array.isArray(r?.cited_segment_ids) && r.cited_segment_ids.length > 0
  );
  return { raw: { ...raw, plan_and_recommendations: kept }, dropped: items.length - kept.length };
}

// 2. Gemini Response Schemas (OpenAPI subset supported by Google Generative AI)

const GEMINI_DOCTOR_NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    chief_complaint: { type: 'STRING' },
    vitals_observed: { type: 'STRING' },
    assessment: { type: 'STRING' },
    plan_and_recommendations: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          recommendation: { type: 'STRING' },
          cited_segment_ids: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['recommendation', 'cited_segment_ids'],
      },
    },
  },
  required: ['chief_complaint', 'vitals_observed', 'assessment', 'plan_and_recommendations'],
};

const GEMINI_PATIENT_SUMMARY_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary_text: { type: 'STRING' },
    action_checklist: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
    warning_signs: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['summary_text', 'action_checklist', 'warning_signs'],
};

const GEMINI_CLINICAL_FLAGS_SCHEMA = {
  type: 'OBJECT',
  properties: {
    flags: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          flag_name: { type: 'STRING' },
          severity: { type: 'STRING' },
          description: { type: 'STRING' },
          cited_segment_ids: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['flag_name', 'severity', 'description', 'cited_segment_ids'],
      },
    },
  },
  required: ['flags'],
};

const GEMINI_COMBINED_DRAFT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    doctor_notes: GEMINI_DOCTOR_NOTES_SCHEMA,
    patient_summary: GEMINI_PATIENT_SUMMARY_SCHEMA,
    clinical_flags: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          flag_name: { type: 'STRING' },
          severity: { type: 'STRING' },
          description: { type: 'STRING' },
          cited_segment_ids: {
            type: 'ARRAY',
            items: { type: 'STRING' },
          },
        },
        required: ['flag_name', 'severity', 'description', 'cited_segment_ids'],
      },
    },
  },
  required: ['doctor_notes', 'patient_summary', 'clinical_flags'],
};

module.exports = {
  DoctorRecommendationSchema,
  DoctorNotesSchema,
  PatientSummarySchema,
  ClinicalFlagItemSchema,
  ClinicalFlagsSchema,
  dropUncitedFlags,
  dropUncitedRecommendations,
  FullDraftSchema,
  GEMINI_DOCTOR_NOTES_SCHEMA,
  GEMINI_PATIENT_SUMMARY_SCHEMA,
  GEMINI_CLINICAL_FLAGS_SCHEMA,
  GEMINI_COMBINED_DRAFT_SCHEMA,
};
