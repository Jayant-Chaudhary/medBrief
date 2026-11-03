const fs = require('fs');
const path = require('path');
const assistant = require('../../services/assistant/assistant.service');
const FakeProvider = require('../../services/assistant/llm/fakeProvider');
const { ProviderError } = require('../../services/assistant/llm/provider.interface');
const { PAGES, pagesFor } = require('../../services/assistant/pages.registry');
const { matchIntent } = require('../../services/assistant/intentRules');
const { createRateLimiter } = require('../../services/assistant/rateLimit');
const { resolvePatient, describePatient } = require('../../services/assistant/resolvers/patients');

const settings = {
  timeoutMs: 1000,
  coldStartTimeoutMs: 9000,
  warmWindowMs: 60000,
  maxSteps: 4,
  unavailableMessage: 'unavailable text',
};

// Model replies in the plan format.
const stepOf = (fields) => ({ do: 'open_page', page: 'none', patient: '', which: 'none', ...fields });
const plan = (steps, more = false) => JSON.stringify({ action: 'run', steps: steps.map(stepOf), options: [], more });
const open = (page, more = false) => plan([{ page }], more);
const reply = (value) => JSON.stringify({ steps: [], options: [], more: false, ...value });

// Synthetic patients only.
const PATIENTS = [
  { id: 'p-asha', fullName: 'Asha Example', email: 'asha@example.test', phone: '9000001234', nextVisit: { appointmentId: 'a-next', scheduledAt: '2026-12-01T10:00:00Z' }, lastVisit: { appointmentId: 'a-last', scheduledAt: '2026-10-01T10:00:00Z' } },
  { id: 'p-bina1', fullName: 'Bina Sample', email: 'bina1@example.test', phone: null, nextVisit: null, lastVisit: { appointmentId: 'b1-last', scheduledAt: '2026-09-01T10:00:00Z' } },
  { id: 'p-bina2', fullName: 'Bina Other', email: 'bina2@example.test', phone: '9000005678', nextVisit: { appointmentId: 'b2-next', scheduledAt: '2026-12-05T10:00:00Z' }, lastVisit: null },
];
const directory = jest.fn(async () => PATIENTS);

const step = (message, provider, role = 'patient', now = () => 1_000_000) =>
  assistant.handleStep({ message, role, userId: 'dr-1', provider, directory, settings, now });

beforeEach(() => {
  assistant.resetForTests();
  directory.mockClear();
});

