import test from 'node:test';
import assert from 'node:assert/strict';
import { blankTemplate, blankMedication, rankTemplates } from './templateModel.js';
import { filterTemplateMatches, templateNameCompletion, templateMatchLabel, runTemplateSearch, handleTemplateSearchKey, fillDraftFromTemplate } from './templateSearchModel.js';
import { TEMPLATE_SEARCH_CONFIG } from './prescriptionConfig.js';

// Synthetic, non-clinical fixture dimensions and regimens.
const definitions = ['a', 'b', 'c'].map(id => ({ id, type: 'number', unit: 'example', enabled: true }));
const factors = value => Object.fromEntries(definitions.map(({ id }) => [id, { type: 'number', value, unit: 'example', confirmed: true }]));
const makeTemplate = (id, value, extra = {}) => ({ ...blankTemplate(), id, status: 'active', name: `Example ${id}`,
  factorSnapshot: factors(value), medications: [{ ...blankMedication(), name: `Medicine ${id}`, dose: 'Recorded example' }], ...extra });
const context = { factorRecords: factors(1), factors: '', absentFactors: '', purpose: '', pregnancy: '' };
const ranking = () => rankTemplates([makeTemplate('first', 1, { purpose: 'Sample tag' }), makeTemplate('second', 5),
  makeTemplate('third', 10, { factorSnapshot: { ...factors(10), c: factors(1).c } })], context, definitions);

test('typing filters names, tags and medicines without changing fitted scores or ranking', () => {
  const ranked = ranking();
  for (const query of ['', 'example', 'MEDICINE', ' example  medicine ']) {
    const result = filterTemplateMatches(ranked, query);
    assert.deepEqual(result.map(row => row.template.id), ['first', 'second', 'third']);
    assert.equal(result[0], ranked[0]);
    assert.equal(result[0].match.score, 100);
  }
  assert.deepEqual(filterTemplateMatches(ranked, 'sample tag').map(row => row.template.id), ['first']);
  assert.deepEqual(filterTemplateMatches(ranked, 'medicine second').map(row => row.template.id), ['second']);
  assert.equal(filterTemplateMatches(ranked, 'absent term').length, 0);
});

test('browsing excludes archived, draft and in-progress templates but retains nonmatches and conflicts', () => {
  const ranked = ranking();
  const best = ranked[0];
  const invalid = [
    { ...best, template: { ...best.template, archived: true } },
    { ...best, template: { ...best.template, status: 'draft' } },
    { ...best, template: { ...best.template, autoCapture: { stage: 'draft' } } },
  ];
  assert.deepEqual(filterTemplateMatches(invalid, ''), []);
  const reviewRows = [
    { ...best, match: { ...best.match, conflicts: ['Example conflict'] } },
    { ...ranked[1], match: { ...ranked[1].match, candidate: false, score: 0 } },
  ];
  assert.equal(filterTemplateMatches(reviewRows, '').length, 2);
  assert.deepEqual(filterTemplateMatches(ranked, '', new Set(['second'])).map(row => row.template.id), ['second']);
});

test('name ghost completes the top prefix regardless of score, coverage, ties or rule-only scoring', () => {
  const ranked = ranking();
  assert.equal(templateNameCompletion(ranked, 'Exa'), 'mple first');
  assert.equal(templateNameCompletion(ranked, 'exa'), 'mple first');
  assert.equal(templateNameCompletion(ranked, 'Medicine'), '');
  assert.equal(templateNameCompletion(ranked, 'Example first'), '');
  assert.equal(templateNameCompletion(ranked, ' Exa'), '');
  assert.equal(templateNameCompletion(ranked, ''), 'Example first');
  const weak = [{ ...ranked[0], match: { ...ranked[0].match, coverage: 0.2 } }];
  assert.equal(templateNameCompletion(weak, 'Exa'), 'mple first');
  const tied = [ranked[0], { ...ranked[1], match: ranked[0].match }];
  assert.equal(templateNameCompletion(tied, 'Exa'), 'mple first');
  assert.equal(templateNameCompletion([{ ...ranked[0], match: { ...ranked[0].match, method: 'rules', candidate: false, score: 0 } }], 'Exa'), 'mple first');
  assert.equal(templateNameCompletion([{ ...ranked[0], match: { ...ranked[0].match, score: null } }], 'Exa'), 'mple first');
});

test('selecting a template fills saved regimen fields and removes pristine placeholder rows', () => {
  const template = makeTemplate('copy', 1, { medications: [{ ...blankMedication(), name: 'Synthetic medicine', dose: 'Saved dose', frequency: 'Saved frequency', duration: 'Saved duration' }],
    instructions: 'Template patient text', followUp: 'Template follow-up' });
  const draft = { medications: [blankMedication()], instructions: 'Current patient instructions', followUp: 'Current follow-up' };
  const result = fillDraftFromTemplate(draft, template);
  assert.equal(result.draft.medications.length, 1);
  assert.equal(result.draft.medications[0].name, 'Synthetic medicine');
  assert.equal(result.draft.medications[0].dose, 'Saved dose');
  assert.equal(result.draft.medications[0].frequency, 'Saved frequency');
  assert.equal(result.draft.medications[0].duration, 'Saved duration');
  assert.equal(result.draft.instructions, draft.instructions);
  assert.equal(result.draft.followUp, draft.followUp);
  assert.equal(result.copiedIds.length, 1);
  assert.equal(draft.medications[0].name, '');
  const again = fillDraftFromTemplate(result.draft, template);
  assert.equal(again.draft.medications.length, 1);
  assert.deepEqual(again.copiedIds, []);
});

