import { describe, it, expect, vi } from 'vitest';
import { runPageAction, executeAction, PageActionError } from '../components/assistant/pageActions';

function createMockDoc(elements = [], rows = []) {
  return {
    querySelector: (selector) => {
      const match = selector.match(/data-assistant-ref="([^"]+)"/);
      if (!match) return null;
      return elements.find((el) => el.dataset?.assistantRef === match[1] || el.ref === match[1]) || null;
    },
    querySelectorAll: (selector) => {
      if (selector === '[data-assistant-row]') return rows;
      return [];
    },
  };
}

describe('pageActions: browser execution', () => {
  it('executes key action (Enter on search input)', () => {
    let keydownEvent = null;
    const input = {
      ref: 'r_search',
      isConnected: true,
      disabled: false,
      getAttribute: () => 'Search',
      scrollIntoView: vi.fn(),
      focus: vi.fn(),
      dispatchEvent: vi.fn((e) => {
        if (e.type === 'keydown') keydownEvent = e;
      }),
      dataset: { assistantRef: 'r_search' },
    };
    const doc = createMockDoc([input]);

    const res = executeAction({ ref: 'r_search', op: 'key', name: 'Search', key: 'Enter' }, doc);
    expect(res).toEqual({ result: 'ok' });
    expect(input.focus).toHaveBeenCalled();
    expect(keydownEvent?.key).toBe('Enter');
  });

  it('executes open_row to find and click a patient row by name without exposing row text', () => {
    let clicked = false;
    const button = {
      scrollIntoView: vi.fn(),
      click: vi.fn(() => { clicked = true; }),
    };
    const row = {
      textContent: 'Asha Example (PID-1029) · 28 yrs',
      querySelector: () => button,
    };
    const doc = createMockDoc([], [row]);

    const res = executeAction({ op: 'open_row', patient: 'Asha' }, doc);
    expect(res).toEqual({ result: 'ok' });
    expect(clicked).toBe(true);

    const missing = executeAction({ op: 'open_row', patient: 'Nonexistent Patient' }, doc);
    expect(missing).toEqual({ result: 'not_found', reason: 'NOT_FOUND' });
  });

  it('returns disabled when element is disabled', () => {
    const btn = {
      ref: 'r_dis',
      isConnected: true,
      disabled: true,
      getAttribute: () => 'Save',
      scrollIntoView: vi.fn(),
      dataset: { assistantRef: 'r_dis' },
    };
    const doc = createMockDoc([btn]);

    const res = executeAction({ ref: 'r_dis', op: 'click', name: 'Save' }, doc);
    expect(res).toEqual({ result: 'disabled', reason: 'Element is disabled' });
  });

  it('returns not_found when element is not in DOM', () => {
    const doc = createMockDoc([]);
    const res = executeAction({ ref: 'r_missing', op: 'click', name: 'Missing' }, doc);
    expect(res).toEqual({ result: 'not_found', reason: 'GONE' });
  });

  it('returns no_change when element label changed', () => {
    const btn = {
      ref: 'r_changed',
      isConnected: true,
      disabled: false,
      getAttribute: () => 'Updated Label',
      scrollIntoView: vi.fn(),
      dataset: { assistantRef: 'r_changed' },
    };
    const doc = createMockDoc([btn]);

    const res = executeAction({ ref: 'r_changed', op: 'click', name: 'Original Label' }, doc);
    expect(res).toEqual({ result: 'no_change', reason: 'Element label changed' });
  });
});
