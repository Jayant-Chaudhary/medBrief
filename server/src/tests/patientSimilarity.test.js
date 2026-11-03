const request = require('supertest');
const app = require('../app');
const logger = require('../utils/logger');
const {
  extractPatientProfile,
  verifyAndFilterExtractedSymptoms,
} = require('../services/patientSimilarity/featureExtractor');
const {
  fitPatientCohortModel,
  resolveSymptomBaseWeight,
  rankCohortMatches,
} = require('../services/patientSimilarity/similarityEngine');
const {
  adaptUciMaternalRow,
  adaptDialogueTextToSegments,
} = require('../services/patientSimilarity/publicDatasetAdapter');
const {
  generateSyntheticMaternalCohort,
} = require('../services/patientSimilarity/cohortGenerator');
const { SAMPLE_DEMO_QUERIES } = require('../services/patientSimilarity/syntheticCohort.fixtures');

jest.mock('../config/supabaseAdminClient', () => ({
  auth: { getUser: jest.fn() },
  from: jest.fn(),
  rpc: jest.fn(),
}));

describe('Patient Similarity Model, Custom Weights & Dual Dataset Pipelines', () => {
  it('extracts present and negated (absent) symptoms with cited_segment_ids from consultation transcript', async () => {
    const sample = SAMPLE_DEMO_QUERIES.elevatedBpAndHeadacheScenario.queryPatient;
    const profile = await extractPatientProfile(sample, { provider: 'fake' });

    // Longitudinal delta calculation: 140 - 124 = +16 mmHg, 90 - 78 = +12 mmHg
    expect(profile.structured.bp_systolic).toBe(140);
    expect(profile.structured.bp_systolic_delta).toBe(16);
    expect(profile.structured.bp_diastolic_delta).toBe(12);
    expect(profile.structured.hemoglobin_delta).toBe(-0.3);

    // Symptom polarity: headache & pedal_edema present; visual_disturbance & epigastric_pain & vaginal_bleeding absent
    expect(profile.symptoms.headache).toMatchObject({
      status: 'present',
      severity: 'moderate',
      source: 'transcript',
      cited_segment_ids: expect.arrayContaining(['demo_seg_2']),
    });
    expect(profile.symptoms.pedal_edema).toMatchObject({
      status: 'present',
      severity: 'mild',
    });
    expect(profile.symptoms.visual_disturbance).toMatchObject({
      status: 'absent',
      source: 'transcript',
      cited_segment_ids: expect.arrayContaining(['demo_seg_4']),
    });
    expect(profile.symptoms.epigastric_pain).toMatchObject({
      status: 'absent',
      source: 'transcript',
      cited_segment_ids: expect.arrayContaining(['demo_seg_4']),
    });
  });

  it('drops uncited transcript symptoms during citation verification', () => {
    const validIds = new Set(['seg_1', 'seg_2']);
    const raw = [
      { symptom_key: 'headache', status: 'present', severity: 'moderate', source: 'transcript', cited_segment_ids: ['seg_1'] },
      { symptom_key: 'vaginal_bleeding', status: 'present', severity: 'severe', source: 'transcript', cited_segment_ids: ['seg_hallucinated_99'] },
    ];

    const verified = verifyAndFilterExtractedSymptoms(raw, validIds);
    expect(verified.droppedUncitedCount).toBe(1);
    expect(verified.kept).toHaveLength(1);
    expect(verified.kept[0].symptom_key).toBe('headache');
  });

  it('applies differentiated custom weights per parameter and per symptom, and allows runtime overrides', async () => {
    // High-priority symptom (vaginal_bleeding = 4.0) vs general symptom (fatigue_weakness = 1.5)
    expect(resolveSymptomBaseWeight('vaginal_bleeding', { vaginal_bleeding: { weight: 4.0 } })).toBe(4.0);
    expect(resolveSymptomBaseWeight('fatigue_weakness', { fatigue_weakness: { weight: 1.5 } })).toBe(1.5);
    expect(
      resolveSymptomBaseWeight('fatigue_weakness', { fatigue_weakness: { weight: 1.5 } }, { symptomItemWeights: { fatigue_weakness: 3.2 } })
    ).toBe(3.2);

    const weightsRes = await request(app).get('/api/patient-similarity/weights');
    expect(weightsRes.status).toBe(200);
    expect(weightsRes.body.structuredParameterWeights.bp_systolic.weight).toBe(2.5);
    expect(weightsRes.body.structuredParameterWeights.blood_group.weight).toBe(0.5);
    expect(weightsRes.body.symptomParameterWeights.vaginal_bleeding.weight).toBe(4.0);
    expect(weightsRes.body.symptomParameterWeights.fatigue_weakness.weight).toBe(1.5);

    // Verify custom weight override shifts ranking between a BP-matched case and a Hemoglobin-matched case
    const queryPatient = {
      gestationalWeeks: 28,
      vitals: { bp_systolic: 145, bp_diastolic: 94 },
      labs: { hemoglobin: 8.6 },
    };
    const bpMatchedCandidate = {
      id: 'cand-bp',
      gestationalWeeks: 28,
      vitals: { bp_systolic: 145, bp_diastolic: 94 },
      labs: { hemoglobin: 12.2 },
    };
    const hbMatchedCandidate = {
      id: 'cand-hb',
      gestationalWeeks: 28,
      vitals: { bp_systolic: 112, bp_diastolic: 70 },
      labs: { hemoglobin: 8.6 },
    };
    const rangeAnchor = {
      id: 'cand-anchor',
      gestationalWeeks: 28,
      vitals: { bp_systolic: 112, bp_diastolic: 70 },
      labs: { hemoglobin: 12.2 },
    };

    // 1. Emphasize BP weights -> cand-bp ranks #1
    const bpPriorityRes = await request(app)
      .post('/api/patient-similarity/evaluate-direct')
      .send({
        queryPatient,
        referenceCohort: [bpMatchedCandidate, hbMatchedCandidate, rangeAnchor],
        options: {
          extractorProvider: 'fake',
          featureWeights: { bp_systolic: 5.0, bp_diastolic: 5.0, hemoglobin: 0.2 },
        },
      });
    expect(bpPriorityRes.status).toBe(200);
    expect(bpPriorityRes.body.topMatches[0].episodeId).toBe('cand-bp');

    // 2. Emphasize Hemoglobin weight -> cand-hb ranks #1
    const hbPriorityRes = await request(app)
      .post('/api/patient-similarity/evaluate-direct')
      .send({
        queryPatient,
        referenceCohort: [bpMatchedCandidate, hbMatchedCandidate, rangeAnchor],
        options: {
          extractorProvider: 'fake',
          featureWeights: { bp_systolic: 0.2, bp_diastolic: 0.2, hemoglobin: 8.0 },
        },
      });
    expect(hbPriorityRes.status).toBe(200);
    expect(hbPriorityRes.body.topMatches[0].episodeId).toBe('cand-hb');
  });

  it('prevents sparse historical records from outranking rich clinical matches via Bayesian coverage shrinkage', async () => {
    const query = await extractPatientProfile(
      SAMPLE_DEMO_QUERIES.elevatedBpAndHeadacheScenario.queryPatient,
      { provider: 'fake' }
    );

    const richCandidate = await extractPatientProfile(
      {
        id: 'rich-case',
        gestationalWeeks: 28,
        gravida: 2,
        para: 1,
        blood_group: 'O+',
        vitals: { bp_systolic: 140, bp_diastolic: 90, weight_kg: 67, fundal_height_cm: 28 },
        previousVitals: { bp_systolic: 124, bp_diastolic: 78 },
        labs: { hemoglobin: 11.0, urine_albumin: '1+', creatinine: 0.72 },
        transcriptSegments: [
          { segment_id: 's1', speaker: 'patient', text: 'I have a moderate headache and mild ankle swelling, but no blurred vision and no epigastric pain.' },
        ],
      },
      { provider: 'fake' }
    );

    const sparseCandidate = await extractPatientProfile(
      {
        id: 'sparse-case',
        gestationalWeeks: 28,
        blood_group: 'O+',
        vitals: {},
        labs: {},
        transcriptSegments: [],
      },
      { provider: 'fake' }
    );

    const model = fitPatientCohortModel([richCandidate, sparseCandidate]);
    const result = rankCohortMatches(model, query, { topK: 2 });

    expect(result.topMatches[0].episodeId).toBe('rich-case');
    expect(result.topMatches[1].episodeId).toBe('sparse-case');
    expect(result.topMatches[0].similarityScore).toBeGreaterThan(result.topMatches[1].similarityScore + 0.25);

    const uncheckedKeys = result.uncheckedFactorsInQuery.map((u) => u.featureKey);
    expect(uncheckedKeys).toEqual(expect.arrayContaining(['urine_albumin', 'creatinine']));
  });

  it('adapts UCI Maternal Health Risk rows (mmol/L -> mg/dL, stripping RiskLevel) and MTS-Dialog transcripts', async () => {
    const adaptedUci = adaptUciMaternalRow(
      { Age: '29', SystolicBP: '140', DiastolicBP: '90', BS: '6.8', BodyTemp: '98.0', HeartRate: '78', RiskLevel: 'high risk' },
      0
    );
    expect(adaptedUci.age).toBe(29);
    expect(adaptedUci.vitals.bp_systolic).toBe(140);
    expect(adaptedUci.labs.fasting_glucose).toBe(123); // 6.8 * 18.018 = 122.5 -> 123 mg/dL
    expect(adaptedUci).not.toHaveProperty('RiskLevel');
    expect(JSON.stringify(adaptedUci)).not.toContain('high risk');

    const segments = adaptDialogueTextToSegments(
      'Doctor: Any blurred vision?\\nPatient: No blurred vision at all, only a moderate headache.',
      'test_mts'
    );
    expect(segments).toHaveLength(2);
    expect(segments[0]).toEqual({ segment_id: 'test_mts_seg_1', speaker: 'doctor', text: 'Any blurred vision?' });
    expect(segments[1]).toEqual({
      segment_id: 'test_mts_seg_2',
      speaker: 'patient',
      text: 'No blurred vision at all, only a moderate headache.',
    });

    const adaptRes = await request(app)
      .post('/api/patient-similarity/adapt-public')
      .send({
        queryPatient: SAMPLE_DEMO_QUERIES.elevatedBpAndHeadacheScenario.queryPatient,
        options: { topK: 2, extractorProvider: 'fake' },
      });
    expect(adaptRes.status).toBe(200);
    expect(adaptRes.body.adaptedCount).toBe(5);
    expect(adaptRes.body.evaluation.topMatches[0].episodeId).toBe('uci-mat-0001');
  });

  it('generates deterministic Synthea-style longitudinal cohorts and passes the quantitative benchmark', async () => {
    const cohortA = generateSyntheticMaternalCohort(30, { seed: 99 });
    const cohortB = generateSyntheticMaternalCohort(30, { seed: 99 });
    expect(cohortA).toEqual(cohortB);
    expect(cohortA).toHaveLength(30);

    const benchRes = await request(app)
      .post('/api/patient-similarity/benchmark')
      .send({ cohortSize: 50, seed: 20261103 });

    expect(benchRes.status).toBe(200);
    expect(benchRes.body.metrics.top3ArchetypeHitRate).toBeGreaterThanOrEqual(0.95);
    expect(benchRes.body.metrics.sparseRecordTop3ContaminationRate).toBe(0);
    expect(benchRes.body.metrics.transcriptNegationAccuracy).toBe(1);
  });

  it('serves GET /api/patient-similarity/synthetic-cohort and POST /api/patient-similarity/evaluate-direct without leaking PHI in logs', async () => {
    const infoSpy = jest.spyOn(logger, 'info');

    const catalogRes = await request(app).get('/api/patient-similarity/synthetic-cohort?includeGenerated=true&count=15');
    expect(catalogRes.status).toBe(200);
    expect(catalogRes.body.syntheticReferenceCohortCount).toBeGreaterThanOrEqual(10);
    expect(catalogRes.body.generatedCohortPreviewCount).toBe(15);

    const evalRes = await request(app)
      .post('/api/patient-similarity/evaluate-direct')
      .send({
        queryPatient: SAMPLE_DEMO_QUERIES.elevatedBpAndHeadacheScenario.queryPatient,
        options: { topK: 4, extractorProvider: 'fake', cohortSource: 'hybrid', generatedCount: 40 },
      });

    expect(evalRes.status).toBe(200);
    expect(evalRes.body.topMatches).toHaveLength(4);
    expect(evalRes.body.topMatches[0].archetype).toBe('elevated_bp_edema');

    // Verify privacy: no transcript phrases or lab numbers logged in logger.info calls
    const loggedStrings = JSON.stringify(infoSpy.mock.calls);
    expect(loggedStrings).not.toContain('forehead');
    expect(loggedStrings).not.toContain('swollen');
    infoSpy.mockRestore();
  });
});
