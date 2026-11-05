import { it, expect, vi } from 'vitest';
import { runPageAction } from '../components/assistant/pageActions';
import { readPage } from '../components/assistant/pageReader';
import { readRecord, recordPath, hashWrittenValue } from '../components/assistant/recordContext';
it('type preserves existing textarea notes and appends', () => {
  class Textarea {
    constructor() { this._value = 'existing synthetic note'; this.tagName = 'TEXTAREA'; this.dataset = {}; this.isConnected = true; }
    get value() { return this._value; }
    set value(v) { this._value = v; }
    getAttribute(key) { return key === 'aria-label' ? 'Notes' : null; }
    closest() { return null; }
    scrollIntoView() {} focus() {} blur() {} dispatchEvent() {}
  }
  const el = new Textarea();
  const result = runPageAction({ op: 'type', ref: 'r1', value: 'resting pulse 78 bpm' }, 'Notes', { querySelector: () => el });
  expect(el.value).toBe('existing synthetic note\nresting pulse 78 bpm');
  expect(result.result).toBe('ok');
});
it('browser refuses private controls even with a server action', () => {
  const click = vi.fn();
  expect(() => runPageAction({ op: 'click', ref: 'r1' }, '', { querySelector: () => ({ isConnected: true, closest: () => ({}), click }) })).toThrow('PRIVATE');
  expect(click).not.toHaveBeenCalled();
});
it('private row snapshots contain no row name, explicit patient label or nearby values', () => {
  const region = {};
  const el = { tagName: 'BUTTON', dataset: {}, disabled: false, required: false,
    closest: selector => selector.includes('data-assistant-private') ? region : null,
    getAttribute: key => key === 'aria-label' ? 'Open Asha Example 78 bpm' : null,
    setAttribute: () => {}, hasAttribute: () => false, getClientRects: () => [1],
  };
  const doc = { title: 'Clinic', querySelectorAll: () => [], body: { querySelectorAll: selector => selector.includes('button') ? [el] : [] }, defaultView: { getComputedStyle: () => ({ display: 'block', visibility: 'visible' }) } };
  el.ownerDocument = doc;
  const snapshot = readPage(doc).page;
  expect(snapshot.elements[0]).toMatchObject({ name: '[patient row]', private: true });
  expect(JSON.stringify(snapshot)).not.toMatch(/Asha|Example|78|bpm/);
});
it('ambiguous patient rows never click the first match', () => {
  const click = vi.fn();
  const rows = [1, 2].map(() => ({ textContent: 'Asha Example', querySelector: () => ({ click }) }));
  expect(() => runPageAction({ op: 'open_row', patient: 'Asha' }, '', { querySelectorAll: () => rows })).toThrow('NOT_FOUND');
  expect(click).not.toHaveBeenCalled();
});
it('captures only record kind and id, and rebuilds a registered return route', () => {
  const origin = readRecord({ pathname: '/clinician', search: '?appointment=synthetic-visit' });
  expect(origin).toEqual({ kind: 'visit', id: 'synthetic-visit' });
  expect(readRecord({ pathname: '/clinician/patients', search: '' })).toBeNull();
  expect(recordPath(origin)).toBe('/clinician?appointment=synthetic-visit');
  expect(recordPath({ kind: 'https://evil.test', id: 'x' })).toBeNull();
});
it('write digest is stable and contains no value', async () => {
  const hash = await hashWrittenValue('resting pulse 78 bpm');
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(hash).toBe(await hashWrittenValue(' resting   pulse 78 bpm '));
  expect(hash).not.toContain('78 bpm');
});