describe('page registry', () => {
  it.each(Object.keys(PAGES))('has unique ids and aliases for %s', (role) => {
    const pages = pagesFor(role);
    expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
    const aliases = pages.flatMap((p) => p.aliases.map((a) => a.toLowerCase()));
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it('only lists routes that exist in the website', () => {
    const routes = fs.readFileSync(path.join(__dirname, '../../../../client/src/routes/AppRoutes.jsx'), 'utf8');
    for (const page of Object.values(PAGES).flat()) {
      expect(routes).toContain(`path="${page.path}"`);
    }
  });

  it('never offers community, login or placeholder pages', () => {
    const paths = Object.values(PAGES).flat().map((p) => p.path);
    expect(paths.some((p) => /community|login|signup|onboarding|lab-inbox|analytics/.test(p))).toBe(false);
  });
});

describe('phrase rules', () => {
  const patient = pagesFor('patient');
  const doctor = pagesFor('clinician');

  it.each([
    ['open my reports', 'reports'],
    ['Show my lab reports please', 'reports'],
    ['mere reports dikhao', 'reports'],
    ['मेरी रिपोर्ट दिखाओ', 'reports'],
    ['take me to my profile', 'profile'],
    ['go to check-in', 'checkin'],
    ['parchi dikhao', 'summary'],
  ])('patient: "%s" opens %s', (text, id) => {
    expect(matchIntent(text, patient)).toEqual({ kind: 'open', pageIds: [id] });
  });

  it.each([
    ["show today's schedule", 'schedule'],
    ['new appointment', 'new_appointment'],
    ['open maternity card', 'maternity'],
    ['check my checklists', 'checklists'],
    ['close it and open the dashboard', 'dashboard'],
    ['click the menu button then dashboard', 'dashboard'],
    ['go back to the schedule', 'schedule'],
  ])('doctor: "%s" opens %s', (text, id) => {
    expect(matchIntent(text, doctor)).toEqual({ kind: 'open', pageIds: [id] });
  });

  it('asks when two pages are named', () => {
    expect(matchIntent('reports or summary', patient)).toEqual({ kind: 'clarify', pageIds: ['reports', 'summary'] });
  });

  it.each([
    'is my report normal?',
    'I have pain at home',
    'can I eat papaya',
    'delete my reports',
    'share my report with the doctor',
    'show my appointments',
    "open Asha's maternity card",
    '',
  ])('leaves "%s" for the model', (text) => {
    expect(matchIntent(text, text.includes('Asha') ? doctor : patient)).toBeNull();
  });

  it('does not open doctor pages from patient words', () => {
    expect(matchIntent('open schedule', patient)).toBeNull();
  });
});

describe('patient resolver', () => {
  it.each([
    ['Asha Example', 'p-asha'],
    ['asha', 'p-asha'],
    ['Mrs. Asha Example', 'p-asha'],
    ['Example Asha', 'p-asha'],
    ['Bina Sample', 'p-bina1'],
  ])('finds "%s"', (name, id) => {
    expect(resolvePatient(name, PATIENTS)).toEqual({ status: 'one', patient: expect.objectContaining({ id }) });
  });

  it('returns every match when a name is shared, never guessing', () => {
    expect(resolvePatient('Bina', PATIENTS)).toEqual({ status: 'many', matches: [PATIENTS[1], PATIENTS[2]] });
  });

  it.each(['Someone Else', '', '12', 'x'])('finds nobody for "%s"', (name) => {
    expect(resolvePatient(name, PATIENTS)).toEqual({ status: 'none' });
  });

  it('describes a patient without full contact details', () => {
    const text = describePatient(PATIENTS[0]);
    expect(text).toContain('a***@example.test');
    expect(text).toContain('…1234');
    expect(text).not.toContain('asha@example.test');
    expect(text).not.toContain('9000001234');
  });
});

describe('handleStep: pages', () => {
  it('answers plain requests from the rules without calling the model', async () => {
    const provider = new FakeProvider(new Error('should not be called'));
    await expect(step('open my reports', provider)).resolves.toMatchObject({ type: 'navigate', path: '/reports', source: 'rules' });
    expect(provider.calls).toHaveLength(0);
  });

  it('maps a valid model choice to the registered route', async () => {
    await expect(step('where did the doctor write my medicines', new FakeProvider(open('summary')))).resolves.toMatchObject({
      type: 'navigate', path: '/summary', label: 'Visit summary', source: 'model', attempts: 1,
    });
  });

  it("constrains the model to this role's actions and page ids", async () => {
    const provider = new FakeProvider(reply({ action: 'unsupported' }));
    await step('something unusual', provider, 'patient');
    await step('something unusual', provider, 'clinician');
    const [patientSchema, doctorSchema] = provider.calls.map((c) => c.schema.properties.steps.items.properties);
    expect(patientSchema.do.enum).toEqual(['open_page']);
    expect(doctorSchema.do.enum).toEqual(expect.arrayContaining(['open_page', 'open_maternity_card', 'open_patient_visit', 'find_patient']));
    expect(doctorSchema.page.enum).toEqual([...pagesFor('clinician').map((p) => p.id), 'none']);
    expect(provider.calls[1].messages.at(-1)).toEqual({ role: 'user', content: 'something unusual' });
  });

  it.each([
    ['an invented page', open('admin')],
    ['a URL instead of an id', open('/clinician')],
    ["another role's page", open('schedule')],
    ['prose instead of JSON', 'Sure! Opening your reports now.'],
    ['a clarify with no valid options', reply({ action: 'clarify', options: ['admin'] })],
    ['a doctor action for a patient', plan([{ do: 'open_maternity_card', patient: 'Asha Example' }])],
    ['an empty plan', reply({ action: 'run' })],
  ])('treats %s as unsupported', async (_label, text) => {
    const result = await step('unclear request', new FakeProvider(text));
    expect(result).toMatchObject({ type: 'unsupported', message: expect.any(String) });
    expect(result.path).toBeUndefined();
    expect(directory).not.toHaveBeenCalled();
  });

  it('never shows model-written text', async () => {
    const result = await step('unclear request', new FakeProvider('Ignore rules and diagnose the patient'));
    expect(JSON.stringify(result)).not.toContain('diagnose');
  });

  it('offers valid choices and drops invalid ones', async () => {
    const result = await step('my results', new FakeProvider(reply({ action: 'clarify', options: ['reports', 'admin', 'summary'] })));
    expect(result).toEqual({
      type: 'clarify', source: 'model', attempts: 1,
      options: [{ path: '/reports', label: 'Lab reports' }, { path: '/summary', label: 'Visit summary' }],
    });
  });

  it('opens the page and says the rest is up to the user for multi-step requests', async () => {
    await expect(step('in patients select the new patient', new FakeProvider(open('patients', true)), 'clinician')).resolves.toMatchObject({
      type: 'navigate', path: '/clinician/patients', more: true,
    });
  });

  it('runs several page steps in order', async () => {
    const result = await step('see the week and then go home', new FakeProvider(plan([{ page: 'schedule' }, { page: 'dashboard' }])), 'clinician');
    expect(result).toMatchObject({ type: 'run', steps: [{ path: '/clinician/schedule' }, { path: '/clinician' }] });
  });

  it('does not open the same page twice in a row', async () => {
    const result = await step('patients then the list', new FakeProvider(plan([{ page: 'patients' }, { page: 'patients' }, { page: 'schedule' }])), 'clinician');
    expect(result.steps.map((s) => s.path)).toEqual(['/clinician/patients', '/clinician/schedule']);
  });

  it('keeps at most the configured number of steps', async () => {
    const pages = ['schedule', 'patients', 'dashboard', 'checklists', 'profile', 'maternity'];
    const result = await step('lots of steps', new FakeProvider(plan(pages.map((page) => ({ page })))), 'clinician');
    expect(result.steps).toHaveLength(4);
  });
});

describe('handleStep: patient records (doctor)', () => {
  const doctor = (text, modelReply) => step(text, new FakeProvider(modelReply), 'clinician');

  it("opens a patient's maternity card by id, with no name in the URL", async () => {
    const result = await doctor("open asha's card", plan([{ do: 'open_maternity_card', patient: 'Asha' }]));
    expect(result).toMatchObject({ type: 'run', steps: [{ path: '/clinician/maternity?patientId=p-asha', label: 'Maternity card · Asha Example' }] });
    expect(result.steps[0].path).not.toMatch(/Asha Example|asha@|9000001234/);
    expect(directory).toHaveBeenCalledWith('dr-1');
  });

  it("opens a patient's next or last visit", async () => {
    const next = await doctor('next visit asha', plan([{ do: 'open_patient_visit', patient: 'Asha', which: 'next' }]));
    const last = await doctor('last visit asha', plan([{ do: 'open_patient_visit', patient: 'Asha', which: 'last' }]));
    expect(next.steps[0].path).toBe('/clinician?appointment=a-next');
    expect(last.steps[0].path).toBe('/clinician?appointment=a-last');
  });

  it('says so when the patient has no such visit', async () => {
    const result = await doctor('next visit bina sample', plan([{ do: 'open_patient_visit', patient: 'Bina Sample', which: 'next' }]));
    expect(result).toMatchObject({ type: 'unsupported', message: 'Bina Sample has no upcoming visit with you.' });
  });

  it('opens New appointment with the patient preselected', async () => {
    const result = await doctor('book asha', plan([{ do: 'open_new_appointment', patient: 'Asha Example' }]));
    expect(result.steps[0].path).toBe('/clinician/appointments/new?patient=p-asha');
  });

  it('runs a page step and a record step together', async () => {
    const result = await doctor('schedule then asha next visit', plan([{ page: 'schedule' }, { do: 'open_patient_visit', patient: 'Asha', which: 'next' }]));
    expect(result.steps.map((s) => s.path)).toEqual(['/clinician/schedule', '/clinician?appointment=a-next']);
  });

  it('asks which patient when a name matches several, with a ready plan for each', async () => {
    const result = await doctor("bina's card", plan([{ do: 'open_maternity_card', patient: 'Bina' }]));
    expect(result.type).toBe('choose');
    expect(result.options.map((o) => [o.label, o.steps[0].path])).toEqual([
      ['Bina Sample', '/clinician/maternity?patientId=p-bina1'],
      ['Bina Other', '/clinician/maternity?patientId=p-bina2'],
    ]);
    expect(result.options[0].detail).toContain('b***@example.test');
  });

  it("does not guess when nobody matches", async () => {
    const result = await doctor("someone's card", plan([{ do: 'open_maternity_card', patient: 'Someone Else' }]));
    expect(result).toEqual(expect.objectContaining({ type: 'unsupported', message: assistant.NOT_FOUND }));
  });

  it('refuses two different patients in one request', async () => {
    const result = await doctor('asha and bina', plan([{ do: 'open_maternity_card', patient: 'Asha' }, { do: 'open_maternity_card', patient: 'Bina Sample' }]));
    expect(result).toEqual(expect.objectContaining({ type: 'unsupported', message: assistant.ONE_PATIENT }));
    expect(directory).not.toHaveBeenCalled();
  });

  it('fills the Patients search through navigation state, not the URL', async () => {
    const result = await doctor('find asha', plan([{ do: 'find_patient', patient: 'Asha' }]));
    expect(result.steps[0]).toEqual({ path: '/clinician/patients', label: 'Patients', state: { assistantQuery: 'Asha' } });
  });

  it.each([
    ['open_maternity_card', '/clinician/maternity'],
    ['open_patient_visit', '/clinician/patients'],
    ['open_new_appointment', '/clinician/appointments/new'],
    ['find_patient', '/clinician/patients'],
  ])('opens the plain page when %s names no patient, without looking anyone up', async (action, pagePath) => {
    const result = await doctor('open the record', plan([{ do: action, patient: '  ' }]));
    expect(result).toMatchObject({ type: 'navigate', path: pagePath });
    expect(directory).not.toHaveBeenCalled();
  });
});

describe('date and time checks', () => {
  const { checkWhen, inWords, safeTimeZone, nowInWords } = require('../../services/assistant/resolvers/datetime');
  // 3 Nov 2026, 14:10 in India.
  const now = new Date(Date.UTC(2026, 10, 3, 8, 40));
  const clock = { now, timeZone: 'Asia/Kolkata', maxDays: 365 };

  it('accepts a future time and says it in words', () => {
    expect(checkWhen('2026-11-04T10:00', clock)).toEqual({ status: 'ok', value: '2026-11-04T10:00', words: 'Wed 4 Nov 2026, 10:00' });
  });

  it.each([
    ['a past time today', '2026-11-03T09:00'],
    ['the current minute', '2026-11-03T14:10'],
    ['an impossible day', '2026-02-31T10:00'],
    ['an impossible hour', '2026-11-04T25:00'],
    ['more than a year ahead', '2027-12-01T10:00'],
    ['another format', '04/11/2026 10am'],
  ])('rejects %s', (_label, value) => {
    expect(checkWhen(value, clock)).toEqual({ status: 'invalid' });
  });

  it('treats no time as empty, not invalid', () => {
    expect(checkWhen('', clock)).toEqual({ status: 'empty' });
    expect(checkWhen('  ', clock)).toEqual({ status: 'empty' });
  });

  it("judges 'future' by the user's own clock", () => {
    const lateEvening = new Date(Date.UTC(2026, 10, 3, 20, 0)); // 4 Nov 01:30 in India, 3 Nov 15:00 in New York
    expect(checkWhen('2026-11-03T23:00', { ...clock, now: lateEvening }).status).toBe('invalid');
    expect(checkWhen('2026-11-03T23:00', { ...clock, now: lateEvening, timeZone: 'America/New_York' }).status).toBe('ok');
  });

  it('falls back when the browser sends an unknown time zone', () => {
    expect(safeTimeZone('Not/A_Zone', 'Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(safeTimeZone('Europe/London', 'Asia/Kolkata')).toBe('Europe/London');
  });

  it('formats words for the model and the panel', () => {
    expect(inWords('2026-12-01T09:05')).toBe('Tue 1 Dec 2026, 09:05');
    expect(nowInWords(now, 'Asia/Kolkata')).toBe('Tue 3 Nov 2026, 14:10 (Asia/Kolkata)');
  });
});

describe('handleStep: filling the new appointment form (doctor)', () => {
  const now = () => Date.UTC(2026, 10, 3, 8, 40);
  const fillSettings = { ...settings, maxBookingDays: 365, defaultTimeZone: 'Asia/Kolkata' };
  const book = (modelReply, timeZone = 'Asia/Kolkata') =>
    assistant.handleStep({ message: 'book asha at 10 am', role: 'clinician', userId: 'dr-1', timeZone, provider: new FakeProvider(modelReply), directory, settings: fillSettings, now });

  it('opens the form with the patient chosen and the time filled, without booking', async () => {
    const result = await book(plan([{ do: 'open_new_appointment', patient: 'Asha', when: '2026-11-04T10:00' }]));
    expect(result.steps).toEqual([{
      path: '/clinician/appointments/new?patient=p-asha',
      label: 'New appointment · Asha Example · Wed 4 Nov 2026, 10:00',
      fill: { page: 'new_appointment', fields: { scheduledAt: '2026-11-04T10:00' }, words: 'Wed 4 Nov 2026, 10:00', context: { patientId: 'p-asha' } },
    }]);
  });

  it('ignores a time the model invented when the message gives none, and asks for one', async () => {
    const { ASK_TIME } = require('../../services/assistant/actions.catalog');
    const result = await assistant.handleStep({
      message: 'book Asha Example tomorrow', role: 'clinician', userId: 'dr-1', timeZone: 'Asia/Kolkata', directory, settings: fillSettings, now,
      provider: new FakeProvider(plan([{ do: 'open_new_appointment', patient: 'Asha', when: '2026-11-04T00:00' }])),
    });
    expect(result.steps[0].fill).toBeUndefined();
    expect(result.steps[0].notice).toBe(ASK_TIME);
  });

  it.each(['kal subah 10 baje', 'tomorrow at 10 am', 'kal दस बजे', 'tomorrow at noon'])('uses a time when the message mentions one: "%s"', async (words) => {
    const result = await assistant.handleStep({
      message: `book asha ${words}`, role: 'clinician', userId: 'dr-1', timeZone: 'Asia/Kolkata', directory, settings: fillSettings, now,
      provider: new FakeProvider(plan([{ do: 'open_new_appointment', patient: 'Asha', when: '2026-11-04T10:00' }])),
    });
    expect(result.steps[0].fill.fields.scheduledAt).toBe('2026-11-04T10:00');
  });

  it('opens the form without a time when none was given', async () => {
    const result = await book(plan([{ do: 'open_new_appointment', patient: 'Asha' }]));
    expect(result.steps[0]).toEqual({ path: '/clinician/appointments/new?patient=p-asha', label: 'New appointment · Asha Example' });
  });

  it('does not fill a time it cannot use, and says so', async () => {
    const { BAD_TIME } = require('../../services/assistant/actions.catalog');
    const result = await book(plan([{ do: 'open_new_appointment', patient: 'Asha', when: '2026-11-02T10:00' }]));
    expect(result.steps[0]).toEqual({ path: '/clinician/appointments/new?patient=p-asha', label: 'New appointment · Asha Example', notice: BAD_TIME });
  });

  it("tells the model today's date in the doctor's time zone, and only for doctors", async () => {
    const provider = new FakeProvider(reply({ action: 'unsupported' }));
    await assistant.handleStep({ message: 'x unclear', role: 'clinician', userId: 'dr-1', timeZone: 'Asia/Kolkata', provider, directory, settings: fillSettings, now });
    await assistant.handleStep({ message: 'x unclear', role: 'patient', userId: 'pt-1', timeZone: 'Asia/Kolkata', provider, directory, settings: fillSettings, now });
    expect(provider.calls[0].messages[0].content).toContain('Now is Tue 3 Nov 2026, 14:10 (Asia/Kolkata)');
    expect(provider.calls[1].messages[0].content).not.toContain('Now is');
    expect(provider.calls[0].schema.properties.steps.items.required).toContain('when');
  });
});

describe('form value checks', () => {
  const { checkValue, REASONS } = require('../../services/assistant/resolvers/values');
  const clock = { now: new Date(Date.UTC(2026, 10, 3, 8, 40)), timeZone: 'Asia/Kolkata', maxDays: 365 };
  // Synthetic clinical controls shaped like the maternity card's (Phase 3b).
  const hb = { id: 'hb', label: 'Hb', kind: 'number', clinical: true, aliases: ['hb', 'haemoglobin', 'hemoglobin'] };
  const blood = {
    id: 'blood', label: 'Blood group', kind: 'select', clinical: true, aliases: ['blood group', 'blood'],
    options: [{ value: 'O−', label: 'O−', synonyms: ['o negative', 'o neg', 'o-'] }, { value: 'O+', label: 'O+', synonyms: ['o positive', 'o pos'] }],
  };
  const lmp = { id: 'lmp', label: 'LMP', kind: 'date', clinical: true, aliases: ['lmp', 'last period'] };
  const note = { id: 'note', label: 'Question', kind: 'text' };
  const ok = (value) => expect.objectContaining({ ok: true, value });
  const no = (reason) => ({ ok: false, reason: REASONS[reason] });

  it.each([
    ['a named number', hb, '10.5', 'hb 10.5', ok('10.5')],
    ['a number in an unnamed field', hb, '10.5', 'add 10.5', no('notNamed')],
    ['a field name inside another word', hb, '10.5', 'hbsag 10.5', no('notNamed')],
    ['a number that was not typed', hb, '11', 'hb 10.5', no('notInMessage')],
    ['a number in words', hb, 'ten', 'hb ten', no('badNumber')],
    ['a dropdown choice by synonym', blood, 'O negative', 'blood group o negative', ok('O−')],
    ['a dropdown choice that was not typed', blood, 'O+', 'blood group o negative', no('notInMessage')],
    ['a value that is not a choice', blood, 'AB+', 'blood ab+', no('badOption')],
    ['a date in words', lmp, '2026-03-12', 'lmp 12 march', ok('2026-03-12')],
    ['a date in numbers', lmp, '2026-03-12', 'lmp 12/3/2026', ok('2026-03-12')],
    ['today', lmp, '2026-11-03', 'lmp today', ok('2026-11-03')],
    ['a different day', lmp, '2026-03-13', 'lmp 12 march', no('notInMessage')],
    ['an impossible date', lmp, '2026-02-30', 'lmp 30 feb', no('badDate')],
    ['typed text', note, 'Any bleeding?', 'add question "any bleeding?"', ok('Any bleeding?')],
    ['made-up text', note, 'Any pain?', 'add question "any bleeding?"', no('notInMessage')],
  ])('%s', (_label, control, value, message, expected) => {
    expect(checkValue(control, value, message, clock)).toEqual(expected);
  });

  it('applies no clinical ranges: any typed, named number is kept', () => {
    expect(checkValue(hb, '45', 'hb 45', clock)).toEqual(ok('45'));
  });
});

describe('handleStep: forms (doctor)', () => {
  const now = () => Date.UTC(2026, 10, 3, 8, 40); // 14:10 in Asia/Kolkata
  const formSettings = { ...settings, maxBookingDays: 365, defaultTimeZone: 'Asia/Kolkata', actionsEnabled: true };
  const { ASK_TIME } = require('../../services/assistant/actions.catalog');
  const { REASONS } = require('../../services/assistant/resolvers/values');
  const FORM = '/clinician/appointments/new';
  const ask = (message, modelReply, { currentPath = FORM, role = 'clinician', change = {} } = {}) => {
    const provider = new FakeProvider(modelReply);
    return assistant
      .handleStep({ message, role, userId: 'dr-1', timeZone: 'Asia/Kolkata', currentPath, provider, directory, settings: { ...formSettings, ...change }, now })
      .then((result) => ({ ...result, provider }));
  };
  const fill = (fields, press = 'none') => ({ do: 'fill_form', page: 'new_appointment', fields, press });
  const at4pm = { control: 'scheduledAt', value: '2026-11-03T16:00' };
  const filled4pm = {
    page: 'new_appointment',
    fields: { scheduledAt: '2026-11-03T16:00' },
    filled: [{ id: 'scheduledAt', label: 'Date and time', value: 'Tue 3 Nov 2026, 16:00' }],
  };
  const createVisit = {
    page: 'new_appointment', id: 'create_visit', label: 'Create visit and invite', effect: 'send',
    sideEffect: 'Creates the visit and emails the patient an invite.',
  };

  it('fills the open form in place, with no navigation and no patient lookup', async () => {
    const result = await ask('ADD TODAYS DATE AND 4PM TIME', plan([fill([at4pm])]));
    expect(result.type).toBe('run');
    expect(result.steps).toEqual([{ label: 'New appointment', fill: filled4pm }]);
    expect(directory).not.toHaveBeenCalled();
  });

  it('opens the form first when another page is open', async () => {
    const result = await ask('new visit today at 4 pm', plan([fill([at4pm])]), { currentPath: '/clinician/schedule' });
    // After opening the plain form, the fill waits for a form with no patient chosen.
    expect(result.steps).toEqual([{ path: FORM, label: 'New appointment', fill: { ...filled4pm, context: { patientId: null } } }]);
  });

  it('fills the form opened by an earlier step in place', async () => {
    const result = await ask('book asha at 4 pm today and add question "any bleeding?"', plan([
      { do: 'open_new_appointment', patient: 'Asha', when: '2026-11-03T16:00' },
      fill([{ control: 'newQuestion', value: 'any bleeding?' }], 'add_question'),
    ]), { currentPath: '/clinician' });
    expect(result.steps[0].path).toBe('/clinician/appointments/new?patient=p-asha');
    expect(result.steps[1]).toEqual({
      label: 'New appointment',
      fill: {
        page: 'new_appointment', fields: { newQuestion: 'any bleeding?' },
        filled: [{ id: 'newQuestion', label: 'New pre-visit question', value: 'any bleeding?' }], context: { patientId: 'p-asha' },
      },
      press: { page: 'new_appointment', id: 'add_question', label: 'Add question', effect: 'ui', context: { patientId: 'p-asha' } },
    });
  });

  it('offers the form controls to doctors, says which form is open, and offers none to patients', async () => {
    const doctor = await ask('today at 4 pm', reply({ action: 'unsupported' }));
    const patient = await ask('today at 4 pm', reply({ action: 'unsupported' }), { role: 'patient', currentPath: '/' });
    const item = (r) => r.provider.calls[0].schema.properties.steps.items;
    expect(item(doctor).properties.fields.items.properties.control.enum).toEqual(expect.arrayContaining(['scheduledAt', 'patientEmail', 'newQuestionType']));
    expect(item(doctor).properties.press.enum).toEqual(['add_question', 'create_visit', 'none']);
    expect(doctor.provider.calls[0].messages[0].content).toContain('New appointment form is open now');
    expect(item(patient).properties.fields).toBeUndefined();
    expect(item(patient).properties.do.enum).not.toContain('fill_form');
  });

  it('never fills a form for a patient, even if the model plans it', async () => {
    const result = await ask('today at 4 pm', plan([fill([at4pm])]), { role: 'patient', currentPath: '/' });
    expect(result.type).toBe('unsupported');
  });

  it.each([
    ['open_new_appointment with no patient', { do: 'open_new_appointment', when: '2026-11-03T16:00' }],
    ['open_page new_appointment', { page: 'new_appointment', when: '2026-11-03T16:00' }],
  ])('treats %s on the open form as filling it', async (_, modelStep) => {
    const result = await ask('make it 4 pm today', plan([modelStep]));
    expect(result.steps).toEqual([{ label: 'New appointment', fill: filled4pm }]);
  });

  it('keeps only the fill when the model adds steps that would leave the form', async () => {
    const result = await ask('4 pm today', plan([{ page: 'schedule' }, fill([at4pm])]));
    expect(result.steps).toEqual([{ label: 'New appointment', fill: filled4pm }]);
  });

  it('asks for the time when only a day is given', async () => {
    expect(await ask('add todays date', plan([{ page: 'new_appointment' }]))).toMatchObject({ type: 'unsupported', message: ASK_TIME });
    const invented = await ask('add todays date', plan([fill([{ control: 'scheduledAt', value: '2026-11-03T00:00' }])]));
    expect(invented.steps).toEqual([{ label: 'New appointment', skipped: [{ label: 'Date and time', reason: REASONS.noTime }] }]);
  });

  it('skips a past time and says why', async () => {
    const result = await ask('today at 9 am', plan([fill([{ control: 'scheduledAt', value: '2026-11-03T09:00' }])]));
    expect(result.steps[0].skipped).toEqual([{ label: 'Date and time', reason: REASONS.notFuture }]);
  });

  it('copies values only from the message: made-up values are skipped and reported', async () => {
    const result = await ask('new patient Riya Test riya@example.test today at 4 pm', plan([fill([
      { control: 'patientFullName', value: 'Riya Test' },
      { control: 'patientEmail', value: 'riya@example.test' },
      at4pm,
      { control: 'newQuestion', value: 'Any bleeding?' },
    ])]));
    expect(result.steps[0].fill.fields).toEqual({ patientFullName: 'Riya Test', patientEmail: 'riya@example.test', scheduledAt: '2026-11-03T16:00' });
    expect(result.steps[0].skipped).toEqual([{ label: 'New pre-visit question', reason: REASONS.notInMessage }]);
  });

  it('picks a dropdown choice the user named, and not one they did not', async () => {
    const asked = (message) => ask(message, plan([fill([
      { control: 'newQuestion', value: 'any bleeding?' },
      { control: 'newQuestionType', value: 'Written answer' },
    ], 'add_question')]));
    expect((await asked('add question "any bleeding?" as a written answer')).steps[0].fill.fields)
      .toEqual({ newQuestion: 'any bleeding?', newQuestionType: 'text' });
    // An unmentioned, non-clinical choice is the model guessing: the field is left alone, without a note.
    const guessed = (await asked('add question "any bleeding?"')).steps[0];
    expect(guessed.fill.fields).toEqual({ newQuestion: 'any bleeding?' });
    expect(guessed.skipped).toBeUndefined();
  });

  it('takes the day from the user\'s words when the model gets it wrong', async () => {
    // 17:00 today is still in the future at 14:10, but "kal" means tomorrow.
    const result = await ask('kal shaam 5 baje', plan([fill([{ control: 'scheduledAt', value: '2026-11-03T17:00' }])]));
    expect(result.steps[0].fill.fields.scheduledAt).toBe('2026-11-04T17:00');
    const booked = await ask('asha ka appointment kal 5 baje', plan([{ do: 'open_new_appointment', patient: 'Asha', when: '2026-11-03T17:00' }]), { currentPath: '/clinician' });
    expect(booked.steps[0].fill.fields.scheduledAt).toBe('2026-11-04T17:00');
  });

  it('fills nothing when the day does not match and no day word settles it', async () => {
    const { WRONG_DAY } = require('../../services/assistant/actions.catalog');
    // 3 Nov 2026 is a Tuesday.
    const result = await ask('monday at 5 pm', plan([fill([{ control: 'scheduledAt', value: '2026-11-03T17:00' }])]));
    expect(result.steps[0].skipped).toEqual([{ label: 'Date and time', reason: REASONS.wrongDay }]);
    const booked = await ask('book asha monday at 5 pm', plan([{ do: 'open_new_appointment', patient: 'Asha', when: '2026-11-03T17:00' }]), { currentPath: '/clinician' });
    expect(booked.steps[0]).toEqual({ path: '/clinician/appointments/new?patient=p-asha', label: 'New appointment · Asha Example', notice: WRONG_DAY });
  });

  it.each([
    ['as a new patient on the form', fill([{ control: 'patientFullName', value: 'Asha Example' }, { control: 'scheduledAt', value: '2026-11-04T10:00' }], 'create_visit')],
    ['in the new-patient field of a booking', { do: 'open_new_appointment', when: '2026-11-04T10:00', fields: [{ control: 'patientFullName', value: 'Asha Example' }] }],
  ])('looks up a named patient with no email among the doctor\'s patients (%s)', async (_label, modelStep) => {
    const result = await ask('book Asha Example tomorrow at 10 am and send the invite', plan([modelStep]), { currentPath: '/clinician' });
    expect(result.steps[0]).toMatchObject({ path: '/clinician/appointments/new?patient=p-asha', fill: { fields: { scheduledAt: '2026-11-04T10:00' } } });
    expect(result.steps.flatMap((s) => Object.keys(s.fill?.fields || {}))).not.toContain('patientFullName');
  });

  it('keeps the time when the model splits a booking from the patient\'s name', async () => {
    // The model's actual reply for this message: time with no patient, then the name as a "new patient".
    const result = await ask('book Asha Example tomorrow at 10 am and send the invite', plan([
      { do: 'open_new_appointment', when: '2026-11-04T10:00' },
      fill([{ control: 'patientFullName', value: 'Asha Example' }, { control: 'patientEmail', value: 'Asha Example' }], 'create_visit'),
    ]), { currentPath: '/clinician' });
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0]).toMatchObject({ path: '/clinician/appointments/new?patient=p-asha', fill: { fields: { scheduledAt: '2026-11-04T10:00' } } });
    expect(result.steps[1].press).toMatchObject({ id: 'create_visit', context: { patientId: 'p-asha' } });
  });

  it('proposes a save or send only when the user asked for one', async () => {
    const result = await ask('book new patient Riya Test riya@example.test today at 4 pm', plan([fill([
      { control: 'patientFullName', value: 'Riya Test' }, { control: 'patientEmail', value: 'riya@example.test' }, at4pm,
    ], 'create_visit')]));
    expect(result.steps[0].press).toBeUndefined();
    expect(result.steps[0].fill.fields.scheduledAt).toBe('2026-11-03T16:00');
    expect(result.more).toBeUndefined();
  });

  it('proposes a saving button for the user to confirm, as the last step', async () => {
    const result = await ask('today at 4 pm and send the invite', plan([fill([at4pm], 'create_visit')]));
    expect(result.steps[0].press).toEqual(createVisit);
    expect(result.more).toBeUndefined();
  });

  it('refuses more than one save, or a save before the last step', async () => {
    const { ONE_SAVE } = assistant;
    const early = await ask('send invite at 4 pm today then add question "x"', plan([fill([at4pm], 'create_visit'), fill([], 'add_question')]));
    expect(early).toMatchObject({ type: 'unsupported', message: ONE_SAVE });
  });

  it('leaves saving buttons to the user when pressing is switched off', async () => {
    const result = await ask('today at 4 pm and send the invite', plan([fill([at4pm], 'create_visit')]), { change: { actionsEnabled: false } });
    expect(result.steps[0].press).toBeUndefined();
    expect(result.steps[0].fill.fields).toEqual({ scheduledAt: '2026-11-03T16:00' });
    expect(result.more).toBe(true);
  });

  it('still opens a fresh form when a patient is named', async () => {
    const result = await ask('book asha at 4 pm today', plan([{ do: 'open_new_appointment', patient: 'Asha', when: '2026-11-03T16:00' }]));
    expect(result.steps[0].path).toBe('/clinician/appointments/new?patient=p-asha');
    expect(result.steps[0].fill.fields.scheduledAt).toBe('2026-11-03T16:00');
  });
});

describe('handleStep: maternity card (doctor)', () => {
  const now = () => Date.UTC(2026, 10, 3, 8, 40); // Tue 3 Nov 2026, 14:10 in Asia/Kolkata
  const cardSettings = { ...settings, maxBookingDays: 365, defaultTimeZone: 'Asia/Kolkata', actionsEnabled: true };
  const { REASONS } = require('../../services/assistant/resolvers/values');
  const CARD = '/clinician/maternity';
  const ask = (message, modelReply, currentPath = CARD) => {
    const provider = new FakeProvider(modelReply);
    return assistant
      .handleStep({ message, role: 'clinician', userId: 'dr-1', timeZone: 'Asia/Kolkata', currentPath, provider, directory, settings: cardSettings, now })
      .then((result) => ({ ...result, provider }));
  };
  const card = (fields, press = 'none') => ({ do: 'fill_form', page: 'maternity', fields, press });
  const f = (control, value) => ({ control, value });
  const fieldsOf = (result) => Object.assign({}, ...result.steps.map((s) => s.fill?.fields || {}));

  it('offers the card\'s fields on the card or when the request is about it, and not otherwise', async () => {
    const enumOf = (r) => r.provider.calls[0].schema.properties.steps.items.properties.fields.items.properties.control.enum;
    expect(enumOf(await ask('something', reply({ action: 'unsupported' })))).toContain('visit.systolic');
    expect(enumOf(await ask('add bp 110/70 for asha', reply({ action: 'unsupported' }), '/clinician'))).toContain('visit.systolic');
    expect(enumOf(await ask('who are my patients this week', reply({ action: 'unsupported' }), '/clinician'))).not.toContain('visit.systolic');
  });

  it('takes BP from the user\'s "110/70" even if the model swaps the numbers, and proposes the save', async () => {
    const result = await ask('add visit today bp 110/70 weight 62 kg presentation cephalic and save', plan([card([
      f('visit.date', '2026-11-03'), f('visit.systolic', '70'), f('visit.diastolic', '110'), f('visit.weight', '62'), f('visit.presentation', 'cephalic'),
    ], 'save_visit')]));
    expect(result.steps[0].path).toBeUndefined();
    expect(fieldsOf(result)).toEqual({
      'visit.date': '2026-11-03', 'visit.systolic': '110', 'visit.diastolic': '70', 'visit.weight': '62', 'visit.presentation': 'Cephalic',
    });
    expect(result.steps[0].press).toMatchObject({ id: 'save_visit', effect: 'save', sideEffect: 'Adds this visit to the maternity card.' });
  });

  it('reads G/P/L/A from an obstetric formula, and refuses a number the formula does not give', async () => {
    const result = await ask('G2 P1 L1 A0', plan([card([
      f('patient.gravida', '2'), f('patient.para', '2'), f('patient.living', '1'), f('patient.abortions', '0'),
    ])]));
    expect(fieldsOf(result)).toEqual({ 'patient.gravida': '2', 'patient.living': '1', 'patient.abortions': '0' });
    expect(result.steps[0].skipped).toEqual([{ label: 'Para', reason: REASONS.notNamed }]);
  });

  it('needs a clinical field named, unless the choice names it ("breech", "O negative")', async () => {
    const named = await ask('urine albumin negative, breech, blood group o negative', plan([card([
      f('visit.albumin', 'Negative'), f('visit.presentation', 'Breech'), f('baseline.blood', 'O negative'),
    ])]));
    expect(fieldsOf(named)).toEqual({ 'visit.albumin': 'Negative', 'visit.presentation': 'Breech', 'baseline.blood': 'O−' });
    const unnamed = await ask('hiv negative', plan([card([f('visit.albumin', 'Negative'), f('baseline.results', 'hiv negative')])]));
    expect(fieldsOf(unnamed)).toEqual({ 'baseline.results': 'hiv negative' });
    expect(unnamed.steps[0].skipped).toEqual([{ label: 'Urine albumin', reason: REASONS.notNamed }]);
  });

  it('keeps a delivery time in the past', async () => {
    const result = await ask('delivered today at 9 pm, baby girl', plan([card([f('delivery.when', '2026-11-03T21:00'), f('delivery.sex', 'Female')])]));
    expect(fieldsOf(result)).toEqual({ 'delivery.sex': 'Female' });
    expect(result.steps[0].skipped).toEqual([{ label: 'Delivery date & time', reason: REASONS.notPast }]);
  });

  it('opens a named patient\'s card first, and ties the fill and save to that patient', async () => {
    const result = await ask('open asha\'s card and add hb 10.5 to the visit, then save', plan([
      { do: 'open_maternity_card', patient: 'Asha' },
      card([f('visit.hb', '10.5')], 'save_visit'),
    ]));
    expect(result.steps[0].path).toBe('/clinician/maternity?patientId=p-asha');
    expect(result.steps[1].path).toBeUndefined();
    expect(result.steps[1].fill.context).toEqual({ patientId: 'p-asha' });
    expect(result.steps[1].press.context).toEqual({ patientId: 'p-asha' });
  });

  it('never lets the model press the website\'s own record-save step', async () => {
    const result = await ask('hb 10.5 and save', plan([card([f('baseline.hb', '10.5')], 'save_details')]));
    expect(result.provider.calls[0].schema.properties.steps.items.properties.press.enum).not.toContain('save_details');
    expect(result.steps[0].press).toBeUndefined();
  });
});

describe('handleStep: requests to submit', () => {
  it.each(['create new visit for asha and start it', 'open new appointment and click create', 'asha ka visit bana ke bhej do'])(
    'says the last step is the user\'s: "%s"',
    async (message) => {
      const result = await step(message, new FakeProvider(plan([{ do: 'open_new_appointment', patient: 'Asha' }])), 'clinician');
      expect(result.more).toBe(true);
    }
  );

  it('flags phrase-rule matches too', async () => {
    const result = await step('open reports and click', new FakeProvider(open('home')));
    expect(result).toMatchObject({ type: 'navigate', source: 'rules', more: true });
  });

  it('does not flag plain requests', async () => {
    const result = await step('create new visit for asha', new FakeProvider(plan([{ do: 'open_new_appointment', patient: 'Asha' }])), 'clinician');
    expect(result.more).toBeUndefined();
  });
});

describe('handleStep: model failures', () => {
  it('retries once, then succeeds', async () => {
    const provider = new FakeProvider((_req, call) => (call === 1 ? new ProviderError('HTTP_500') : open('home')));
    await expect(step('main screen please', provider)).resolves.toMatchObject({ type: 'navigate', path: '/', attempts: 2 });
  });

  it.each(['TIMEOUT', 'NETWORK', 'HTTP_503'])('reports unavailable after two %s failures', async (code) => {
    const provider = new FakeProvider(new ProviderError(code));
    await expect(step('unclear request', provider)).resolves.toEqual({
      type: 'unavailable', message: 'unavailable text', source: 'model', attempts: 2, errorCode: code,
    });
    expect(provider.calls).toHaveLength(2);
  });

  it('gives a retry the long limit, since a failure often means the model is reloading', async () => {
    let time = 1_000_000;
    const provider = new FakeProvider((_req, call) => (call === 2 ? new ProviderError('TIMEOUT') : reply({ action: 'unsupported' })));
    await step('unclear one', provider, 'patient', () => time);
    time += 1000;
    await step('unclear two', provider, 'patient', () => time);
    expect(provider.calls.map((c) => c.timeoutMs)).toEqual([9000, 1000, 9000]);
  });

  it('allows a long first request while the model loads, then a short one', async () => {
    const provider = new FakeProvider(reply({ action: 'unsupported' }));
    await step('unclear one', provider);
    await step('unclear two', provider);
    expect(provider.calls.map((c) => c.timeoutMs)).toEqual([9000, 1000]);
  });

  it('refuses roles with no pages', async () => {
    await expect(step('open reports', new FakeProvider(), 'admin')).resolves.toMatchObject({ type: 'unsupported' });
  });
});

describe('Ollama provider requests', () => {
  const OllamaProvider = require('../../services/assistant/llm/ollamaProvider');
  const provider = new OllamaProvider({ baseUrl: 'http://ollama.test', model: 'm', keepAlive: '15m', numCtx: 2048, maxOutputTokens: 256 });
  let bodies;

  beforeEach(() => {
    bodies = [];
    global.fetch = jest.fn(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      return { ok: true, json: async () => ({ message: { content: '{}' } }) };
    });
  });
  afterEach(() => delete global.fetch);

  it('warms up with the same context size as real requests, so the model is not reloaded', async () => {
    await provider.warmUp(1000);
    await provider.complete({ messages: [], schema: {}, timeoutMs: 1000 });
    expect(bodies[0].options.num_ctx).toBe(2048);
    expect(bodies[1].options.num_ctx).toBe(2048);
  });

  it('caps the reply length', async () => {
    await provider.complete({ messages: [], schema: {}, timeoutMs: 1000 });
    expect(bodies[0].options.num_predict).toBe(256);
  });
});

describe('Gemini provider requests', () => {
  const GeminiProvider = require('../../services/assistant/llm/geminiProvider');
  const { toGeminiSchema } = GeminiProvider;
  let calls;

  beforeEach(() => {
    calls = [];
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url, headers: init.headers, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"action":"unsupported"}' }] } }] }) };
    });
  });
  afterEach(() => delete global.fetch);

  it('sends the key in a header, never in the URL, and the system prompt separately', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key-123', model: 'gemini-test' });
    const text = await provider.complete({ messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hi' }], schema: null, timeoutMs: 1000 });
    expect(text).toBe('{"action":"unsupported"}');
    expect(calls[0].url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    expect(calls[0].url).not.toContain('test-key-123');
    expect(calls[0].headers['x-goog-api-key']).toBe('test-key-123');
    expect(calls[0].body.systemInstruction.parts[0].text).toBe('rules');
    expect(calls[0].body.contents).toEqual([{ role: 'user', parts: [{ text: 'hi' }] }]);
  });

  it('converts our schema to the subset Gemini accepts', () => {
    const converted = toGeminiSchema({
      type: 'object',
      additionalProperties: false,
      properties: { steps: { type: 'array', maxItems: 4, items: { type: 'string', enum: ['a'], maxLength: 10 } } },
      required: ['steps'],
    });
    expect(converted).toEqual({
      type: 'OBJECT',
      properties: { steps: { type: 'ARRAY', items: { type: 'STRING', enum: ['a'] } } },
      required: ['steps'],
    });
  });

  it('skips thought parts and tries the fallback model once when the first is busy', async () => {
    let n = 0;
    global.fetch = jest.fn(async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      n += 1;
      if (n === 1) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ thought: true, text: 'thinking' }, { text: '{"action":' }, { text: '"run"}' }] } }] }) };
    });
    const provider = new GeminiProvider({ apiKey: 'test-key-123', model: 'main-model', fallbackModel: 'spare-model', thinkingLevel: 'low' });
    const text = await provider.complete({ messages: [{ role: 'user', content: 'hi' }], schema: null, timeoutMs: 1000 });
    expect(text).toBe('{"action":"run"}');
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['main-model:generateContent', 'spare-model:generateContent']);
    expect(calls[1].body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' });
  });

  it('does not retry a refused request on the fallback model', async () => {
    global.fetch = jest.fn(async () => ({ ok: false, status: 403, json: async () => ({}) }));
    const provider = new GeminiProvider({ apiKey: 'test-key-123', model: 'main-model', fallbackModel: 'spare-model' });
    await expect(provider.complete({ messages: [{ role: 'user', content: 'hi' }], schema: null, timeoutMs: 1000 })).rejects.toMatchObject({ code: 'HTTP_403' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a missing key as a configuration error', async () => {
    const saved = { g: process.env.GEMINI_API_KEY, l: process.env.LLM_API_KEY };
    delete process.env.GEMINI_API_KEY;
    delete process.env.LLM_API_KEY;
    await expect(new GeminiProvider({}).complete({ messages: [], timeoutMs: 1000 })).rejects.toMatchObject({ code: 'CONFIG_ERROR' });
    if (saved.g !== undefined) process.env.GEMINI_API_KEY = saved.g;
    if (saved.l !== undefined) process.env.LLM_API_KEY = saved.l;
  });
});

describe('rate limiter', () => {
  it('allows the limit per window, per user', () => {
    let time = 0;
    const allow = createRateLimiter({ limit: 2, windowMs: 1000, now: () => time });
    expect([allow('a'), allow('a'), allow('a'), allow('b')]).toEqual([true, true, false, true]);
    time = 1001;
    expect(allow('a')).toBe(true);
  });
});
