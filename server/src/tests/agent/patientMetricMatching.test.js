const { matchesMetricName, queryPatientMetric } = require('../../services/assistant/patientQuery.service');
const { metricFixture } = require('./helpers/metricFixture');

test.each([
  ['hemoglobin', 'Hb', 'haemoglobin'], ['blood_glucose_fasting', '', 'fasting blood glucose'],
  ['blood_glucose_random', '', 'rbs'], ['platelets', 'Platelet Count', 'platelet count'],
  [null, 'Serum Ferritin', 'ferritin'], ['vitamin_b12', '', 'vit b12'],
])('matches only a whole canonical identity or explicit equivalent: %s', (key, label, term) => {
  expect(matchesMetricName(key, label, term)).toBe(true);
});

test.each([
  ['iron_binding_capacity', 'Total Iron Binding Capacity', 'iron'],
  ['calcium_ionized', 'Ionized calcium', 'calcium'],
  ['blood_glucose_random', 'Random Blood Glucose', 'fasting blood glucose'],
  ['glucose', 'Glucose', 'fasting blood glucose'],
  ['blood_pressure_systolic', 'Blood pressure systolic', 'blood pressure'],
  ['blood_pressure_diastolic', 'Blood pressure diastolic', 'systolic'],
  ['bilirubin_direct', 'Direct bilirubin', 'bilirubin_total'],
  ['iron_binding_capacity', 'Iron', 'iron'],
])('never matches a different metric through a substring or conflicting label: %s', (key, label, term) => {
  expect(matchesMetricName(key, label, term)).toBe(false);
});

test('a different earlier test cannot displace the requested lab result', async () => {
  const client = metricFixture({ lab_report_metrics: [
    { standard_key: 'iron_binding_capacity', parsed_value: 300, created_at: '2026-11-05', lab_reports: { id: 'synthetic-r1', report_date: '2026-11-05' } },
    { standard_key: 'iron', parsed_value: 60, created_at: '2026-11-04', lab_reports: { id: 'synthetic-r2', report_date: '2026-11-04' } },
  ] });
  const result = await queryPatientMetric('synthetic-doctor', 'synthetic-p', 'iron', {
    supabaseClient: client, reportIdsFn: async () => ['synthetic-r1', 'synthetic-r2'],
  });
  expect(result.name).toBe('iron');
  expect(result.value).toBe(60);
});
