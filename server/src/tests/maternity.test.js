const request = require('supertest');

/**
 * An in-memory stand-in for the supabase-js query builder, just enough of it
 * for the maternity card: insert / update / upsert / delete / select with
 * eq, in, is, not(is null), match, order, limit, single and maybeSingle.
 * Embedded selects are ignored: nested rows are stored on the parent row.
 */
const mockDb = {};
let mockSeq = 0;

function mockRun(table, ops) {
  const rows = mockDb[table] || (mockDb[table] = []);
  let mode = 'select';
  let payload;
  let options;
  let single = null;
  let order;
  let limit;
  let returning = false;
  const filters = [];

  for (const [op, args] of ops) {
    if (op === 'insert' || op === 'update' || op === 'upsert') [mode, payload, options] = [op, args[0], args[1]];
    else if (op === 'delete') mode = 'delete';
    else if (op === 'select') returning = mode !== 'select';
    else if (op === 'eq') filters.push((row) => row[args[0]] === args[1]);
    else if (op === 'in') filters.push((row) => args[1].includes(row[args[0]]));
    else if (op === 'is') filters.push((row) => (row[args[0]] ?? null) === args[1]);
    else if (op === 'not') filters.push((row) => row[args[0]] != null); // only not(col, 'is', null) is used
    else if (op === 'match') for (const [k, v] of Object.entries(args[0])) filters.push((row) => row[k] === v);
    else if (op === 'order') order = args;
    else if (op === 'limit') limit = args[0];
    else if (op === 'single' || op === 'maybeSingle') single = op;
  }

  const newRow = (values) => ({
    id: `00000000-0000-4000-8000-${String(++mockSeq).padStart(12, '0')}`,
    created_at: new Date().toISOString(),
    ...(table === 'pregnancy_episodes' && { status: 'ongoing' }),
    ...values,
  });

  let out;
  if (mode === 'insert') {
    out = [].concat(payload).map(newRow);
    rows.push(...out);
  } else if (mode === 'upsert') {
    const keys = options.onConflict.split(',');
    out = [];
    for (const values of [].concat(payload)) {
      const hit = rows.find((row) => keys.every((k) => row[k] === values[k]));
      if (hit && !options.ignoreDuplicates) Object.assign(hit, values);
      if (!hit) rows.push(newRow(values));
      out.push(hit || rows[rows.length - 1]);
    }
  } else {
    out = rows.filter((row) => filters.every((fn) => fn(row)));
    if (mode === 'update') out.forEach((row) => Object.assign(row, payload));
    if (mode === 'delete') out.forEach((row) => rows.splice(rows.indexOf(row), 1));
    if (order) {
      const [column, { ascending = true } = {}] = order;
      out = [...out].sort((a, b) => String(a[column]).localeCompare(String(b[column])) * (ascending ? 1 : -1));
    }
    if (limit) out = out.slice(0, limit);
  }

  if (single === 'single') return out.length ? { data: out[0], error: null } : { data: null, error: { message: 'no rows' } };
  if (single === 'maybeSingle') return { data: out[0] ?? null, error: null };
  return { data: mode === 'select' || returning ? out : null, error: null };
}

jest.mock('../config/supabaseAdminClient', () => ({
  // The bearer token is the user id, so each request picks its caller.
  auth: { getUser: jest.fn(async (token) => ({ data: { user: { id: token } }, error: null })) },
  from: jest.fn((table) => {
    const ops = [];
    const builder = new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') return (resolve, reject) => Promise.resolve(mockRun(table, ops)).then(resolve, reject);
          return (...args) => {
            ops.push([prop, args]);
            return builder;
          };
        },
      }
    );
    return builder;
  }),
}));

const app = require('../app');

const DOCTOR = '11111111-1111-4111-8111-111111111111';
const OTHER_DOCTOR = '22222222-2222-4222-8222-222222222222';
const PATIENT = '33333333-3333-4333-8333-333333333333';

const api = (method, path, caller = DOCTOR) =>
  request(app)[method](`/api/maternity${path}`).set('Authorization', `Bearer ${caller}`);

