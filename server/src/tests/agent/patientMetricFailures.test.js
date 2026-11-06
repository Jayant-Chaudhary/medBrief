const assistant = require('../../services/assistant/assistant.service');
const { queryPatientMetric } = require('../../services/assistant/patientQuery.service');
const { metricFixture } = require('./helpers/metricFixture');
const config = require('../../config/assistant.config');
const tables = { pregnancy_episodes: [{ id: 'synthetic-episode' }] };

test.each(['pregnancy_episodes', 'antenatal_visits', 'pregnancy_investigations', 'lab_report_metrics', 'vitals_logs'])(
  'a %s query error is not reported as missing data', async table => {
    const error = { message: 'Synthetic sensitive detail must not escape', code: 'DB_ERROR' };
    await expect(queryPatientMetric('synthetic-doctor', 'synthetic-p', 'ferritin', {
      supabaseClient: metricFixture(tables, { [table]: error }), reportIdsFn: async () => ['synthetic-report'],
    })).rejects.toMatchObject({ code: 'PATIENT_METRIC_LOOKUP_FAILED', message: 'Patient record lookup failed' });
  }
);

test('a report-sharing failure cannot become an empty result', async () => {
  await expect(queryPatientMetric('synthetic-doctor', 'synthetic-p', 'ferritin', {
    supabaseClient: metricFixture(), reportIdsFn: async () => { throw new Error('Synthetic sensitive detail'); },
  })).rejects.toHaveProperty('code', 'PATIENT_METRIC_LOOKUP_FAILED');
});

test('a partial reading cannot be claimed as latest when a different source failed', async () => {
  await expect(queryPatientMetric('synthetic-doctor', 'synthetic-p', 'weight', {
    supabaseClient: metricFixture({ ...tables, antenatal_visits: [{ weight_kg: 62, visit_date: '2026-11-04' }] },
      { vitals_logs: { code: 'UNAVAILABLE' } }), reportIdsFn: async () => [],
  })).rejects.toHaveProperty('code', 'PATIENT_METRIC_LOOKUP_FAILED');
});

const base = { message: 'What is Asha Example\'s ferritin?', role: 'clinician', userId: 'synthetic-doctor',
  currentPath: '/clinician', directory: async () => [{ id: 'synthetic-p', fullName: 'Asha Example' }],
  provider: { complete: jest.fn(() => { throw new Error('Unexpected provider call'); }) }, settings: config };

test('lookup failures return unavailable with an error code and no sensitive error text', async () => {
  const reply = await assistant.handleStep({ ...base, metricLookup: async () => { throw new Error('Synthetic sensitive detail'); } });
  expect(reply.type).toBe('unavailable');
  expect(reply.errorCode).toBe('PATIENT_QUERY_FAILED');
  expect(JSON.stringify(reply)).not.toContain('Synthetic sensitive detail');
  expect(reply.message).not.toContain('No recorded');
});

test('a genuinely empty successful lookup still answers no recorded result', async () => {
  expect(await queryPatientMetric('synthetic-doctor', 'synthetic-p', 'ferritin', {
    supabaseClient: metricFixture(), reportIdsFn: async () => [],
  })).toBeNull();
  const reply = await assistant.handleStep({ ...base, metricLookup: async () => null });
  expect(reply.type).toBe('answer');
  expect(reply.text).toContain('No recorded Ferritin');
});

test('a hung lookup is bounded rather than leaving the request pending', async () => {
  const reply = await assistant.handleStep({ ...base, settings: { ...config, modelCallTimeoutMs: 20 },
    metricLookup: () => new Promise(() => {}) });
  expect(reply.type).toBe('unavailable');
  expect(reply.errorCode).toBe('PATIENT_QUERY_TIMEOUT');
});
