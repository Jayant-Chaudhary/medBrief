/**
 * Unit Tests for Draft Model Providers and Factory (Phase 8).
 *
 * Verifies:
 * 1. FakeDraftProvider deterministic schema output and failure simulation modes.
 * 2. GeminiDraftProvider API payload structure and response schema handling.
 * 3. LocalDraftProvider (Qwen3:8b) Ollama and OpenAI-compatible formatting.
 * 4. DraftProviderFactory resolution by provider name.
 */

const {
  getDraftProvider,
  GeminiDraftProvider,
  LocalDraftProvider,
  FakeDraftProvider,
} = require('../../services/consultAudio/drafting/draftProviderFactory');

describe('Draft Model Providers & Factory (Phase 8)', () => {
  const sampleTranscript = [
    { id: 'seg-101', speaker: 'doctor', text: 'How are you feeling?' },
    { id: 'seg-102', speaker: 'patient', text: 'Feeling good, some backache.' },
  ];
  const sampleTracerCatalog = [
    { tracer_id: 'TRACER_HEMOGLOBIN_10.8', metric: 'hemoglobin', value: 10.8, unit: 'g/dL' },
  ];

  describe('DraftProviderFactory', () => {
    test('instantiates GeminiDraftProvider for "gemini"', () => {
      const provider = getDraftProvider('gemini');
      expect(provider).toBeInstanceOf(GeminiDraftProvider);
      expect(provider.name).toBe('gemini');
    });

    test('instantiates LocalDraftProvider for "local"', () => {
      const provider = getDraftProvider('local');
      expect(provider).toBeInstanceOf(LocalDraftProvider);
      expect(provider.name).toBe('local');
    });

    test('instantiates FakeDraftProvider for "fake"', () => {
      const provider = getDraftProvider('fake');
      expect(provider).toBeInstanceOf(FakeDraftProvider);
      expect(provider.name).toBe('fake');
    });

    test('throws for unsupported provider name', () => {
      expect(() => getDraftProvider('unsupported-model')).toThrow(/Unsupported draft model provider/);
    });
  });

  describe('FakeDraftProvider', () => {
    test('generates schema-compliant draft using real segment_ids from transcript', async () => {
      const provider = new FakeDraftProvider({ simulatedLatencyMs: 0 });
      const draft = await provider.generateDraft({
        transcript: sampleTranscript,
        structuredContext: {},
        tracerCatalog: sampleTracerCatalog,
      });

      expect(draft.provider).toBe('fake');
      expect(draft.doctorNotes).toHaveProperty('assessment');
      expect(draft.doctorNotes.plan_and_recommendations).toHaveLength(2);

      // Verify that cited segment_id matches input transcript
      const citedIds = draft.doctorNotes.plan_and_recommendations[0].cited_segment_ids;
      expect(citedIds[0]).toBe('seg-101');

      expect(draft.patientSummary).toHaveProperty('summary_text');
      expect(draft.patientSummary.action_checklist.length).toBeGreaterThan(0);
      expect(draft.clinicalFlags.length).toBeGreaterThan(0);
    });

    test('simulates invalid citation when configured', async () => {
      const provider = new FakeDraftProvider({ simulateInvalidCitation: true, simulatedLatencyMs: 0 });
      const notesRes = await provider.generateDoctorNotes({ transcript: sampleTranscript });
      const cited = notesRes.data.plan_and_recommendations[0].cited_segment_ids;
      expect(cited).toContain('seg-hallucinated-9999');
    });

    test('simulates unverified number when configured', async () => {
      const provider = new FakeDraftProvider({ simulateUnverifiedNumber: true, simulatedLatencyMs: 0 });
      const notesRes = await provider.generateDoctorNotes({ transcript: sampleTranscript });
      const text = notesRes.data.plan_and_recommendations[0].recommendation;
      expect(text).toContain('85000');
    });

    test('simulates timeout error when configured', async () => {
      const provider = new FakeDraftProvider({ simulateTimeout: true });
      await expect(provider.generateDraft({ transcript: sampleTranscript })).rejects.toThrow(/timeout/);
    });
  });

  describe('GeminiDraftProvider', () => {
    test('throws if GEMINI_API_KEY is missing', async () => {
      const provider = new GeminiDraftProvider({ apiKey: '' });
      await expect(
        provider.generateDoctorNotes({ transcript: sampleTranscript, structuredContext: {}, tracerCatalog: [] })
      ).rejects.toThrow(/GEMINI_API_KEY is not configured/);
    });

    test('calls fetch with valid Gemini REST endpoint and returns parsed draft', async () => {
      const originalFetch = global.fetch;
      const mockResponse = {
        chief_complaint: 'Mild headache.',
        vitals_observed: 'BP 118/74 mmHg.',
        assessment: 'Normal second trimester progress.',
        plan_and_recommendations: [
          { recommendation: 'Stay hydrated.', cited_segment_ids: ['seg-101'] },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(mockResponse) }] } },
          ],
        }),
      });

      try {
        const provider = new GeminiDraftProvider({ apiKey: 'test-key', model: 'gemini-1.5-flash' });
        const res = await provider.generateDoctorNotes({
          transcript: sampleTranscript,
          structuredContext: {},
          tracerCatalog: sampleTracerCatalog,
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const fetchUrl = global.fetch.mock.calls[0][0];
        expect(fetchUrl).toContain('gemini-1.5-flash:generateContent');
        expect(res.data.assessment).toBe('Normal second trimester progress.');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });

  describe('LocalDraftProvider (Qwen3:8b)', () => {
    test('calls Ollama format by default and parses valid JSON response', async () => {
      const originalFetch = global.fetch;
      const mockResponse = {
        summary_text: 'Your consultation went smoothly.',
        action_checklist: ['Rest well'],
        warning_signs: ['Fever'],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          message: { content: JSON.stringify(mockResponse) },
        }),
      });

      try {
        const provider = new LocalDraftProvider({
          url: 'http://localhost:11434/api/chat',
          model: 'qwen3:8b',
        });

        const res = await provider.generatePatientSummary({
          transcript: sampleTranscript,
          structuredContext: {},
          tracerCatalog: [],
        });

        expect(global.fetch).toHaveBeenCalledTimes(1);
        const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(requestBody.model).toBe('qwen3:8b');
        expect(requestBody.format).toBe('json');
        expect(res.data.summary_text).toBe('Your consultation went smoothly.');
      } finally {
        global.fetch = originalFetch;
      }
    });

    test('supports OpenAI-compatible endpoint format when url matches /v1/chat/completions', async () => {
      const originalFetch = global.fetch;
      const mockResponse = {
        flags: [
          { flag_name: 'test_flag', severity: 'low', description: 'desc', cited_segment_ids: ['seg-101'] },
        ],
      };

      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: JSON.stringify(mockResponse) } }],
        }),
      });

      try {
        const provider = new LocalDraftProvider({
          url: 'http://localhost:8000/v1/chat/completions',
          model: 'qwen3:8b',
        });

        const res = await provider.generateClinicalFlags({
          transcript: sampleTranscript,
          structuredContext: {},
          tracerCatalog: [],
        });

        const requestBody = JSON.parse(global.fetch.mock.calls[0][1].body);
        expect(requestBody.response_format).toEqual({ type: 'json_object' });
        expect(res.data.flags[0].flag_name).toBe('test_flag');
      } finally {
        global.fetch = originalFetch;
      }
    });
  });
});
