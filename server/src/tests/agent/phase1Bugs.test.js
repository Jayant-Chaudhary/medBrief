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
        directory: async () => [],
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
        directory: async () => [],
        round: 1,
        mode: 'agent',
        continuationToken: require('../../services/assistant/continuation').issue('dr-1', 'open schedule and then view patients', { round: 1, checklist, pending: [{ actionId: '0:0', op: 'go', pageId: 'schedule', itemIndex: 0, fingerprint: 'schedule' }] }),
        checklist,
        results: [{ actionId: '0:0', result: 'ok' }],
        provider,
        settings: { agentLoop: true },
      });

      // Bug: previously op === 'go' was filtered out, so item 0 remained unticked
      expect(reply.checklist[0].done).toBe(true);
      expect(reply.checklist[1].done).toBe(false);
    });
  });

  describe('Bug 3: Hangs and runaway requests with retry and timeouts', () => {
    it('retries once on model call timeout and reports clear error if unanswered', async () => {
      const provider = new FakeProvider();
      let calls = 0;
      provider.complete = jest.fn().mockImplementation(async () => {
        calls += 1;
        const err = new Error('Model timeout');
        err.code = 'TIMEOUT';
        throw err;
      });

      const reply = await assistant.handleStep({
        message: 'write follow up in notes then open schedule',
        role: 'clinician',
        userId: 'dr-1',
        directory: async () => [],
        round: 0,
        provider,
        settings: {
          agentLoop: true,
          modelCallTimeoutMs: 100,
          requestTimeoutMs: 500,
        },
      });

      // Should have attempted once + 1 retry = at least 2 calls
      expect(calls).toBeGreaterThanOrEqual(2);
      expect(reply.message).toMatch(/model could not produce a usable action/i);
    });
  });

  describe('Bug 4 & 5: Action batching and phrasing normalization', () => {
    it('normalizes checkbox click to check operation for safety and state consistency', async () => {
      const page = {
        title: 'Consultation',
        elements: [
          { ref: 'r_chk_bp', kind: 'checkbox', name: 'BP check', checked: false, effect: 'save' },
        ],
      };

      const provider = new FakeProvider();
      provider.complete = jest.fn().mockResolvedValue(JSON.stringify({
        note: 'Marking BP check as done',
        actions: [{ op: 'click', ref: 'r_chk_bp' }],
        status: 'done',
      }));

      const reply = await assistant.handleStep({
        message: 'mark BP check as done',
        role: 'clinician',
        userId: 'dr-1',
        directory: async () => [],
        round: 0,
        page,
        provider,
        settings: { agentLoop: true },
      });

      expect(reply.steps[0].page.actions[0].op).toBe('check');
      expect(reply.steps[0].page.actions[0].ref).toBe('r_chk_bp');
    });
  });

  describe('Bug 6: Strict grounding on typos and safety evaluation', () => {
    it('grounds verbatim typos like paracetmol without ungrounded autocorrect', async () => {
      const page = {
        title: 'Consultation',
        elements: [
          { ref: 'r_med_name_1', kind: 'text', name: 'Medicine name', effect: 'save', section: 'Prescription' },
        ],
      };

      const provider = new FakeProvider();
      provider.complete = jest.fn().mockResolvedValue(JSON.stringify({
        note: 'Adding paracetmol as requested',
        actions: [{ op: 'type', ref: 'r_med_name_1', text: 'paracetmol' }],
        status: 'done',
      }));

      const reply = await assistant.handleStep({
        message: 'add paracetmol 500 mg',
        role: 'clinician',
        userId: 'dr-1',
        directory: async () => [],
        round: 0,
        page,
        provider,
        settings: { agentLoop: true },
      });

      expect(reply.steps[0].page.actions[0].value).toBe('paracetmol');
    });
  });
});
