process.env.ASSISTANT_ENABLED = 'true';
process.env.ASSISTANT_RATE_LIMIT_PER_MINUTE = '3';

const express = require('express');
const request = require('supertest');
const app = require('../app');
const supabaseAdmin = require('../config/supabaseAdminClient');
const logger = require('../utils/logger');
const { mockTables, profileRow } = require('./helpers/supabaseMock');
const FakeProvider = require('../services/assistant/llm/fakeProvider');
const assistant = require('../services/assistant/assistant.service');
const config = require('../config/assistant.config');

jest.mock('../config/supabaseAdminClient', () => ({ auth: { getUser: jest.fn() }, from: jest.fn() }));

const mockProvider = { current: null };
jest.mock('../services/assistant/llm/providerFactory', () => ({ getProvider: () => mockProvider.current }));
jest.mock('../services/patientDirectory.service', () => ({ listClinicianPatients: jest.fn() }));
const { listClinicianPatients } = require('../services/patientDirectory.service');

const planReply = (steps) =>
  JSON.stringify({ action: 'run', steps: steps.map((s) => ({ do: 'open_page', page: 'none', patient: '', which: 'none', ...s })), options: [], more: false });

let userCount = 0;
function as(role, { verified = true } = {}) {
  userCount += 1;
  supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: { id: `user-${userCount}`, email: 'test@example.com' } }, error: null });
  mockTables(supabaseAdmin, { profiles: profileRow(role, { verified }) });
}
const send = (message) => request(app).post('/api/assistant/step').set('Authorization', 'Bearer t').send({ message, currentPath: '/' });

beforeEach(() => {
  jest.clearAllMocks();
  assistant.resetForTests();
  mockProvider.current = new FakeProvider(JSON.stringify({ action: 'unsupported', steps: [], options: [], more: false }));
});

describe('POST /api/assistant/step', () => {
  it('opens a page for a patient', async () => {
    as('patient');
    const res = await send('open my reports');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ type: 'navigate', path: '/reports', label: 'Lab reports', source: 'rules' });
  });

  it('opens a page for a verified doctor', async () => {
    as('clinician');
    const res = await send("show today's schedule");
    expect(res.body).toMatchObject({ type: 'navigate', path: '/clinician/schedule' });
  });

  it("does not open a doctor page for a patient, even if the model picks one", async () => {
    as('patient');
    mockProvider.current = new FakeProvider(planReply([{ page: 'schedule' }]));
    const res = await send('open schedule');
    expect(res.body.type).toBe('unsupported');
  });

  it('does not open a patient-only page for a doctor', async () => {
    as('clinician');
    mockProvider.current = new FakeProvider(planReply([{ page: 'reports' }]));
    const res = await send('where are the uploads');
    expect(res.body.type).toBe('unsupported');
  });

  it("opens a patient's record for a doctor, looking only at that doctor's patients", async () => {
    as('clinician');
    listClinicianPatients.mockResolvedValue([{ id: 'p-asha', fullName: 'Asha Example', email: 'asha@example.test', nextVisit: null, lastVisit: null }]);
    mockProvider.current = new FakeProvider(planReply([{ do: 'open_maternity_card', patient: 'Asha' }]));
    const res = await send("open Asha's maternity card");
    expect(res.body).toEqual({
      type: 'run', source: 'model',
      steps: [{ path: '/clinician/maternity?patientId=p-asha', label: 'Maternity card · Asha Example' }],
    });
    expect(listClinicianPatients).toHaveBeenCalledWith(`user-${userCount}`);
  });

  it('never runs doctor record actions for a patient', async () => {
    as('patient');
    mockProvider.current = new FakeProvider(planReply([{ do: 'open_maternity_card', patient: 'Asha' }]));
    const res = await send("open Asha's maternity card");
    expect(res.body.type).toBe('unsupported');
    expect(listClinicianPatients).not.toHaveBeenCalled();
  });

  it('refuses an unverified doctor', async () => {
    as('clinician', { verified: false });
    expect((await send('open schedule')).status).toBe(403);
  });

  it('requires login', async () => {
    const res = await request(app).post('/api/assistant/step').send({ message: 'open reports' });
    expect(res.status).toBe(401);
  });

  it.each([
    ['an empty message', ''],
    ['an over-long message', 'x'.repeat(config.maxMessageChars + 1)],
  ])('rejects %s', async (_label, message) => {
    as('patient');
    expect((await send(message)).status).toBe(400);
  });

  it('reports unavailable when the model is down, and the request still succeeds', async () => {
    as('patient');
    const { ProviderError } = require('../services/assistant/llm/provider.interface');
    mockProvider.current = new FakeProvider(new ProviderError('NETWORK'));
    const res = await send('something unclear');
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ type: 'unavailable', message: expect.any(String) });
    expect(res.body.errorCode).toBeUndefined();
  });

  it('limits requests per user', async () => {
    as('patient');
    const statuses = [];
    for (let i = 0; i < 4; i += 1) statuses.push((await send('open my reports')).status);
    expect(statuses).toEqual([200, 200, 200, 429]);
  });

  it('never logs the typed message', async () => {
    as('patient');
    const info = jest.spyOn(logger, 'info');
    const warn = jest.spyOn(logger, 'warn');
    await send('open my reports for Priya Example');
    await send('my unique secret phrase xyzzy');
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).toContain('assistant step');
    expect(logged).not.toMatch(/Priya|xyzzy|secret phrase/);
  });

  it('never logs the page it was sent, and rejects oversized pages', async () => {
    as('clinician');
    listClinicianPatients.mockResolvedValue([]);
    const info = jest.spyOn(logger, 'info');
    const page = { title: 'Visit of Zed Unique', elements: [{ ref: 'r1', kind: 'button', name: 'Notes about Zed Unique' }] };
    const res = await request(app).post('/api/assistant/step').set('Authorization', 'Bearer t').send({ message: 'open something unclear', currentPath: '/clinician', page });
    expect(res.status).toBe(200);
    expect(JSON.stringify(info.mock.calls)).not.toMatch(/Zed Unique/);
    const huge = { elements: Array.from({ length: 500 }, (_, i) => ({ ref: `r${i}`, kind: 'button', name: 'x' })) };
    as('clinician');
    expect((await request(app).post('/api/assistant/step').set('Authorization', 'Bearer t').send({ message: 'x', page: huge })).status).toBe(400);
  });

  it('never logs session memory', async () => {
    as('clinician');
    listClinicianPatients.mockResolvedValue([]);
    const info = jest.spyOn(logger, 'info');
    const warn = jest.spyOn(logger, 'warn');
    const memory = [
      {
        message: 'write confidential memory phrase qwertz',
        patient: { id: 'p-secret', name: 'Secret Patient Name' },
        record: { kind: 'visit', id: 'v-secret' },
        page: 'clinician',
        checklist: [{ text: 'Secret checklist item', done: true }],
      },
    ];
    const res = await request(app)
      .post('/api/assistant/step')
      .set('Authorization', 'Bearer t')
      .send({ message: 'open schedule', currentPath: '/clinician', memory });
    expect(res.status).toBe(200);
    const logged = JSON.stringify([...info.mock.calls, ...warn.mock.calls]);
    expect(logged).toContain('assistant step');
    expect(logged).not.toMatch(/qwertz|Secret Patient|v-secret|Secret checklist/);
  });
});

