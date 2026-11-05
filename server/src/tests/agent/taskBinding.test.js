const execution = require('../../services/assistant/execution');

test('signed result stays attached to its task even if display order changes', () => {
  const list = execution.initializeChecklist([{ text: 'Open schedule', done: false }, { text: 'Open Patients', done: false }]);
  const reply = { type: 'navigate', op: 'go', pageId: 'schedule', path: '/clinician/schedule' };
  const pending = execution.pendingActions(reply, list, 0, '/clinician');
  const results = execution.acceptResults({ pending }, [{ actionId: reply.actionId, taskId: list[1].id, result: 'ok' }]);
  const updated = execution.applyResults([...list].reverse(), results);
  expect(updated.find(item => item.text === 'Open schedule').done).toBe(true);
  expect(updated.find(item => item.text === 'Open Patients').done).toBe(false);
});
test('a requested name matches a verified control with a longer label', () => {
  const list = [{ text: 'Add folic acid', done: false }];
  const reply = { type: 'run', steps: [{ page: { actions: [{ op: 'click', ref: 'r1', name: '1st Trimester Folic Acid (400 mcg)' }] } }] };
  const pending = execution.pendingActions(reply, list, 0, '/clinician');
  expect(pending[0].taskId).toBe(list[0].id);
  expect(execution.applyResults(list, [{ ...pending[0], result: 'ok' }])[0].done).toBe(true);
});
test('a different requested name cannot consume the successful control action', () => {
  expect(execution.matchingItem([{ text: 'Add calcium', done: false }], { op: 'click', name: '1st Trimester Folic Acid (400 mcg)' })).toBe(-1);
});
