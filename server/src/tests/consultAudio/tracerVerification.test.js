/**
 * Unit Tests for Context Builder and Tracer Verification Engine (Phase 8).
 *
 * Verifies:
 * 1. Tracer catalog generation from structured labs, vitals, ultrasound, and antenatal visits.
 * 2. Citation integrity: detecting invalid or hallucinated segment_ids.
 * 3. Unverified numeric claim auditing: catching clinical numbers without disclaimer or verification.
 * 4. Verified numeric allowance: permitting numbers that match active tracers.
 * 5. Disclaimer allowance: permitting unverified numbers with required disclaimers.
 */

const {
  buildTracerCatalog,
  postCheckDraft,
} = require('../../services/consultAudio/drafting/tracerVerification');

describe('Tracer Verification Engine (Phase 8)', () => {
  describe('buildTracerCatalog', () => {
    test('generates deterministic tracer items from structured clinical records', () => {
      const structuredData = {
        verifiedLabMetrics: [
          { metricKey: 'hemoglobin', value: 10.8, unit: 'g/dL', source: 'lab_report_metric' },
          { metricKey: 'fasting_blood_sugar', value: 88, unit: 'mg/dL', source: 'lab_report_metric' },
        ],
        pregnancyInvestigations: [
          { metricKey: 'urine_protein', value: 0, unit: '', source: 'pregnancy_investigation' },
        ],
        vitalsLogs: [
          { metricKey: 'heart_rate', value: 76, unit: 'bpm', source: 'vitals_log' },
        ],
        antenatalVisits: [
          {
            bp_systolic: 118,
            bp_diastolic: 74,
            weight_kg: 62.5,
            hemoglobin_g_dl: 10.8, // duplicate value from visit
            fundal_height_cm: 22,
          },
        ],
        pregnancyUltrasounds: [
          { gestationalWeeks: 20 },
        ],
      };

      const catalog = buildTracerCatalog(structuredData);

      expect(catalog).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            tracer_id: 'TRACER_HEMOGLOBIN_10.8',
            metric: 'hemoglobin',
            value: 10.8,
            unit: 'g/dL',
          }),
          expect.objectContaining({
            tracer_id: 'TRACER_BP_SYSTOLIC_118',
            metric: 'bp_systolic',
            value: 118,
            unit: 'mmHg',
          }),
          expect.objectContaining({
            tracer_id: 'TRACER_BP_DIASTOLIC_74',
            metric: 'bp_diastolic',
            value: 74,
            unit: 'mmHg',
          }),
          expect.objectContaining({
            tracer_id: 'TRACER_WEIGHT_62.5',
            metric: 'weight',
            value: 62.5,
            unit: 'kg',
          }),
        ])
      );

      // Verify no duplicate tracer_ids
      const tracerIds = catalog.map((t) => t.tracer_id);
      const uniqueIds = new Set(tracerIds);
      expect(uniqueIds.size).toBe(tracerIds.length);
    });

    test('ignores invalid or NaN values gracefully', () => {
      const structuredData = {
        verifiedLabMetrics: [
          { metricKey: 'invalid_test', value: NaN },
          { metricKey: 'null_test', value: null },
        ],
      };

      const catalog = buildTracerCatalog(structuredData);
      expect(catalog).toEqual([]);
    });
  });

  describe('postCheckDraft: Citation Integrity', () => {
    const validSegmentIds = new Set(['seg-001', 'seg-002', 'seg-003']);

    test('passes when all cited segment_ids exist in the merged transcript', () => {
      const doctorNotes = {
        plan_and_recommendations: [
          { recommendation: 'Continue iron tablet.', cited_segment_ids: ['seg-001', 'seg-002'] },
        ],
      };
      const clinicalFlags = [
        { flag_name: 'mild_fatigue', severity: 'low', description: 'Fatigue reported', cited_segment_ids: ['seg-003'] },
      ];

      const result = postCheckDraft({
        doctorNotes,
        patientSummary: {},
        clinicalFlags,
        validSegmentIds,
        tracerCatalog: [],
      });

      expect(result.reviewReasons).not.toContain('invalid_segment_citation');
    });

    test('flags invalid_segment_citation when a hallucinated segment_id is cited', () => {
      const doctorNotes = {
        plan_and_recommendations: [
          { recommendation: 'Bedrest advised.', cited_segment_ids: ['seg-001', 'seg-hallucinated-999'] },
        ],
      };

      const result = postCheckDraft({
        doctorNotes,
        patientSummary: {},
        clinicalFlags: [],
        validSegmentIds,
        tracerCatalog: [],
      });

      expect(result.isValidForApproval).toBe(false);
      expect(result.reviewReasons).toContain('invalid_segment_citation');
    });
  });

  describe('postCheckDraft: Numeric Claim Auditing', () => {
    const validSegmentIds = new Set(['seg-001']);
    const tracerCatalog = [
      { tracer_id: 'TRACER_HEMOGLOBIN_10.8', metric: 'hemoglobin', value: 10.8, unit: 'g/dL' },
      { tracer_id: 'TRACER_BP_SYSTOLIC_118', metric: 'bp_systolic', value: 118, unit: 'mmHg' },
    ];

    test('verifies numbers that exist in the tracer catalog', () => {
      const doctorNotes = {
        vitals_observed: 'Blood pressure verified at 118 mmHg.',
        assessment: 'Hemoglobin measured at 10.8 g/dL.',
        plan_and_recommendations: [
          { recommendation: 'Continue supplements.', cited_segment_ids: ['seg-001'] },
        ],
      };

      const result = postCheckDraft({
        doctorNotes,
        patientSummary: {},
        clinicalFlags: [],
        validSegmentIds,
        tracerCatalog,
      });

      expect(result.reviewReasons).not.toContain('unverified_numeric_claim');
      expect(result.tracersUsed).toHaveLength(2);
      expect(result.tracersUsed.map((t) => t.tracer_id)).toContain('TRACER_HEMOGLOBIN_10.8');
    });

    test('flags unverified_numeric_claim when an unverified number is stated without disclaimer', () => {
      const doctorNotes = {
        vitals_observed: 'Platelet count is 95000.', // 95000 is not in tracerCatalog and lacks disclaimer
        assessment: 'Stable progress.',
        plan_and_recommendations: [
          { recommendation: 'Routine follow-up.', cited_segment_ids: ['seg-001'] },
        ],
      };

      const result = postCheckDraft({
        doctorNotes,
        patientSummary: {},
        clinicalFlags: [],
        validSegmentIds,
        tracerCatalog,
      });

      expect(result.isValidForApproval).toBe(false);
      expect(result.reviewReasons).toContain('unverified_numeric_claim');
    });

    test('permits unverified numbers when labeled with required disclaimer', () => {
      const doctorNotes = {
        vitals_observed: 'Platelet count was 95000 stated verbally, unverified by patient.',
        assessment: 'Review formal report when available.',
        plan_and_recommendations: [
          { recommendation: 'Routine follow-up.', cited_segment_ids: ['seg-001'] },
        ],
      };

      const result = postCheckDraft({
        doctorNotes,
        patientSummary: {},
        clinicalFlags: [],
        validSegmentIds,
        tracerCatalog,
      });

      expect(result.reviewReasons).not.toContain('unverified_numeric_claim');
    });
  });
});
