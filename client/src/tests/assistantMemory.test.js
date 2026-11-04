import { describe, it, expect } from 'vitest';
import { pruneMemory, buildMemoryEntry, appendMemory } from '../components/assistant/memoryState';

describe('Slice 5 client memoryState', () => {
  it('builds a bounded memory entry with patient, record, page and checklist', () => {
    const entry = buildMemoryEntry({
      message: "open Soham's last visit",
      patient: { id: 'p-soham', name: 'Soham Example' },
      record: { kind: 'visit', id: 'v-soham' },
      page: 'clinician',
      checklist: [
        { text: "Open Soham's last visit", done: true },
        { text: 'Write mild headache', done: false, reason: 'panel closed' },
      ],
      now: 1000000,
    });

    expect(entry).toEqual({
      message: "open Soham's last visit",
      patient: { id: 'p-soham', name: 'Soham Example' },
      record: { kind: 'visit', id: 'v-soham' },
      page: 'clinician',
      checklist: [
        { text: "Open Soham's last visit", done: true },
        { text: 'Write mild headache', done: false, reason: 'panel closed' },
      ],
      at: 1000000,
    });
  });

  it('caps memory at maxItems (default 10) and expires entries older than maxAgeMin (default 120)', () => {
    const baseTime = 200 * 60 * 1000;
    const oldEntry = buildMemoryEntry({
      message: 'expired request',
      now: baseTime - 121 * 60 * 1000,
    });

    let list = [oldEntry];
    for (let i = 1; i <= 12; i += 1) {
      list = appendMemory(
        list,
        buildMemoryEntry({ message: `request ${i}`, now: baseTime - (15 - i) * 1000 }),
        { now: baseTime, maxItems: 10, maxAgeMin: 120 }
      );
    }

    expect(list).toHaveLength(10);
    expect(list.some((e) => e.message === 'expired request')).toBe(false);
    expect(list[0].message).toBe('request 3');
    expect(list[9].message).toBe('request 12');
  });

  it('Forget clears memory completely (empty array)', () => {
    const entry = buildMemoryEntry({ message: 'open schedule', now: 1000 });
    const list = appendMemory([], entry, { now: 1000 });
    expect(list).toHaveLength(1);
    const cleared = pruneMemory([], { now: 1000 });
    expect(cleared).toEqual([]);
  });
});
