const { planChecklist, checkDone, fallbackChecklist } = require('../../services/assistant/agent/planner');
const FakeProvider = require('../../services/assistant/llm/fakeProvider');

describe('agent planner: planChecklist', () => {
  it('returns a single item for a simple short command', async () => {
    const list = await planChecklist('open schedule');
    expect(list).toEqual([{ text: 'open schedule', done: false }]);
  });

  it('turns a multi-step request into a checklist via provider', async () => {
    const reply = JSON.stringify({
      checklist: [
        'Find Soham in patients',
        "Open Soham's last visit",
        'Open consultation notes',
        'Add the most similar template',
      ],
    });
    const provider = new FakeProvider(reply);
    const list = await planChecklist('find soham in patients, open his last visit, open notes and add best template', { provider });
    expect(list).toHaveLength(4);
    expect(list[0]).toEqual({ text: 'Find Soham in patients', done: false });
    expect(list[1]).toEqual({ text: "Open Soham's last visit", done: false });
  });

  it('falls back gracefully when the provider fails', async () => {
    const provider = new FakeProvider(new Error('TIMEOUT'));
    const list = await planChecklist('open notes and add paracetamol', { provider });
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0].text).toContain('open notes');
  });

  it('falls back using heuristic splitting', () => {
    const list = fallbackChecklist('open notes and then add folic acid, afterwards write review in 2 weeks');
    expect(list).toHaveLength(3);
    expect(list[0].text).toBe('open notes');
    expect(list[1].text).toBe('add folic acid');
    expect(list[2].text).toBe('write review in 2 weeks');
  });
});

describe('agent planner: checkDone', () => {
  it('returns done: true immediately when all items are ticked', async () => {
    const checklist = [
      { text: 'Open notes', done: true },
      { text: 'Add folic acid', done: true },
    ];
    const res = await checkDone('open notes and add folic acid', checklist);
    expect(res.done).toBe(true);
    expect(res.message).toBe('All done.');
  });

  it('returns remaining items when some are unticked without provider', async () => {
    const checklist = [
      { text: 'Open notes', done: true },
      { text: 'Add folic acid', done: false },
    ];
    const res = await checkDone('open notes and add folic acid', checklist);
    expect(res.done).toBe(false);
    expect(res.remaining).toEqual(['Add folic acid']);
  });

  it('asks provider to verify if unticked items are explained', async () => {
    const checklist = [
      { text: 'Open notes', done: true },
      { text: 'Delete previous record', done: false },
    ];
    const reply = JSON.stringify({
      done: true,
      explanation: 'Delete action was refused because it is dangerous',
    });
    const provider = new FakeProvider(reply);
    const res = await checkDone('open notes and delete record', checklist, { provider });
    expect(res.done).toBe(true);
  });
});

