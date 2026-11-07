/**
 * A failed automatic draft is retried, and sessions left in 'processing'
 * without a draft are picked up again after a restart.
 */
const db = require('../../config/supabaseAdminClient');
const draftService = require('../../services/consultAudio/draft.service');
const orchestrator = require('../../services/consultAudio/orchestrator.service');
const { ok, mockTables } = require('../helpers/supabaseMock');

jest.mock('../../config/supabaseAdminClient', () => ({ auth: { getUser: jest.fn() }, from: jest.fn() }));
jest.mock('../../services/consultAudio/draft.service', () => ({ generateDraftForSession: jest.fn() }));

describe('Automatic notes drafting', () => {
  beforeEach(() => jest.clearAllMocks());

  test('retries after a failure and stops once a draft is saved', async () => {
    draftService.generateDraftForSession
      .mockRejectedValueOnce(new Error('Gemini API error (503): synthetic'))
      .mockResolvedValueOnce({ id: 'draft-1' });
    const result = await orchestrator.draftWithRetries('synthetic-session', { retries: 2, delayMs: 1 });
    expect(result).toEqual({ id: 'draft-1' });
    expect(draftService.generateDraftForSession).toHaveBeenCalledTimes(2);
  });

  test('gives up after the configured retries without throwing', async () => {
    draftService.generateDraftForSession.mockRejectedValue(new Error('synthetic failure'));
    await expect(orchestrator.draftWithRetries('synthetic-session', { retries: 2, delayMs: 1 })).resolves.toBeNull();
    expect(draftService.generateDraftForSession).toHaveBeenCalledTimes(3);
  });

  test('does not retry when the session is no longer draftable', async () => {
    draftService.generateDraftForSession.mockRejectedValue(Object.assign(new Error('Cannot generate'), { status: 400 }));
    await orchestrator.draftWithRetries('synthetic-session', { retries: 2, delayMs: 1 });
    expect(draftService.generateDraftForSession).toHaveBeenCalledTimes(1);
  });

  test('on restart, drafts only processing sessions that have no draft yet', async () => {
    draftService.generateDraftForSession.mockResolvedValue({ id: 'draft' });
    mockTables(db, {
      consult_sessions: ok([{ id: 'needs-draft' }, { id: 'has-draft' }]),
      consult_drafts: [ok([]), ok([{ id: 'existing' }])],
    });
    await expect(orchestrator.resumeProcessingWithoutDraft()).resolves.toBe(1);
    await new Promise((r) => setImmediate(r));
    expect(draftService.generateDraftForSession).toHaveBeenCalledWith('needs-draft');
    expect(draftService.generateDraftForSession).not.toHaveBeenCalledWith('has-draft');
  });
});
