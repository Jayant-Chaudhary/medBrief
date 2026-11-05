const assistant = require('../../services/assistant/assistant.service');
const { sanitizeMemory, formatMemoryForPrompt, resolveMemoryFollowUp, effectiveGroundingMessage } = require('../../services/assistant/memory');
const { assistantStepSchema } = require('../../validators/assistant.validators');
const config = require('../../config/assistant.config');

const now = () => Date.parse('2026-11-04T06:00:00Z');
const settings = { ...config, agentLoop: true, actionsEnabled: true };
const patients = [
  { id: 'p-soham', fullName: 'Soham Example', email: 'soham@example.test', lastVisit: { appointmentId: 'v-soham' }, nextVisit: { appointmentId: 'v-soham-next' } },
  { id: 'p-asha', fullName: 'Asha Example', email: 'asha@example.test', lastVisit: { appointmentId: 'v-asha' }, nextVisit: { appointmentId: 'v-asha-next' } },
];

describe('Slice 5: memory of previous requests (this browser tab only)', () => {
  const sohamMemory = [
    {
      message: "open Soham's last visit and write mild headache in notes",
      patient: { id: 'p-soham', name: 'Soham' },
      record: { kind: 'visit', id: 'v-soham' },
      page: 'clinician',
      checklist: [
        { text: "Open Soham's last visit", done: true },
        { text: 'Write mild headache in notes', done: false, reason: 'panel was closed' },
      ],
      at: now() - 5 * 60 * 1000,
    },
  ];

  test('1. "do the same for Asha" adapts the previous request to Asha and still requires Confirm on saves', async () => {
    const provider = {
      complete: jest.fn(async () =>
        JSON.stringify({
          note: "Opening Asha's last visit",
          actions: [{ op: 'open_record', kind: 'last_visit', patient: 'Asha Example' }],
          status: 'continue',
        })
      ),
    };
    const res = await assistant.handleStep({
      message: 'do the same for Asha',
      role: 'clinician',
      userId: 'dr-1',
      currentPath: '/clinician',
      memory: sohamMemory,
      directory: async () => patients,
      recordLookup: async (id) => ({ id, patient_id: id === 'v-soham' ? 'p-soham' : 'p-asha' }),
      settings,
      now,
      provider,
    });

    expect(res.type).toBe('navigate');
    expect(res.path).toBe('/clinician?appointment=v-asha');
    expect(res.checklist[0].text).toContain('Asha Example');
    expect(res.checklist[1].text).toContain('Write mild headache in notes');
  });

  test('2. "also add calcium" (same visit) inherits the patient/record from memory', async () => {
    const page = {
      title: 'Dashboard',
      elements: [
        { ref: 'r1', kind: 'button', name: '2nd/3rd Trimester IFA + Calcium', section: 'Prescription', effect: 'save' },
      ],
    };
    const provider = {
      complete: jest.fn(async ({ schema }) => {
        if (schema.properties.checklist) {
          return JSON.stringify({ checklist: ['Add calcium to prescription'] });
        }
        return JSON.stringify({
          note: 'Click calcium prophylaxis bundle',
          actions: [{ op: 'click', ref: 'r1' }],
          status: 'continue',
        });
      }),
    };

    const res = await assistant.handleStep({
      message: 'also add calcium',
      role: 'clinician',
      userId: 'dr-1',
      currentPath: '/clinician',
      page,
      memory: sohamMemory,
      directory: async () => patients,
      recordLookup: async (id) => ({ id, patient_id: 'p-soham' }),
      settings,
      now,
      provider,
    });

    // Without memory this would ask "Which patient?", but with memory it knows Soham's visit is active
    expect(res.type).toBe('run');
    expect(res.steps[0].page.actions[0]).toMatchObject({ ref: 'r1', op: 'click', risk: 'confirm' });
  });

  test('3. "go back to the last patient" navigates back to the remembered patient record', async () => {
    const res = await assistant.handleStep({
      message: 'go back to the last patient',
      role: 'clinician',
      userId: 'dr-1',
      currentPath: '/clinician/schedule',
      memory: sohamMemory,
      directory: async () => patients,
      recordLookup: async (id) => ({ id, patient_id: 'p-soham' }),
      settings,
      now,
      provider: { complete: jest.fn() },
    });

    expect(res.type).toBe('navigate');
    expect(res.recordTarget).toMatchObject({ kind: 'visit', id: 'v-soham', patientId: 'p-soham' });
  });

  test('4. "repeat that" re-runs the previous steps and still requires Confirm on saves', async () => {
    const page = {
      title: 'Dashboard',
      elements: [{ ref: 'r2', kind: 'textarea', name: 'Consultancy notes', section: 'Notes', effect: 'save' }],
    };
    const provider = {
      complete: jest.fn(async () =>
        JSON.stringify({
          note: 'Write mild headache in notes',
          actions: [{ op: 'append', ref: 'r2', text: 'mild headache' }],
          status: 'continue',
        })
      ),
    };

    const input = {
      message: 'repeat that',
      role: 'clinician',
      userId: 'dr-1',
      currentPath: '/clinician',
      page,
      memory: sohamMemory,
      directory: async () => patients,
      recordLookup: async (id) => ({ id, patient_id: 'p-soham' }),
      settings,
      now,
      provider,
    };
    const opened = await assistant.handleStep(input);
    expect(opened.type).toBe('navigate');
    const res = await assistant.handleStep({
      ...input, round: 1, mode: opened.mode, continuationToken: opened.continuationToken,
      currentRecord: { kind: 'visit', id: 'v-soham' }, results: [{ actionId: opened.actionId, result: 'ok' }],
    });

    expect(res.type).toBe('run');
    expect(res.steps[0].page.actions[0]).toMatchObject({
      ref: 'r2',
      op: 'append',
      value: 'mild headache',
      risk: 'confirm',
    });
  });

  test('5. "finish what failed" runs only the unticked items from the previous request', async () => {
    const page = {
      title: 'Dashboard',
      elements: [{ ref: 'r2', kind: 'textarea', name: 'Consultancy notes', section: 'Notes', effect: 'save' }],
    };
    const provider = {
      complete: jest.fn(async () =>
        JSON.stringify({
          note: 'Finish writing mild headache in notes',
          actions: [{ op: 'append', ref: 'r2', text: 'mild headache' }],
          status: 'continue',
        })
      ),
    };

    const res = await assistant.handleStep({
      message: 'finish what failed',
      role: 'clinician',
      userId: 'dr-1',
      currentPath: '/clinician',
      page,
      memory: sohamMemory,
      directory: async () => patients,
      recordLookup: async (id) => ({ id, patient_id: 'p-soham' }),
      settings,
      now,
      provider,
    });

    expect(res.type).toBe('run');
    expect(res.checklist).toEqual([{ text: 'Write mild headache in notes', done: false }]);
    expect(res.steps[0].page.actions[0]).toMatchObject({
      ref: 'r2',
      op: 'append',
      value: 'mild headache',
      risk: 'confirm',
    });
  });

  test('6. "which patient was that?" is answered directly from memory', async () => {
    const res = await assistant.handleStep({
      message: 'which patient was that?',
      role: 'clinician',
      userId: 'dr-1',
      currentPath: '/clinician/schedule',
      memory: sohamMemory,
      directory: async () => patients,
      settings,
      now,
      provider: { complete: jest.fn() },
    });

    expect(res.type).toBe('answer');
    expect(res.text).toContain('Soham Example');
  });

  test('7. age expiry and bounds: entries older than ASSISTANT_MEMORY_MAX_AGE_MIN are dropped and validator bounds items', () => {
    const expired = [
      {
        message: 'open Asha maternity card',
        patient: { id: 'p-asha', name: 'Asha' },
        at: now() - 121 * 60 * 1000, // 121 mins ago (> 120 default)
      },
      ...sohamMemory,
    ];
    const clean = sanitizeMemory(expired, patients, { now: now(), settings });
    expect(clean).toHaveLength(1);
    expect(clean[0].patient.fullName).toBe('Soham Example');

    // Validator rejects > config.memoryItems
    const tooMany = Array.from({ length: 11 }, () => ({ message: 'open schedule' }));
    expect(assistantStepSchema.safeParse({ message: 'open schedule', memory: tooMany }).success).toBe(false);
    expect(assistantStepSchema.safeParse({ message: 'open schedule', memory: tooMany.slice(0, 10) }).success).toBe(true);
  });

  test('8. a new patient named now always beats memory, and unreferenced memory values cannot be typed', async () => {
    const follow = resolveMemoryFollowUp('also open Asha Example last visit', sohamMemory, patients);
    expect(follow).toBeNull(); // Named patient Asha overrides Soham memory inheritance

    // Without explicit reference ("same notes as before"), values from earlier memory are not grounded
    const g1 = effectiveGroundingMessage('write headache in notes', sohamMemory);
    expect(g1).toBe('write headache in notes');
    expect(g1).not.toContain('mild headache');

    // With explicit reference ("same notes as before"), earlier request words are grounded
    const g2 = effectiveGroundingMessage('write the same notes as before', sohamMemory);
    expect(g2).toContain('mild headache');

    const promptBlock = formatMemoryForPrompt(sanitizeMemory(sohamMemory, patients, { now: now(), settings }));
    expect(promptBlock).toContain('Earlier in this session:');
    expect(promptBlock).toContain('Soham Example');
  });
});

