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
});
