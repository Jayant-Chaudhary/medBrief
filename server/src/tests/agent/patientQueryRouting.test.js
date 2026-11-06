const { detectClinicalQuery } = require('../../services/assistant/patientQuery.service');
const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');
const patients = [{ id: 'synthetic-p', fullName: 'Asha Example' }];

test.each([
  'new visit for Asha Example tomorrow at 5 pm', 'next visit asha', "Asha's card", "someone's card",
  'schedule then Asha next visit', 'Asha and Bina', 'lots of steps', 'kal shaam 5 baje',
  'prepare a new appointment for Asha tomorrow at 5 pm', 'do the same for Asha',
])('ordinary command remains outside clinical Q&A: %s', message => {
  expect(detectClinicalQuery(message, patients).isQuery).toBe(false);
});

test.each(['Asha hemoglobin', 'Asha calcium', 'Asha uric acid', 'what is her rubella status?'])(
  'a factual query can still be detected before and after loading the directory: %s', message => {
    expect(detectClinicalQuery(message).isQuery).toBe(true);
    expect(detectClinicalQuery(message, patients).isQuery).toBe(true);
  }
);

test('an in-place non-patient form action does not invoke directory or metric queries', async () => {
  const directory = jest.fn();
  const metricLookup = jest.fn();
  const reply = await assistant.handleStep({ message: 'set time to tomorrow at 5 pm', role: 'clinician', userId: 'synthetic-doctor',
    currentPath: '/clinician/appointments/new', directory, metricLookup, settings: { ...config, agentLoop: false },
    now: () => Date.parse('2026-11-05T05:00:00Z'), timeZone: 'Asia/Kolkata',
    provider: { complete: async () => JSON.stringify({ action: 'run', steps: [
      { do: 'fill_form', page: 'new_appointment', patient: '', which: 'none', when: '', fields: [{ control: 'scheduledAt', value: '2026-11-06T17:00' }], press: 'none' },
    ], options: [], more: false }) },
  });
  expect(reply.type).toBe('run');
  expect(reply.steps[0].fill.fields.scheduledAt).toBe('2026-11-06T17:00');
  expect(directory).not.toHaveBeenCalled();
  expect(metricLookup).not.toHaveBeenCalled();
});