beforeEach(() => {
  for (const table of Object.keys(mockDb)) delete mockDb[table];
  Object.assign(mockDb, {
    profiles: [
      { id: DOCTOR, role: 'clinician', full_name: 'Dr A', clinician_details: { is_verified: true } },
      { id: OTHER_DOCTOR, role: 'clinician', full_name: 'Dr B', clinician_details: { is_verified: true } },
      { id: PATIENT, role: 'patient', full_name: 'Priya Sharma', phone: '9999999999' },
    ],
    patient_details: [{ profile_id: PATIENT, date_of_birth: '1998-01-15' }],
    appointments: [{ id: 'appt-1', clinician_id: DOCTOR, patient_id: PATIENT }],
  });
});

describe('Maternity card API', () => {
  it('returns an empty card, filled from the patient account, before anything is saved', async () => {
    const res = await api('get', `/${PATIENT}`);

    expect(res.status).toBe(200);
    expect(res.body.episodeId).toBeNull();
    expect(res.body.patient).toMatchObject({ name: 'Priya Sharma', id: PATIENT, phone: '9999999999' });
    expect(Number(res.body.patient.age)).toBeGreaterThanOrEqual(27);
    expect(res.body.visits).toEqual([]);
  });

  it('refuses a clinician who does not treat the patient, patients, and malformed ids', async () => {
    expect((await api('get', `/${PATIENT}`, OTHER_DOCTOR)).status).toBe(403);
    expect((await api('get', `/${PATIENT}`, PATIENT)).status).toBe(403);
    expect((await api('get', '/not-a-uuid')).status).toBe(400);
  });

  it('saves patient details and baseline, and reads them back in card form', async () => {
    const saved = await api('put', `/${PATIENT}`).send({
      lmp: '2026-04-10',
      edd: '2027-01-15',
      gravida: '2',
      para: '1',
      blood: 'B−',
      hb: '10.2',
      resultsDate: '2026-05-01',
      history: 'No known allergies',
    });
    expect(saved.status).toBe(200);
    expect(mockDb.pregnancy_episodes[0].blood_group).toBe('B-');

    const card = (await api('get', `/${PATIENT}`)).body;
    expect(card.episodeId).toBe(saved.body.episodeId);
    expect(card.patient).toMatchObject({ lmp: '2026-04-10', gravida: '2', history: 'No known allergies' });
    expect(card.investigations).toMatchObject({ blood: 'B−', hb: '10.2', resultsDate: '2026-05-01' });

    // Clearing a baseline value removes its row.
    await api('put', `/${PATIENT}`).send({ hb: '' });
    expect(mockDb.pregnancy_investigations.filter((row) => row.is_baseline)).toHaveLength(0);
  });

  it('rejects invalid values', async () => {
    expect((await api('put', `/${PATIENT}`).send({ gravida: 'two' })).status).toBe(400);
    expect((await api('post', `/${PATIENT}/visits`).send({ weight: '60' })).status).toBe(400);
    expect((await api('post', `/${PATIENT}/visits`).send({ date: '2026-08-20', next: '2026-08-01' })).status).toBe(400);
    expect((await api('put', `/${PATIENT}/delivery`).send({ apgar1: '11' })).status).toBe(400);
    expect((await api('post', `/${PATIENT}/unknown`).send({})).status).toBe(404);
  });

  it('adds, edits and deletes dated entries in every section', async () => {
    const visit = await api('post', `/${PATIENT}/visits`).send({ date: '2026-08-20', weight: '61.5', systolic: '142' });
    expect(visit.status).toBe(201);
    expect(visit.body).toMatchObject({ date: '2026-08-20', weight: '61.5', systolic: '142' });

    const lab = await api('post', `/${PATIENT}/labs`).send({ date: '2026-08-18', test: 'TSH', result: '2.1', unit: 'mIU/L' });
    expect(lab.status).toBe(201);
    expect(mockDb.pregnancy_investigations.find((row) => row.id === lab.body.id).result_value).toBe(2.1);

    expect((await api('post', `/${PATIENT}/scans`).send({ date: '2026-06-05', weeks: '8', report: 'Single live fetus' })).status).toBe(201);
    expect((await api('post', `/${PATIENT}/vaccines`).send({ name: 'Td', date: '2026-07-01', next: '2026-08-01' })).status).toBe(201);

    const edited = await api('patch', `/${PATIENT}/visits/${visit.body.id}`).send({ date: '2026-08-20', weight: '62' });
    expect(edited.status).toBe(200);
    expect(edited.body.weight).toBe('62');

    const card = (await api('get', `/${PATIENT}`)).body;
    expect(card.visits).toHaveLength(1);
    expect(card.labs).toHaveLength(1);
    expect(card.scans[0].weeks).toBe('8');
    expect(card.vaccines[0].next).toBe('2026-08-01');

    expect((await api('delete', `/${PATIENT}/visits/${visit.body.id}`)).status).toBe(204);
    expect((await api('delete', `/${PATIENT}/visits/${visit.body.id}`)).status).toBe(404);
  });

  it("does not let another clinician change this clinician's entries", async () => {
    const visit = await api('post', `/${PATIENT}/visits`).send({ date: '2026-08-20' });
    const res = await api('patch', `/${PATIENT}/visits/${visit.body.id}`, OTHER_DOCTOR).send({ date: '2026-08-21' });

    expect(res.status).toBe(403);
    expect(mockDb.antenatal_visits[0].visit_date).toBe('2026-08-20');
  });

  it('keeps one delivery record per pregnancy', async () => {
    await api('put', `/${PATIENT}/delivery`).send({ type: 'Vaginal', when: '2027-01-14T10:30', apgar1: '8', apgar5: '9' });
    const res = await api('put', `/${PATIENT}/delivery`).send({ type: 'Caesarean' });

    expect(res.status).toBe(200);
    expect(mockDb.pregnancy_deliveries).toHaveLength(1);
    const card = (await api('get', `/${PATIENT}`)).body;
    expect(card.delivery).toMatchObject({ type: 'Caesarean', when: '2027-01-14T10:30', apgar1: '8', apgar5: '9' });
  });
});

