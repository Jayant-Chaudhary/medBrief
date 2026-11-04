const assistant = require('../../services/assistant/assistant.service');
const FakeProvider = require('../../services/assistant/llm/fakeProvider');

describe('Phase 1 Bug Fixes', () => {
  describe('Bug 1: Requests naming two or more pages must not stop at clarify', () => {
    it('routes multi-page requests to the agent loop instead of returning clarify', async () => {
      const provider = new FakeProvider();
      // Provide a mock planner response that returns a 2-item checklist
      provider.complete = jest.fn().mockImplementation(async ({ schema }) => {
        if (schema.properties?.checklist) {
          return JSON.stringify({
            checklist: ['Open schedule', 'View patients'],
          });
        }
        return JSON.stringify({
          note: 'Opening schedule first',
          actions: [{ op: 'go', page: 'schedule' }],
          status: 'continue',
        });
      });

      const multiPageRequests = [
        'open schedule and then view patients',
        'go to dashboard and open schedule',
        'dashboard par jao aur schedule open karo',
      ];

      for (const msg of multiPageRequests) {
        const reply = await assistant.handleStep({
          message: msg,
          role: 'clinician',
          userId: 'dr-1',
          provider,
          settings: { agentLoop: true },
        });

        // Bug: matchIntent at round 0 previously intercepted these and returned 'clarify'
        expect(reply.type).not.toBe('clarify');
        expect(reply.source).toBe('agent');
      }
    });
  });

  describe('Bug 2: Navigation steps must tick their checklist item', () => {
    it('ticks the checklist item corresponding to the opened page or record', async () => {
      const provider = new FakeProvider();
      provider.complete = jest.fn().mockResolvedValue(JSON.stringify({
        note: 'Schedule opened, now viewing patients',
        actions: [{ op: 'go', page: 'patients' }],
        status: 'continue',
      }));

      const checklist = [
        { text: 'Open schedule', done: false },
        { text: 'View patients', done: false },
      ];

      const reply = await assistant.handleStep({
        message: 'open schedule and then view patients',
        role: 'clinician',
        userId: 'dr-1',
        round: 1,
        checklist,
        results: [{ op: 'go', pageId: 'schedule', result: 'ok' }],
        provider,
        settings: { agentLoop: true },
      });

      // Bug: previously op === 'go' was filtered out, so item 0 remained unticked
      expect(reply.checklist[0].done).toBe(true);
      expect(reply.checklist[1].done).toBe(false);
    });
  });
});
