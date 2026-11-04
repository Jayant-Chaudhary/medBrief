import { request } from './apiClient';

export const assistantService = {
  /** One typed request: returns navigate, clarify, unsupported or unavailable. */
  async ask(message, currentPath, { page, round, progress, mode, continuationToken, startedAt, checklist, note, results, pageHash } = {}) {
    // The browser's time zone, so "tomorrow at 10" means 10:00 on the user's clock.
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // `page`: the open page's labels (doctors); `round`/`progress`/`mode, continuationToken`: later rounds of the same request.
    return request('/api/assistant/step', {
      method: 'POST',
      body: {
        message,
        currentPath,
        timeZone,
        startedAt,
        ...(page && { page }),
        ...(round !== undefined && { round }),
        ...(progress && { progress }),
        ...(mode && { mode, continuationToken }),
        ...(checklist && { checklist }),
        ...(note !== undefined && { note }),
        ...(results && { results }),
        ...(pageHash && { pageHash }),
      },
    });
  },

  /** Reports what happened to a button press the assistant proposed: ids and outcome only. */
  async event(page, button, outcome, errorCode) {
    return request('/api/assistant/event', { method: 'POST', body: { page, button, outcome, ...(errorCode && { errorCode }) } });
  },

  /** Asks the server to load the model while the user is still typing. */
  async warm() {
    return request('/api/assistant/warm', { method: 'POST' });
  },
};
