const { findButton } = require('../../services/assistant/controls.registry');
const { validateAgentActions } = require('../../services/assistant/agent/actions');
const { classify } = require('../../services/assistant/pageSnapshot');
test.each(['open_audio_consult', 'open_transcript_logs'])('%s requires a saving Confirm', id => {
  const button = findButton('clinician', 'dashboard', id);
  expect(button.effect).toBe('save');
  expect(button.sideEffect).toContain('starts a consultation session');
  expect(classify({ kind: 'button', name: button.label, effect: button.effect }, 'click')).toBe('confirm');
  const reply = validateAgentActions([{ op: 'press', button: id }], {}, button.label, [], 'clinician', { onPage: 'dashboard' });
  expect(reply.formStep.press.effect).toBe('save');
});
test.each(['Start recording','Stop recording','Pause recording','Resume recording','Mic check','Run STT test','Consent','Confirm ready','Download'])('%s stays manual', name => {
  expect(classify({ kind: 'button', name }, 'click')).toBe('never');
});
