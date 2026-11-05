const { queryPatientMetric, formatMetricAnswer } = require('../../services/assistant/patientQuery.service');
const { metricFixture } = require('./helpers/metricFixture');
const read = (tables, term = 'ferritin') => queryPatientMetric('synthetic-doctor', 'synthetic-p', term, {
  supabaseClient: metricFixture(tables), reportIdsFn: async () => ['synthetic-old', 'synthetic-new'],
});
const lab = (value, date, upload) => ({ standard_key: 'ferritin', parsed_value: value,
  created_at: upload, lab_reports: { id: `synthetic-${value}`, report_date: date, uploaded_at: upload } });

test('uploading an old report today cannot displace a newer measurement', async () => {
  const result = await read({ lab_report_metrics: [lab(20, '2026-10-01', '2026-11-05T10:00:00Z'), lab(30, '2026-11-04', '2026-11-04T10:00:00Z')] });
  expect(result.value).toBe(30);
  expect(result.date).toBe('2026-11-04');
});

test('an undated investigation cannot hide the most recent dated investigation', async () => {
  const result = await read({ pregnancy_episodes: [{ id: 'synthetic-episode' }], pregnancy_investigations: [
    { investigation_key: 'ferritin', result_value: 20, performed_on: null },
    { investigation_key: 'ferritin', result_value: 30, performed_on: '2026-11-04' },
  ] });
  expect(result.value).toBe(30);
  expect(result.hasUndatedResults).toBe(true);
});

test('vital readings retain their timestamp so same-day readings are ordered correctly', async () => {
  const result = await read({ vitals_logs: [
    { metric_key: 'weight', value: 62, recorded_at: '2026-11-04T02:00:00Z' },
    { metric_key: 'weight', value: 63, recorded_at: '2026-11-04T18:00:00Z' },
  ] }, 'weight');
  expect(result.value).toBe(63);
  expect(result.date).toBe('2026-11-04T18:00:00Z');
});

test('undated uploads do not become dated readings or support an unqualified latest claim', async () => {
  const result = await read({ lab_report_metrics: [lab(20, null, '2026-11-05T10:00:00Z'), lab(30, '2026-11-04', '2026-11-04T10:00:00Z')] });
  expect(result.value).toBe(30);
  const answer = formatMetricAnswer('Synthetic Patient', 'ferritin', result, 'synthetic-p');
  expect(answer.text).toContain('latest dated');
  expect(answer.text).toContain('no measurement date');
  const undated = await read({ lab_report_metrics: [lab(20, null, '2026-11-05T10:00:00Z')] });
  expect(undated.date).toBeNull();
  const unknown = formatMetricAnswer('Synthetic Patient', 'ferritin', undated, 'synthetic-p');
  expect(unknown.text).toContain('Measurement date unavailable');
  expect(unknown.text).not.toContain('latest');
});

test('comparison spans visits, investigations and reports instead of picking a source first', async () => {
  const result = await read({ pregnancy_episodes: [{ id: 'synthetic-episode' }],
    antenatal_visits: [{ hemoglobin_g_dl: 10, visit_date: '2026-11-02' }],
    pregnancy_investigations: [{ investigation_key: 'hb', result_value: 11, performed_on: '2026-11-04' }],
    lab_report_metrics: [{ ...lab(12, '2026-11-01', '2026-11-05T10:00:00Z'), standard_key: 'hemoglobin' }],
  }, 'haemoglobin');
  expect(result.value).toBe(11);
  expect(result.sourceType).toBe('maternity');
});

test('date-only measurements keep their calendar date in a different time zone', () => {
  const answer = formatMetricAnswer('Synthetic Patient', 'ferritin', { name: 'Ferritin', value: 30,
    date: '2026-11-04', sourceType: 'lab_report' }, 'synthetic-p', { timeZone: 'America/Los_Angeles' });
  expect(answer.text).toContain('4 Nov 2026');
});

const homeBp = (systolic, diastolic, at, gapMs = 60) => [
  ...(systolic == null ? [] : [{ metric_key: 'blood_pressure_systolic', value: systolic, recorded_at: at }]),
  ...(diastolic == null ? [] : [{ metric_key: 'blood_pressure_diastolic', value: diastolic,
    recorded_at: new Date(Date.parse(at) + gapMs).toISOString() }]),
];

test('a BP question reads home readings, saved as separate systolic and diastolic rows', async () => {
  const result = await read({ vitals_logs: homeBp(150, 100, '2026-11-05T08:00:00.000Z') }, 'blood pressure');
  expect(result).toMatchObject({ name: 'Blood Pressure', value: '150/100', unit: 'mmHg', source: 'Vitals Log' });
});

test('a newer home BP reading is not hidden behind an older clinic reading', async () => {
  const result = await read({ pregnancy_episodes: [{ id: 'synthetic-episode' }],
    antenatal_visits: [{ visit_date: '2026-09-01', bp_systolic: 110, bp_diastolic: 70 }],
    vitals_logs: homeBp(150, 100, '2026-11-05T08:00:00.000Z') }, 'blood pressure');
  expect(result.value).toBe('150/100');
  expect(result.source).toBe('Vitals Log');
});

test('a newer clinic BP reading still wins over an older home reading', async () => {
  const result = await read({ pregnancy_episodes: [{ id: 'synthetic-episode' }],
    antenatal_visits: [{ visit_date: '2026-11-06', bp_systolic: 118, bp_diastolic: 76 }],
    vitals_logs: homeBp(150, 100, '2026-11-05T08:00:00.000Z') }, 'blood pressure');
  expect(result.value).toBe('118/76');
});

test('home BP pairs only the newest reading, never sides from different readings', async () => {
  const vitals = [...homeBp(150, null, '2026-11-05T08:00:00.000Z'), ...homeBp(120, 80, '2026-11-01T08:00:00.000Z')];
  const result = await read({ vitals_logs: vitals }, 'blood pressure');
  expect(result.value).toBe('150/—');
  expect(result.date).toBe('2026-11-05T08:00:00.000Z');
});

test('home BP sides further apart than the pairing window are not combined', async () => {
  const result = await read({ vitals_logs: homeBp(150, 100, '2026-11-05T08:00:00.000Z', 60 * 60 * 1000) }, 'blood pressure');
  expect(result.value).toBe('—/100');
});
