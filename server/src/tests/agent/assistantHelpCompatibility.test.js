const assistant = require('../../services/assistant/assistant.service');
const { detectClinicalQuery } = require('../../services/assistant/patientQuery.service');
const config = require('../../config/assistant.config');

test.each(['What can you do?', 'What pages are available?', 'Where are my settings?', 'How does this app work?'])(
  'app help reaches the existing answer path without patient data: %s', async message => {
    const directory = jest.fn(async () => []);
    const metricLookup = jest.fn();
    const provider = { complete: jest.fn(async () => JSON.stringify({ action: 'answer',
      answer: 'Use the menu to visit the schedule and patient list.', steps: [], options: [], more: false })) };
    expect(detectClinicalQuery(message).isQuery).toBe(false);
    const reply = await assistant.handleStep({ message, role: 'clinician', userId: 'synthetic-doctor',
      currentPath: '/clinician', directory, metricLookup, provider, settings: config });
    expect(reply.type).toBe('answer');
    expect(reply.source).toBe('model');
    expect(directory).not.toHaveBeenCalled();
    expect(metricLookup).not.toHaveBeenCalled();
    expect(provider.complete).toHaveBeenCalledTimes(1);
  }
);

test.each(['What is her rubella status?', 'What was the platelet count?', 'What is AFP for Asha?', 'Asha hemoglobin'])(
  'clinical result questions still reach patient Q&A: %s', message => {
    expect(detectClinicalQuery(message).isQuery).toBe(true);
  }
);

test('medical interpretation refusal still takes precedence', () => {
  expect(detectClinicalQuery('Is her ferritin normal?').isDiagnostic).toBe(true);
});
