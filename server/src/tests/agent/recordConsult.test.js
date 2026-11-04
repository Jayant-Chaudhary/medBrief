const { classify } = require('../../services/assistant/pageSnapshot');
const assistant = require('../../services/assistant/assistant.service');
const { validateAgentActions } = require('../../services/assistant/agent/actions');
const { findButton } = require('../../services/assistant/controls.registry');
const config = require('../../config/assistant.config');

describe('Record Consultation & Safety Guards (T4 - Server)', () => {
  const settings = { ...config, agentLoop: false };

  test.each([
    { name: 'Start recording', kind: 'button' },
    { name: 'Stop recording', kind: 'button' },
    { name: 'Stop consultation', kind: 'button' },
    { name: 'Proceed to mic check', kind: 'button' },
    { name: 'Run STT test', kind: 'button' },
    { name: 'Confirm ready', kind: 'button' },
    { name: 'Informed consent confirmation', kind: 'checkbox' },
    { name: 'Delete', kind: 'button' },
    { name: 'Remove', kind: 'button' },
    { name: 'Sign out', kind: 'button' },
    { name: 'Choose file', kind: 'button' },
    { name: 'Upload', kind: 'button' },
  ])('classify() returns never for "$name"', (el) => {
    expect(classify(el, el.kind === 'checkbox' ? 'check' : 'click')).toBe('never');
  });

  test.each([
    { name: 'Maternity record', kind: 'tab' },
    { name: 'Maternity record', kind: 'link' },
    { name: 'Antenatal record', kind: 'tab' },
  ])('classify() returns free for "$name" ($kind)', (el) => {
    expect(classify(el, 'click')).toBe('free');
  });

  test.each([
    'record consultation',
    'open recording',
  ])('request "%s" on dashboard maps to declared open_audio_consult button with Confirm card', async (phrase) => {
    const res = await assistant.handleStep({
      message: phrase,
      role: 'clinician',
      userId: 'dr-1',
      currentPath: '/clinician',
      page: {
        title: 'Clinician Dashboard',
        elements: [
          {
            ref: 'btn_rec',
            kind: 'button',
            name: 'Record Consultation',
            effect: 'send',
            sideEffect: 'This will open the consultation recording window. Recording stays manual.',
          },
        ],
      },
      settings,
    });

    expect(res.type).toBe('run');
    const step = res.steps[0];
    const press = step.press || step.page?.press || (step.page?.actions && step.page.actions[0]);
    expect(press).toBeTruthy();
    expect(press.id || press.ref).toMatch(/open_audio_consult|btn_rec/);
    expect(press.effect || press.risk).toMatch(/send|save|confirm/);
    expect(press.sideEffect || step.sideEffect).toBe(
      'This will open the consultation recording window. Recording stays manual.'
    );
  });

  test('declared open_audio_consult has side-effect text and send/save effect', () => {
    const btn = findButton('clinician', 'dashboard', 'open_audio_consult');
    expect(btn).toBeTruthy();
    expect(['save', 'send']).toContain(btn.effect);
    expect(btn.sideEffect).toBe(
      'This will open the consultation recording window. Recording stays manual.'
    );
  });

  test('validateAgentActions handles press("open_audio_consult")', () => {
    const res = validateAgentActions(
      [{ op: 'press', button: 'open_audio_consult' }],
      { title: 'Dashboard', elements: [] },
      'record consultation',
      [],
      'clinician',
      { onPage: 'dashboard' }
    );
    expect(res.formStep.press).toMatchObject({
      id: 'open_audio_consult',
      sideEffect: 'This will open the consultation recording window. Recording stays manual.',
    });
  });
});