test('selection fills missing fields in existing medicines while preserving entered values and partial rows', () => {
  const template = makeTemplate('copy', 1, { medications: [{ ...blankMedication(), name: 'Synthetic medicine', dose: 'Saved dose', frequency: 'Saved frequency', duration: 'Saved duration' }] });
  const existing = { ...blankMedication(), name: 'synthetic medicine', dose: 'Doctor-entered dose' };
  const partial = { ...blankMedication(), dose: 'Partly written row' };
  const draft = { medications: [existing, partial], instructions: '', followUp: '' };
  const result = fillDraftFromTemplate(draft, template);
  assert.equal(result.draft.medications.length, 2);
  assert.equal(result.draft.medications[0].id, existing.id);
  assert.equal(result.draft.medications[0].dose, 'Doctor-entered dose');
  assert.equal(result.draft.medications[0].frequency, 'Saved frequency');
  assert.equal(result.draft.medications[0].duration, 'Saved duration');
  assert.deepEqual(result.draft.medications[1], partial);
  assert.equal(result.filled, 1);
  assert.deepEqual(result.copiedIds, [existing.id]);
});

test('switching templates replaces previous copied rows, including a different regimen for the same medicine', () => {
  const a = makeTemplate('a', 1, { medications: [{ ...blankMedication(), name: 'Synthetic shared medicine', dose: 'Regimen A', frequency: 'Frequency A' }] });
  const b = makeTemplate('b', 2, { medications: [{ ...blankMedication(), name: 'Synthetic shared medicine', dose: 'Regimen B', frequency: 'Frequency B' }] });
  const manual = { ...blankMedication(), name: 'Independent manual medicine', dose: 'Doctor-entered dose' };
  const draft = { medications: [manual], instructions: 'Current instructions', followUp: 'Current follow-up' };
  const first = fillDraftFromTemplate(draft, a);
  const second = fillDraftFromTemplate(first.draft, b);
  assert.equal(second.replaced, 1);
  assert.equal(second.draft.medications.length, 2);
  assert.deepEqual(second.draft.medications[0], manual);
  assert.equal(second.draft.medications[1].dose, 'Regimen B');
  assert.equal(second.draft.medications[1].frequency, 'Frequency B');
  assert.equal(second.draft.medications[1].source.id, 'b');
  assert.equal(second.draft.instructions, draft.instructions);
  assert.equal(second.draft.followUp, draft.followUp);
  const third = fillDraftFromTemplate(second.draft, makeTemplate('c', 3));
  assert.equal(third.draft.medications.length, 2);
  assert.ok(third.draft.medications.every(row => !row.source || row.source.id === 'c'));
});

test('a second template removes old copied items even if its medicines are already manually present', () => {
  const a = makeTemplate('a', 1);
  const b = makeTemplate('b', 2);
  const manual = { ...b.medications[0], id: 'manual-row', source: undefined };
  const first = fillDraftFromTemplate({ medications: [manual], instructions: '', followUp: '' }, a);
  const second = fillDraftFromTemplate(first.draft, b);
  assert.equal(second.replaced, 1);
  assert.equal(second.copiedIds.length, 0);
  assert.equal(second.draft.medications.length, 1);
  assert.equal(second.draft.medications[0].id, 'manual-row');
});

test('zero percent and unscored templates remain below positive matches across scoring methods', () => {
  const source = [makeTemplate('zero', 10), makeTemplate('best', 1), makeTemplate('middle', 5),
    makeTemplate('general', 1, { factorSnapshot: undefined })];
  const ranked = rankTemplates(source, context, definitions);
  const result = filterTemplateMatches(ranked, '');
  assert.deepEqual(result.map(row => row.template.id), ['best', 'middle', 'zero', 'general']);
  assert.equal(result[2].match.score, 0);
  assert.equal(result[2].match.candidate, false);
  assert.equal(result[3].match.score, null);
  assert.equal(templateNameCompletion(filterTemplateMatches(ranked, 'Example z'), 'Example z'), 'ero');
  assert.equal(templateNameCompletion(filterTemplateMatches(ranked, 'Example g'), 'Example g'), 'eneral');
});

test('a library with no comparable patient factors is still fully searchable and supports name ghosts', () => {
  const ranked = rankTemplates([makeTemplate('first', 1), makeTemplate('second', 2)], { ...context, factorRecords: {} }, definitions);
  const result = filterTemplateMatches(ranked, '');
  assert.equal(result.length, 2);
  assert.ok(result.every(row => row.match.score === null && row.match.candidate === false));
  assert.equal(templateNameCompletion(result, 'Example f'), 'irst');
});