describe('POST /api/assistant/event', () => {
  const report = (body) => request(app).post('/api/assistant/event').set('Authorization', 'Bearer t').send(body);

  it('logs a confirmed send with ids and outcome only', async () => {
    as('clinician');
    const info = jest.spyOn(logger, 'info');
    const res = await report({ page: 'new_appointment', button: 'create_visit', outcome: 'confirmed' });
    expect(res.status).toBe(204);
    const [, fields] = info.mock.calls.find(([message]) => message === 'assistant action');
    expect(fields).toMatchObject({ userId: `user-${userCount}`, role: 'clinician', page: 'new_appointment', button: 'create_visit', effect: 'send', outcome: 'confirmed' });
    expect(Object.keys(fields).sort()).toEqual(['button', 'effect', 'errorCode', 'outcome', 'page', 'reqId', 'role', 'scope', 'userId']);
  });

  it('logs a confirmed action on a button read from the page, for doctors only', async () => {
    as('clinician');
    expect((await report({ page: 'dashboard', button: 'page_action', outcome: 'done' })).status).toBe(204);
    as('patient');
    expect((await report({ page: 'reports', button: 'page_action', outcome: 'done' })).status).toBe(400);
  });

  it.each([
    ['an unknown button', 'clinician', { page: 'new_appointment', button: 'delete_everything', outcome: 'done' }],
    ['a button that only changes the screen', 'clinician', { page: 'new_appointment', button: 'add_question', outcome: 'done' }],
    ['a doctor button reported by a patient', 'patient', { page: 'new_appointment', button: 'create_visit', outcome: 'done' }],
    ['an unknown outcome', 'clinician', { page: 'new_appointment', button: 'create_visit', outcome: 'maybe' }],
    ['free text in the error code', 'clinician', { page: 'new_appointment', button: 'create_visit', outcome: 'failed', errorCode: 'Asha has no email' }],
  ])('rejects %s', async (_label, role, body) => {
    as(role);
    expect((await report(body)).status).toBe(400);
  });
});

describe('POST /api/assistant/warm', () => {
  it('starts loading the model and answers at once', async () => {
    as('patient');
    mockProvider.current.warmUp = jest.fn().mockResolvedValue();
    const res = await request(app).post('/api/assistant/warm').set('Authorization', 'Bearer t');
    expect(res.status).toBe(202);
    expect(mockProvider.current.warmUp).toHaveBeenCalled();
  });
});

describe('when the assistant is turned off', () => {
  it('answers 404 without checking login or contacting a model', async () => {
    let router;
    jest.isolateModules(() => {
      process.env.ASSISTANT_ENABLED = 'false';
      router = require('../routes/assistant.routes');
      process.env.ASSISTANT_ENABLED = 'true';
    });
    const offApp = express().use(express.json()).use('/api/assistant', router);
    const res = await request(offApp).post('/api/assistant/step').send({ message: 'open reports' });
    expect(res.status).toBe(404);
    expect(supabaseAdmin.auth.getUser).not.toHaveBeenCalled();
  });
});
