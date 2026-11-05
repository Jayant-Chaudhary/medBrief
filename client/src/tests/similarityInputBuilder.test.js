import { describe, it, expect } from 'vitest';
import { buildSimilarityQueryPatient } from '../utils/similarityInputBuilder.js';

describe('similarityInputBuilder (Phase 3+4)', () => {
  it('does NOT fabricate clinical numbers when data is missing', () => {
    const raw = {
      patient: { id: 'p-1' },
      appointment: {},
      vitals: {},
    };

    const result = buildSimilarityQueryPatient(raw);

    expect(result.patientId).toBe('p-1');
    expect(result.age).toBeUndefined();
    expect(result.gestationalWeeks).toBeUndefined();
    expect(result.gestational_weeks).toBeUndefined();
    expect(result.gravida).toBeUndefined();
    expect(result.para).toBeUndefined();
    expect(result.bmi).toBeUndefined();
    expect(result.vitals.bp_systolic).toBeUndefined();
    expect(result.vitals.bp_diastolic).toBeUndefined();
    expect(result.vitals.heart_rate).toBeUndefined();
    expect(result.insufficientData).toBe(true);
    expect(result.missingFactors).toContain('gestational_age');
    expect(result.missingFactors).toContain('blood_pressure');
  });

  it('preserves legitimate zeros (e.g. para: 0)', () => {
    const raw = {
      patient: { id: 'p-2', age: 24, gravida: 1, para: 0, bmi: 22.5 },
      appointment: { gestationalAgeWeeks: 30 },
      vitals: { systolic: 110, diastolic: 70 },
    };

    const result = buildSimilarityQueryPatient(raw);

    expect(result.para).toBe(0);
    expect(result.parity).toBe(0);
    expect(result.gravida).toBe(1);
    expect(result.gestationalWeeks).toBe(30);
    expect(result.gestational_weeks).toBe(30);
    expect(result.bmi).toBe(22.5);
    expect(result.vitals.bp_systolic).toBe(110);
    expect(result.vitals.bp_diastolic).toBe(70);
    expect(result.insufficientData).toBe(false);
  });

  it('reads OCR lab metrics from parsed_value and reviewed_value, skipping unreviewed metrics', () => {
    const raw = {
      patient: { id: 'p-3' },
      appointment: { gestationalAgeWeeks: 28 },
      historyReports: [
        {
          id: 'rep-1',
          report_date: '2026-10-10',
          lab_report_metrics: [
            // Standard parsed metric (reviewed_by is not required if needs_review is false)
            {
              standard_key: 'hemoglobin',
              parsed_value: '11.8',
              needs_review: false,
            },
            // Unreviewed metric requiring review (must be skipped)
            {
              standard_key: 'platelets',
              parsed_value: '140000',
              needs_review: true,
              reviewed_by: null,
            },
            // Reviewed metric with human sign-off overriding parsed_value
            {
              standard_key: 'fasting_glucose',
              parsed_value: '80',
              reviewed_value: '86',
              needs_review: true,
              reviewed_by: 'dr-1',
            },
          ],
        },
      ],
    };

    const result = buildSimilarityQueryPatient(raw);

    expect(result.labs.hemoglobin).toBe(11.8);
    expect(result.labs.platelets).toBeUndefined(); // Skipped because unreviewed
    expect(result.labs.fasting_glucose).toBe(86); // Reviewed value took precedence
  });

  it('sorts multiple reports descending by date so newest reading takes precedence', () => {
    const raw = {
      patient: { id: 'p-4' },
      appointment: { gestationalAgeWeeks: 32 },
      historyReports: [
        {
          id: 'rep-old',
          report_date: '2026-09-01',
          lab_report_metrics: [
            { standard_key: 'hemoglobin', parsed_value: '10.2', needs_review: false },
          ],
        },
        {
          id: 'rep-new',
          report_date: '2026-10-01',
          lab_report_metrics: [
            { standard_key: 'hemoglobin', parsed_value: '11.5', needs_review: false },
          ],
        },
      ],
    };

    const result = buildSimilarityQueryPatient(raw);

    expect(result.labs.hemoglobin).toBe(11.5);
  });

  it('preserves boolean false in questionnaire answers and passes detail/answer_text', () => {
    const raw = {
      patient: { id: 'p-5' },
      appointment: { gestationalAgeWeeks: 34 },
      questionnaire: {
        answers: [
          {
            questionText: 'Are you experiencing severe headaches?',
            answer: false,
            detail: 'None reported in last 2 weeks',
          },
          {
            questionText: 'Do you have swelling in your ankles?',
            answer: true,
            detail: 'Mild swelling in evenings',
          },
        ],
      },
    };

    const result = buildSimilarityQueryPatient(raw);

    expect(result.questionnaireResponses).toHaveLength(2);
    expect(result.questionnaireResponses[0].answer).toBe(false);
    expect(result.questionnaireResponses[0].detail).toBe('None reported in last 2 weeks');
    expect(result.questionnaireResponses[1].answer).toBe(true);
    expect(result.questionnaireResponses[1].detail).toBe('Mild swelling in evenings');
  });
});