test('percentages distinguish patient similarity from rule coverage and unknown comparisons', () => {
  assert.equal(templateMatchLabel({ method: 'gower', score: 86 }), '86% patient similarity');
  assert.equal(templateMatchLabel({ method: 'rules', score: 75 }), '75% rules matched');
  assert.equal(templateMatchLabel({ method: 'gower', score: null }), 'No comparison available');
});

test('keyboard completion only completes a name; Enter previews, arrows navigate and Escape dismisses', () => {
  const calls = [];
  const event = key => ({ key, preventDefault() { calls.push('prevent'); }, stopPropagation() {} });
  const state = { open: true, active: ranking()[0], completion: 'mple first', atEnd: true, count: 3 };
  const actions = { open: () => calls.push('open'), move: delta => calls.push(delta),
    complete: () => calls.push('name-only'), preview: template => calls.push(`preview:${template.id}`), dismiss: () => calls.push('dismiss') };
  assert.equal(handleTemplateSearchKey(event('Tab'), state, actions), true);
  assert.deepEqual(calls.splice(0), ['prevent', 'name-only']);
  handleTemplateSearchKey(event('Enter'), state, actions);
  assert.deepEqual(calls.splice(0), ['prevent', 'preview:first']);
  handleTemplateSearchKey(event('ArrowDown'), state, actions);
  handleTemplateSearchKey(event('ArrowUp'), state, actions);
  assert.deepEqual(calls.splice(0), ['prevent', 'open', 1, 'prevent', 'open', -1]);
  handleTemplateSearchKey(event('Escape'), state, actions);
  assert.deepEqual(calls.splice(0), ['prevent', 'dismiss']);

  for (const [e, s] of [
    [{ ...event('Tab'), shiftKey: true }, state], [{ ...event('Tab'), isComposing: true }, state],
    [{ ...event('Tab'), nativeEvent: { isComposing: true } }, state], [{ ...event('Tab'), ctrlKey: true }, state],
    [event('Tab'), { ...state, atEnd: false }], [event('Tab'), { ...state, completion: '' }],
    [event('Enter'), { ...state, open: false }],
  ]) assert.equal(handleTemplateSearchKey(e, s, actions), false);
  assert.deepEqual(calls, []);
  assert.equal(handleTemplateSearchKey(event('Enter'), { ...state, loading: true }, actions), true);
  assert.deepEqual(calls, ['prevent', 'preview:first']);
});

test('search records exactly the filtered candidates in model order with their original scores', async () => {
  const ranked = ranking();
  let recordedRows;
  const result = await runTemplateSearch({ ranked, query: 'medicine', factorSnapshot: factors(1), isCurrent: () => true,
    evaluate: async payload => {
      assert.deepEqual(payload, { factorSnapshot: factors(1) });
      return { eventId: 'synthetic-event', candidates: [{ id: 'third' }, { id: 'first' }] };
    },
    recordDisplayed: async (id, rows) => { assert.equal(id, 'synthetic-event'); recordedRows = rows; return { candidates: rows }; },
  });
  assert.deepEqual(result.matches.map(row => row.template.id), ['first', 'second', 'third']);
  assert.equal(result.matches[1].reviewOnly, true);
  assert.equal(result.matches[0].reviewOnly, false);
  assert.deepEqual(recordedRows.map(row => row.score), [ranked[0].match.score, ranked[2].match.score]);
  assert.deepEqual(result.event.candidates, recordedRows);
});

test('outdated evaluations are discarded before recording and outdated display responses are discarded', async () => {
  let active = true, resolveEvaluation, records = 0;
  const options = { ranked: ranking(), query: '', isCurrent: () => active,
    evaluate: () => new Promise(resolve => { resolveEvaluation = resolve; }),
    recordDisplayed: async () => { records++; return { candidates: [] }; },
  };
  const pending = runTemplateSearch(options);
  active = false;
  resolveEvaluation({ eventId: 'old', candidates: [{ id: 'first' }] });
  assert.equal(await pending, null);
  assert.equal(records, 0);

  active = true;
  const lateDisplay = await runTemplateSearch({ ...options,
    evaluate: async () => ({ eventId: 'old-display', candidates: [{ id: 'first' }] }),
    recordDisplayed: async () => { active = false; return { candidates: [] }; },
  });
  assert.equal(lateDisplay, null);
});

test('displayed result count is bounded and API failures propagate for retry', async () => {
  const best = ranking()[0];
  const ranked = Array.from({ length: TEMPLATE_SEARCH_CONFIG.maxResults + 2 }, (_, i) => ({
    ...best, template: makeTemplate(`item-${i}`, 1),
  }));
  const options = { ranked, query: '', isCurrent: () => true,
    evaluate: async () => ({ eventId: 'example', candidates: ranked.map(row => ({ id: row.template.id })) }),
    recordDisplayed: async (id, rows) => ({ candidates: rows }),
  };
  const result = await runTemplateSearch(options);
  assert.equal(result.matches.length, TEMPLATE_SEARCH_CONFIG.maxResults);
  await assert.rejects(runTemplateSearch({ ...options, evaluate: async () => { throw new Error('synthetic failure'); } }), /synthetic failure/);
});
