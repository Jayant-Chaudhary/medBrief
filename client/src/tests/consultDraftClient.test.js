import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../services/supabaseClient.js', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: null } }) } },
}));

import { reviewConsultationDraft, generateConsultationDraft } from '../services/consultAudio/consultClient.service.js';

describe('consult draft requests', () => {
  beforeEach(() => {
    global.fetch = vi.fn(async () => ({ ok: true, status: 200, headers: new Headers(), json: async () => ({ ok: true }) }));
  });

  it('sends the review body as a single JSON object', async () => {
    await reviewConsultationDraft({ sessionId: 'sess-1', action: 'approve' });
    const body = global.fetch.mock.calls[0][1].body;
    expect(JSON.parse(body)).toMatchObject({ action: 'approve' });
  });

  it('sends the generate body as a single JSON object', async () => {
    await generateConsultationDraft({ sessionId: 'sess-1' });
    const body = global.fetch.mock.calls[0][1].body;
    expect(typeof JSON.parse(body)).toBe('object');
  });
});
