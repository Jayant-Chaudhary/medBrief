/**
 * An uncited flag from the model must be dropped and counted, not fail the draft.
 */
const { dropUncitedFlags, dropUncitedRecommendations, DoctorNotesSchema, ClinicalFlagsSchema } = require('../../services/consultAudio/drafting/draftSchemas');
const LocalDraftProvider = require('../../services/consultAudio/drafting/localDraftProvider');

describe('dropUncitedFlags', () => {
  const cited = { flag_name: 'a', severity: 'low', description: 'synthetic', cited_segment_ids: ['s1'] };
  const uncited = { flag_name: 'b', severity: 'low', description: 'synthetic', cited_segment_ids: [] };

  it('removes uncited flags and counts them', () => {
    const { raw, dropped } = dropUncitedFlags({ flags: [cited, uncited] });
    expect(dropped).toBe(1);
    expect(() => ClinicalFlagsSchema.parse(raw)).not.toThrow();
    expect(raw.flags).toHaveLength(1);
  });

  it('handles a bare array and missing data', () => {
    expect(dropUncitedFlags([cited, uncited]).dropped).toBe(1);
    expect(dropUncitedFlags(undefined).dropped).toBe(0);
  });
});

describe('LocalDraftProvider.generateClinicalFlags', () => {
  afterEach(() => {
    delete global.fetch;
  });

  it('returns the cited flags and reports how many were dropped', async () => {
    const content = JSON.stringify({
      flags: [
        { flag_name: 'a', severity: 'low', description: 'synthetic', cited_segment_ids: ['s1'] },
        { flag_name: 'b', severity: 'low', description: 'synthetic', cited_segment_ids: [] },
      ],
    });
    global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ message: { content } }) }));
    const provider = new LocalDraftProvider({ url: 'http://localhost:11434/api/chat' });
    const result = await provider.generateClinicalFlags({
      transcript: [{ id: 's1', speaker: 'doctor', text: 'synthetic' }],
      structuredContext: {},
      tracerCatalog: [],
    });
    expect(result.data.flags).toHaveLength(1);
    expect(result.droppedUncited).toBe(1);
  });
});

describe('dropUncitedRecommendations', () => {
  it('removes uncited plan items so the notes still validate', () => {
    const { raw, dropped } = dropUncitedRecommendations({
      assessment: 'synthetic',
      plan_and_recommendations: [
        { recommendation: 'kept', cited_segment_ids: ['s1'] },
        { recommendation: 'dropped', cited_segment_ids: [] },
      ],
    });
    expect(dropped).toBe(1);
    expect(DoctorNotesSchema.parse(raw).plan_and_recommendations).toHaveLength(1);
  });
});
