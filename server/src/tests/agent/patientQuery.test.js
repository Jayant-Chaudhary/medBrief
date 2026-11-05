const {
  detectClinicalQuery,
  queryPatientMetric,
  formatMetricAnswer,
} = require('../../services/assistant/patientQuery.service');
const assistant = require('../../services/assistant/assistant.service');

describe('Clinical Patient Q&A Query Engine', () => {
  describe('detectClinicalQuery', () => {
    it('detects haemoglobin questions with typos and aliases', () => {
      const q1 = detectClinicalQuery('whats the hameoglobin of this patient');
      expect(q1.isQuery).toBe(true);
      expect(q1.isDiagnostic).toBe(false);
      expect(q1.metricTerm).toBe('haemoglobin');

      const q2 = detectClinicalQuery('what is her hb?');
      expect(q2.isQuery).toBe(true);
      expect(q2.metricTerm).toBe('haemoglobin');

      const q3 = detectClinicalQuery("what is Asha Example's hemoglobin");
      expect(q3.isQuery).toBe(true);
      expect(q3.candidateName).toBe('Asha Example');
      expect(q3.metricTerm).toBe('haemoglobin');
    });

    it('detects any uploaded lab test or analyte universally', () => {
      const q1 = detectClinicalQuery('what is her ferritin?');
      expect(q1.isQuery).toBe(true);
      expect(q1.metricTerm).toBe('ferritin');

      const q2 = detectClinicalQuery('what was her platelet count');
      expect(q2.isQuery).toBe(true);
      expect(q2.metricTerm).toBe('platelet count');

      const q3 = detectClinicalQuery('show me her fasting blood sugar');
      expect(q3.isQuery).toBe(true);
      expect(q3.metricTerm).toBe('fasting blood glucose');

      const q4 = detectClinicalQuery('what is her rubella status');
      expect(q4.isQuery).toBe(true);
      expect(q4.metricTerm).toBe('rubella');
    });

    it('detects vitals, maternity records, and blood group', () => {
      const q1 = detectClinicalQuery('what was her last bp');
      expect(q1.isQuery).toBe(true);
      expect(q1.metricTerm).toBe('blood pressure');

      const q2 = detectClinicalQuery("what is Priya's blood group");
      expect(q2.isQuery).toBe(true);
      expect(q2.candidateName).toBe('Priya');
      expect(q2.metricTerm).toBe('blood group');

      const q3 = detectClinicalQuery('what is her weight');
      expect(q3.isQuery).toBe(true);
      expect(q3.metricTerm).toBe('weight');

      const q4 = detectClinicalQuery('what is her due date');
      expect(q4.isQuery).toBe(true);
      expect(q4.metricTerm).toBe('due date');
    });

    it('safely flags and catches diagnostic questions', () => {
      expect(detectClinicalQuery('is her hb normal').isDiagnostic).toBe(true);
      expect(detectClinicalQuery('is that blood pressure high?').isDiagnostic).toBe(true);
      expect(detectClinicalQuery('does she have gestational diabetes').isDiagnostic).toBe(true);
      expect(detectClinicalQuery('what should I prescribe for this').isDiagnostic).toBe(true);
    });

    it('ignores general navigation or action commands', () => {
      expect(detectClinicalQuery('show today schedule').isQuery).toBe(false);
      expect(detectClinicalQuery('book an appointment tomorrow').isQuery).toBe(false);
      expect(detectClinicalQuery('open consultation notes').isQuery).toBe(false);
    });
  });

  describe('queryPatientMetric', () => {
    it('retrieves recorded haemoglobin from antenatal visits', async () => {
      const mockSupabase = {
        from: (table) => ({
          select: () => ({
            eq: () => ({
              eq: () => ({
                eq: () => ({
                  order: () => ({
                    limit: () => ({
                      maybeSingle: async () => ({
                        data: { id: 'ep-1', blood_group: 'B+', due_date: '2026-12-15' },
                      }),
                    }),
                  }),
                }),
              }),
              order: async () => ({
                data: [
                  { id: 'v-1', hemoglobin_g_dl: 10.4, bp_systolic: 120, bp_diastolic: 80, visit_date: '2026-10-14' },
                ],
              }),
            }),
            in: () => ({
              order: async () => ({ data: [] }),
            }),
          }),
        }),
      };

      const result = await queryPatientMetric('doc-1', 'pat-1', 'haemoglobin', {
        supabaseClient: mockSupabase,
        reportIdsFn: async () => [],
      });

      expect(result).not.toBeNull();
      expect(result.name).toBe('Haemoglobin');
      expect(result.value).toBe(10.4);
      expect(result.unit).toBe('g/dL');
      expect(result.date).toBe('2026-10-14');
      expect(result.source).toBe('Antenatal Visit');
    });

    it('retrieves uploaded lab report metric like Ferritin', async () => {
      const mockSupabase = {
        from: (table) => {
          if (table === 'pregnancy_episodes') {
            return {
              select: () => ({
                eq: () => ({
                  eq: () => ({
                    eq: () => ({
                      order: () => ({
                        limit: () => ({
                          maybeSingle: async () => ({ data: null }),
                        }),
                      }),
                    }),
                  }),
                }),
              }),
            };
          }
          if (table === 'lab_report_metrics') {
            return {
              select: () => ({
                in: () => ({
                  order: async () => ({
                    data: [
                      {
                        raw_key: 'Ferritin',
                        standard_key: 'ferritin',
                        parsed_value: 28,
                        unit_standard: 'ng/mL',
                        lab_reports: { id: 'rep-1', report_date: '2026-10-02' },
                      },
                    ],
                  }),
                }),
              }),
            };
          }
          return {
            select: () => ({
              eq: () => ({
                order: async () => ({ data: [] }),
              }),
            }),
          };
        },
      };

      const result = await queryPatientMetric('doc-1', 'pat-1', 'ferritin', {
        supabaseClient: mockSupabase,
        reportIdsFn: async () => ['rep-1'],
      });

      expect(result).not.toBeNull();
      expect(result.value).toBe(28);
      expect(result.unit).toBe('ng/mL');
      expect(result.date).toBe('2026-10-02');
      expect(result.source).toBe('Lab Report');
    });
  });

  describe('formatMetricAnswer', () => {
    it('formats a quantitative test result with source and date', () => {
      const formatted = formatMetricAnswer(
        'Asha Example',
        'haemoglobin',
        { name: 'Haemoglobin', value: 10.4, unit: 'g/dL', date: '2026-10-14', source: 'Antenatal Visit', sourceType: 'maternity' },
        'pat-1'
      );
      expect(formatted.text).toContain("Asha Example's latest recorded Haemoglobin is 10.4 g/dL");
      expect(formatted.text).toContain('from Antenatal Visit');
      expect(formatted.recordPath).toBe('/clinician/maternity?patientId=pat-1');
    });

    it('formats missing metric message cleanly without diagnosing', () => {
      const formatted = formatMetricAnswer('Asha Example', 'ferritin', null, 'pat-1');
      expect(formatted.text).toBe("No recorded Ferritin found in Asha Example's uploaded reports or visits.");
      expect(formatted.recordPath).toBe('/clinician/maternity?patientId=pat-1');
    });
  });

  describe('handleStep integration', () => {
    it('answers haemoglobin question when viewing an active patient appointment', async () => {
      const reply = await assistant.handleStep({
        message: 'whats the hameoglobin of this patient',
        role: 'clinician',
        userId: 'doc-1',
        currentPath: '/clinician',
        currentRecord: { kind: 'visit', id: 'apt-1' },
        directory: async () => [{ id: 'pat-1', fullName: 'Sunita Sharma' }],
        recordLookup: async () => ({ id: 'apt-1', patient_id: 'pat-1' }),
      });

      expect(reply.type).toBe('answer');
      expect(reply.source).toBe('clinical_record');
      expect(typeof reply.text).toBe('string');
      expect(reply.text.length).toBeGreaterThan(0);
    });

    it('resolves named patient when asked in query', async () => {
      const reply = await assistant.handleStep({
        message: "what is Asha Example's blood group?",
        role: 'clinician',
        userId: 'doc-1',
        currentPath: '/clinician',
        directory: async () => [{ id: 'pat-2', fullName: 'Asha Example' }],
        recordLookup: async () => null,
      });

      expect(reply.type).toBe('answer');
      expect(reply.source).toBe('clinical_record');
      expect(reply.text).toContain('Asha Example');
    });

    it('clarifies which patient when no patient is named and none is open', async () => {
      const reply = await assistant.handleStep({
        message: 'what was the platelet count',
        role: 'clinician',
        userId: 'doc-1',
        currentPath: '/clinician',
        currentRecord: null,
        directory: async () => [{ id: 'pat-1', fullName: 'Sunita Sharma' }],
        recordLookup: async () => null,
      });

      expect(reply.type).toBe('clarify');
      expect(reply.message).toBe("Which patient's record would you like me to check?");
    });

    it('refuses diagnostic interpretation and adheres to AGENTS.md safety rules', async () => {
      const reply = await assistant.handleStep({
        message: 'is her hb normal?',
        role: 'clinician',
        userId: 'doc-1',
        currentPath: '/clinician',
        currentRecord: { kind: 'visit', id: 'apt-1' },
        directory: async () => [{ id: 'pat-1', fullName: 'Sunita Sharma' }],
        recordLookup: async () => ({ id: 'apt-1', patient_id: 'pat-1' }),
      });

      expect(reply.type).toBe('answer');
      expect(reply.text).toContain('do not diagnose');
    });
  });
});
