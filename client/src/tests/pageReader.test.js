import { describe, it, expect, vi } from 'vitest';
import { cleanLabel, kindOf, effectOf } from '../components/assistant/pageReader';
import { runPlan } from '../components/assistant/planRunner';

// The reader's DOM walk is checked in the browser; these are its rules, plus the runner's page actions.
describe('page reader rules', () => {
  it('shortens and tidies labels', () => {
    expect(cleanLabel('  Add\n   medicine  ')).toBe('Add medicine');
    expect(cleanLabel('x'.repeat(100))).toHaveLength(80);
  });

  it.each([
    ['button', null, null, 'button'],
    ['a', null, null, 'link'],
    ['summary', null, null, 'summary'],
    ['input', 'datetime-local', null, 'datetime'],
    ['input', 'checkbox', null, 'checkbox'],
    ['input', 'password', null, null],
    ['input', 'range', null, null],
    ['div', null, 'switch', 'checkbox'],
    ['div', null, 'tab', 'tab'],
    ['textarea', null, null, 'textarea'],
  ])('<%s type=%s role=%s> is %s', (tag, type, role, expected) => {
    expect(kindOf(tag, type, role)).toBe(expected);
  });

  it('treats controls that only open something as harmless, and keeps the page\'s own marks', () => {
    expect(effectOf({ opensSomething: true, tag: 'button' })).toBe('free');
    expect(effectOf({ tag: 'summary' })).toBe('free');
    expect(effectOf({ mark: 'save', opensSomething: true, tag: 'button' })).toBe('save');
    expect(effectOf({ tag: 'button' })).toBeUndefined();
  });
});

describe('runPlan: actions on the open page', () => {
  const io = (overrides = {}) => ({
    navigate: vi.fn(), waitFor: vi.fn(), pause: async () => {}, settle: async () => {}, highlight: vi.fn(),
    confirm: vi.fn(async () => true), report: vi.fn(), progress: vi.fn(), stopped: () => false,
    pageAction: vi.fn(), pageId: 'clinician', ...overrides,
  });
  const free = { ref: 'r1', op: 'click', name: 'Consultation notes', risk: 'free' };
  const saving = { ref: 'r2', op: 'append', name: 'Consultancy notes', risk: 'confirm', value: 'mild headache', effect: 'save', section: 'Notes' };
  const plan = (actions) => [{ label: 'This page', page: { actions, refused: [] } }];

  it('runs harmless actions at once and asks before the rest, logging only those', async () => {
    const deps = io();
    expect(await runPlan(plan([free, saving]), deps)).toBe('done');
    expect(deps.pageAction.mock.calls.map(([a]) => a.ref)).toEqual(['r1', 'r2']);
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.confirm).toHaveBeenCalledWith({
      label: 'Add to "Consultancy notes"',
      rows: [{ label: 'Where', value: 'Notes' }, { label: 'Value', value: 'mild headache' }],
      sideEffect: 'This is saved as soon as it is done.',
      changed: false,
    });
    expect(deps.report.mock.calls).toEqual([['clinician', 'page_action', 'confirmed'], ['clinician', 'page_action', 'done']]);
  });

  it('asks once for several fields of one section that save, then fills them all', async () => {
    const field = (ref, name, value) => ({ ref, op: 'type', name, value, risk: 'confirm', effect: 'save', section: 'Medicine 1', group: 'fields:Medicine 1' });
    const deps = io();
    expect(await runPlan(plan([field('m1', 'Name', 'paracetamol'), field('m2', 'Dose', '500 mg')]), deps)).toBe('done');
    expect(deps.confirm).toHaveBeenCalledTimes(1);
    expect(deps.confirm.mock.calls[0][0]).toMatchObject({
      label: 'Fill Medicine 1',
      rows: [{ label: 'Name', value: 'replaces the text with: paracetamol' }, { label: 'Dose', value: 'replaces the text with: 500 mg' }],
    });
    expect(deps.pageAction.mock.calls.map(([a]) => a.ref)).toEqual(['m1', 'm2']);
    expect(deps.report.mock.calls).toEqual([['clinician', 'page_action', 'confirmed'], ['clinician', 'page_action', 'done']]);
  });

  it('does nothing more after Cancel', async () => {
    const deps = io({ confirm: vi.fn(async () => false) });
    expect(await runPlan(plan([saving, free]), deps)).toBe('cancelled');
    expect(deps.pageAction).not.toHaveBeenCalled();
    expect(deps.report.mock.calls).toEqual([['clinician', 'page_action', 'cancelled']]);
  });

  it('stops when an element changed before it was used', async () => {
    const changed = Object.assign(new Error('CHANGED'), { code: 'CHANGED' });
    const deps = io({ pageAction: vi.fn((action) => { if (action.ref === 'r1') throw changed; }) });
    expect(await runPlan(plan([free, saving]), deps)).toBe('failed');
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.progress).toHaveBeenLastCalledWith(0, { page: ['failed'] });
  });
});
