import test from 'node:test';
import assert from 'node:assert/strict';
import { blankMedication, blankTemplate } from './templateModel.js';
import { handleInlineGhostKey, inlineCompletion, medicineCompletion } from './inlineGhostModel.js';

const ranked = (id, name, dose = 'Saved example dose') => ({
  template: { ...blankTemplate(), id, status: 'active', medications: [{ ...blankMedication(), name, dose, frequency: 'Saved example frequency', duration: 'Saved example duration' }] },
  match: { conflicts: [], score: 0, candidate: false },
});

test('inline completion shows only the untyped suffix, including empty fields and zero-score saved values', () => {
  assert.equal(inlineCompletion('', 'Synthetic medicine'), 'Synthetic medicine');
  assert.equal(inlineCompletion('syn', 'Synthetic medicine'), 'thetic medicine');
  assert.equal(inlineCompletion('SYN', 'Synthetic medicine'), 'thetic medicine');
  assert.equal(inlineCompletion('Synthetic medicine', 'Synthetic medicine'), '');
  assert.equal(inlineCompletion('Other', 'Synthetic medicine'), '');
  assert.equal(inlineCompletion('', ''), '');
});

test('medicine fields use the highest ranked saved item matching what the doctor types', () => {
  const options = [ranked('a', 'Synthetic alpha'), ranked('b', 'Synthetic beta')];
  const row = { ...blankMedication(), name: 'Synthetic b' };
  const hint = medicineCompletion(options, row, [row]);
  assert.equal(hint.template.id, 'b');
  assert.equal(hint.medication.frequency, 'Saved example frequency');
  assert.equal(row.dose, '');
  const empty = blankMedication();
  assert.equal(medicineCompletion(options, empty, [empty]).template.id, 'a');
});

test('completion respects conflicts, current source and medicines already present in other rows', () => {
  const options = [ranked('a', 'Synthetic alpha'), ranked('b', 'Synthetic beta')];
  const empty = blankMedication();
  const existing = { ...blankMedication(), name: 'Synthetic alpha' };
  assert.equal(medicineCompletion(options, empty, [existing, empty]).template.id, 'b');
  const row = { ...empty, name: 'Synthetic beta', source: { id: 'b' } };
  assert.equal(medicineCompletion(options, row, [row]).template.id, 'b');
  assert.equal(medicineCompletion([options[0]], row, [row]), null);
  options[1].reviewOnly = true;
  assert.equal(medicineCompletion(options, row, [row]), null);
  options[0].match.conflicts = ['Example conflict'];
  assert.equal(medicineCompletion(options, empty, [empty]), null);
});

test('Tab accepts only the current field suggestion; Escape dismisses and native navigation/composition remain intact', () => {
  let accepted = 0, dismissed = 0;
  const event = (key, extra = {}) => ({ key, preventDefault() {}, stopPropagation() {}, ...extra });
  const actions = { accept: () => accepted++, dismiss: () => dismissed++ };
  const state = { suffix: ' saved suffix', atEnd: true, composing: false };
  assert.equal(handleInlineGhostKey(event('Tab'), state, actions), true);
  assert.equal(handleInlineGhostKey(event('Escape'), state, actions), true);
  assert.equal(accepted, 1); assert.equal(dismissed, 1);
  for (const [e, s] of [
    [event('Tab', { shiftKey: true }), state], [event('Tab', { ctrlKey: true }), state],
    [event('Tab', { nativeEvent: { isComposing: true } }), state], [event('Tab'), { ...state, composing: true }],
    [event('Tab'), { ...state, atEnd: false }], [event('Tab'), { ...state, suffix: '' }],
  ]) assert.equal(handleInlineGhostKey(e, s, actions), false);
  assert.equal(accepted, 1); assert.equal(dismissed, 1);
});