describe('Maternity card: values from lab reports', () => {
  const metric = (standardKey, extra = {}) => ({
    standard_key: standardKey,
    raw_key: standardKey,
    raw_value: '',
    parsed_value: null,
    reviewed_value: null,
    reviewed_by: null,
    unit_raw: null,
    unit_standard: null,
    needs_review: false,
    metric_dictionary: { display_name: standardKey },
    ...extra,
  });

  const report = (id, reportDate, metrics, uploadedAt = '2026-10-01T09:00:00Z') => ({
    id,
    patient_id: PATIENT,
    report_date: reportDate,
    uploaded_at: uploadedAt,
    lab_report_metrics: metrics,
  });

  const share = (...reportIds) => {
    mockDb.appointment_lab_reports = reportIds.map((id) => ({ appointment_id: 'appt-1', lab_report_id: id }));
  };

  const labs = async () => (await api('get', `/${PATIENT}`)).body;

  beforeEach(async () => {
    mockDb.lab_reports = [
      report('r-june', '2026-06-10', [
        metric('hemoglobin', { parsed_value: 10.4, unit_standard: 'g/dL', metric_dictionary: { display_name: 'Hemoglobin' } }),
        metric('tsh', { parsed_value: 9.9, needs_review: true }), // still in triage
        metric('mcv', { parsed_value: 88 }), // not a pregnancy test
        metric('urine_protein', { raw_value: 'Trace' }), // a word result
      ]),
      report('r-before', '2025-12-01', [metric('hemoglobin', { parsed_value: 12 })]), // before this pregnancy
      report('r-unshared', '2026-07-01', [metric('hemoglobin', { parsed_value: 9 })]),
      // No date printed; uploaded 02:00 IST on 3 July (20:30 UTC on 2 July).
      report('r-undated', null, [metric('blood_glucose_fasting', { parsed_value: 92, unit_standard: 'mg/dL' })], '2026-07-02T20:30:00Z'),
      report('r-future', '2099-01-01', [metric('hemoglobin', { parsed_value: 11 })]), // a misread year
    ];
    share('r-june', 'r-before', 'r-undated', 'r-future');
  });

  it('waits for an LMP or EDD before importing anything', async () => {
    await api('put', `/${PATIENT}`).send({ gravida: '1' });
    const card = await labs();

    expect(card.labImport).toEqual({ status: 'needs_dates', added: 0 });
    expect(card.labs).toEqual([]);
  });

  it('adds confirmed pregnancy values from shared reports, dated by the report', async () => {
    await api('put', `/${PATIENT}`).send({ lmp: '2026-04-10' });
    const card = await labs();

    expect(card.labImport).toEqual({ status: 'imported', added: 3 });
    expect(card.labs).toEqual([
      expect.objectContaining({ test: 'Hemoglobin', result: '10.4', unit: 'g/dL', date: '2026-06-10', fromReport: true, notes: 'From lab report' }),
      expect.objectContaining({ test: 'urine_protein', result: 'Trace', date: '2026-06-10', fromReport: true }),
      expect.objectContaining({
        test: 'blood_glucose_fasting',
        result: '92',
        date: '2026-07-03',
        notes: 'From lab report · no date printed, upload date used',
      }),
    ]);
  });

  it('never adds a value twice, and a new report adds new rows without touching the old ones', async () => {
    await api('put', `/${PATIENT}`).send({ lmp: '2026-04-10' });
    const first = await labs();
    const june = first.labs.find((row) => row.date === '2026-06-10' && row.test === 'Hemoglobin');

    // The clinician corrects the imported value by hand.
    await api('patch', `/${PATIENT}/labs/${june.id}`).send({ date: '2026-06-10', test: 'Hemoglobin', result: '10.5', unit: 'g/dL' });
    expect((await labs()).labImport.added).toBe(0);

    mockDb.lab_reports.push(report('r-august', '2026-08-15', [metric('hemoglobin', { parsed_value: 9.8, unit_standard: 'g/dL' })]));
    share('r-june', 'r-undated', 'r-august');
    const card = await labs();

    expect(card.labImport.added).toBe(1);
    const hb = card.labs.filter((row) => row.test === 'Hemoglobin' || row.test === 'hemoglobin');
    expect(hb.map((row) => [row.date, row.result])).toEqual([
      ['2026-06-10', '10.5'],
      ['2026-08-15', '9.8'],
    ]);
  });

  it('adds a value once the clinician confirms it in triage, using the confirmed reading', async () => {
    await api('put', `/${PATIENT}`).send({ lmp: '2026-04-10' });
    await labs();

    Object.assign(mockDb.lab_reports[0].lab_report_metrics[1], { needs_review: false, reviewed_by: DOCTOR, reviewed_value: 2.4 });
    const card = await labs();

    expect(card.labImport.added).toBe(1);
    expect(card.labs).toContainEqual(expect.objectContaining({ test: 'tsh', result: '2.4', date: '2026-06-10' }));
  });

  it('hides a removed imported value for good, but deletes hand-entered ones', async () => {
    await api('put', `/${PATIENT}`).send({ lmp: '2026-04-10' });
    const imported = (await labs()).labs[0];
    const typed = (await api('post', `/${PATIENT}/labs`).send({ date: '2026-09-01', test: 'OGTT', result: '130' })).body;

    expect((await api('delete', `/${PATIENT}/labs/${imported.id}`)).status).toBe(204);
    expect((await api('delete', `/${PATIENT}/labs/${typed.id}`)).status).toBe(204);

    const card = await labs();
    expect(card.labImport.added).toBe(0);
    expect(card.labs.map((row) => row.id)).not.toContain(imported.id);
    expect(mockDb.pregnancy_investigations.find((row) => row.id === imported.id).dismissed_at).toBeTruthy();
    expect(mockDb.pregnancy_investigations.find((row) => row.id === typed.id)).toBeUndefined();
  });

  it('stops at six weeks after delivery', async () => {
    await api('put', `/${PATIENT}`).send({ lmp: '2026-04-10' });
    await api('put', `/${PATIENT}/delivery`).send({ when: '2026-06-20T10:00' });
    const card = await labs();

    // June (before delivery) and 3 July (within six weeks) count; nothing later would.
    expect(card.labs.map((row) => row.date)).toEqual(['2026-06-10', '2026-06-10', '2026-07-03']);

    mockDb.lab_reports.push(report('r-late', '2026-09-01', [metric('hemoglobin', { parsed_value: 12 })]));
    share('r-june', 'r-undated', 'r-late');
    expect((await labs()).labImport.added).toBe(0);
  });

  it('import-reports pulls in new values and returns the investigations list', async () => {
    await api('put', `/${PATIENT}`).send({ lmp: '2026-04-10' });
    const res = await api('post', `/${PATIENT}/import-reports`);

    expect(res.status).toBe(200);
    expect(res.body.labImport).toEqual({ status: 'imported', added: 3 });
    expect(res.body.labs).toHaveLength(3);
    expect((await api('post', `/${PATIENT}/import-reports`, OTHER_DOCTOR)).status).toBe(403);
  });
});
