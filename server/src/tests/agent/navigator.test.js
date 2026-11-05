const { navigateRound, buildNavigatorMessages, NAVIGATOR_SCHEMA } = require('../../services/assistant/agent/navigator');
const FakeProvider = require('../../services/assistant/llm/fakeProvider');

const el = (ref, kind, name, extra = {}) => ({ ref, kind, name, ...extra });
const PAGE = {
  title: 'Dashboard',
  elements: [
    el('r1', 'button', 'Consultation notes', { effect: 'free' }),
    el('r2', 'textarea', 'Consultancy notes', { effect: 'save' }),
    el('r3', 'button', 'Save notes', { effect: 'save' }),
  ],
};

describe('agent navigator', () => {
  it('formats prompt with request, checklist ticks, prior results and page elements', () => {
    const messages = buildNavigatorMessages({
      message: 'find soham and open notes',
      checklist: [
        { text: 'Find Soham in patients', done: true },
        { text: 'Open consultation notes', done: false },
      ],
      note: 'Searched for Soham',
      results: [{ ref: 'r6', op: 'type', result: 'ok' }],
      page: PAGE,
      role: 'clinician',
    });

    expect(messages).toHaveLength(2);
    const userPrompt = messages[1].content;
    expect(userPrompt).toContain('find soham and open notes');
    expect(userPrompt).toContain('[✓] Find Soham in patients');
    expect(userPrompt).toContain('[ ] Open consultation notes');
    expect(userPrompt).toContain('Searched for Soham');
    expect(userPrompt).toContain('type r6 -> ok');
    expect(userPrompt).toContain('r1 button "Consultation notes"');
  });

  it('parses valid model response and returns clean actions, note and status', async () => {
    const reply = JSON.stringify({
      note: 'Opening notes panel',
      actions: [{ op: 'click', ref: 'r1' }],
      status: 'continue',
    });
    const provider = new FakeProvider(reply);
    const outcome = await navigateRound({
      message: 'open notes',
      page: PAGE,
      provider,
    });

    expect(outcome.status).toBe('continue');
    expect(outcome.note).toBe('Opening notes panel');
    expect(outcome.actions).toEqual([{ op: 'click', ref: 'r1' }]);
  });

  it('handles cannot status with clear reason', async () => {
    const reply = JSON.stringify({
      note: 'Cannot delete record',
      actions: [],
      status: 'cannot',
      reason: 'Deleting patient records is not supported.',
    });
    const provider = new FakeProvider(reply);
    const outcome = await navigateRound({
      message: 'delete record',
      page: PAGE,
      provider,
    });

    expect(outcome.status).toBe('cannot');
    expect(outcome.reason).toContain('Deleting patient records');
  });

  it('returns graceful cannot when provider throws error', async () => {
    const provider = new FakeProvider(new Error('TIMEOUT'));
    const outcome = await navigateRound({
      message: 'open notes',
      page: PAGE,
      provider,
    });

    expect(outcome.status).toBe('cannot');
    expect(outcome.reason).toBeDefined();
  });
});

