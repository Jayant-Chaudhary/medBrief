import { TEMPLATE_SEARCH_CONFIG } from './prescriptionConfig.js';
import { applyTemplate } from './templateModel.js';
import { emptyMedicationRow } from './similarityModel.js';

const normalize = value => String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase();

// Filter an already fitted ranking: typing must never refit numeric ranges or change scores.
export function filterTemplateMatches(ranked, query, allowedIds) {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return ranked.filter(({ template, match }) => {
    if (template.status !== 'active' || template.archived ||
      (template.autoCapture && template.autoCapture.stage !== 'visit-completed') ||
      (allowedIds && !allowedIds.has(template.id))) return false;
    const searchable = normalize([template.name, template.purpose, template.required, template.optional,
      ...template.medications.map(item => item.name)].join(' '));
    return terms.every(term => searchable.includes(term));
  }).sort((a, b) => Number(a.match.conflicts.length > 0) - Number(b.match.conflicts.length > 0) ||
    (b.match.score ?? -1) - (a.match.score ?? -1));
}

export function templateMatchLabel(match) {
  if (match.score == null) return 'No comparison available';
  return `${match.score}% ${match.method === 'gower' ? 'patient similarity' : 'rules matched'}`;
}

export function templateNameCompletion(ranked, query) {
  // Completing a saved name is navigation, independent of clinical recommendation thresholds.
  const top = ranked[0];
  if (!top || query !== query.trim()) return '';
  const name = top.template.name;
  if (!normalize(name).startsWith(normalize(query)) || query.length >= name.length) return '';
  return name.slice(query.length);
}

// Copy saved regimen fields into the editor, retaining doctor-entered values and free text.
export function fillDraftFromTemplate(draft, template, { selectedIds = template.medications.map(row => row.id), includeInstructions = false, includeFollowUp = false } = {}) {
  const retained = draft.medications.filter(row => !row.source?.id || row.source.id === template.id || row.source.preserveOnTemplateSwitch);
  const replaced = draft.medications.length - retained.length;
  const result = applyTemplate({ ...draft, medications: retained }, template, selectedIds, includeInstructions, includeFollowUp);
  const beforeIds = new Set(draft.medications.map(row => row.id));
  const copiedIds = new Set(result.draft.medications.filter(row => !beforeIds.has(row.id)).map(row => row.id));
  let filled = 0;
  const fields = ['ingredientKey', 'strength', 'dose', 'frequency', 'duration', 'route', 'instructions'];
  const medications = result.draft.medications.map(row => {
    if (copiedIds.has(row.id) || !row.name?.trim()) return row;
    const saved = template.medications.find(item => selectedIds.includes(item.id) && normalize(item.name) === normalize(row.name));
    if (!saved) return row;
    const additions = Object.fromEntries(fields.filter(key => !String(row[key] || '').trim() && String(saved[key] || '').trim()).map(key => [key, saved[key]]));
    if (!Object.keys(additions).length) return row;
    filled++; copiedIds.add(row.id);
    return { ...row, ...additions, source: row.source || { id: template.id, version: template.version, name: template.name, preserveOnTemplateSwitch: true } };
  }).filter(row => !copiedIds.size || !emptyMedicationRow(row));
  return { ...result, draft: { ...result.draft, medications }, replaced, filled, copiedIds: [...copiedIds] };
}

// Keep template-name completion and opening a preview separate from prescription mutation.
export function handleTemplateSearchKey(event, state, actions) {
  if (event.defaultPrevented || event.isComposing || event.nativeEvent?.isComposing || state.composing || event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.key === 'Escape') {
    if (state.open) { event.preventDefault(); event.stopPropagation(); }
    actions.dismiss(); return true;
  }
  if (event.key === 'Tab' && !event.shiftKey && state.completion && state.atEnd) {
    event.preventDefault(); actions.complete(); return true;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault(); actions.open();
    if (state.open && state.count) actions.move(event.key === 'ArrowDown' ? 1 : -1);
    return true;
  }
  if (event.key === 'Enter' && state.open && state.active) {
    event.preventDefault(); actions.preview(state.active.template); return true;
  }
  return false;
}

export function displayedTemplateCandidate({ template, match }) {
  return {
    id: template.id, score: match.score ?? 0, method: match.method,
    coverage: match.coverage ?? 1, compared: match.compared ?? match.checked ?? 0,
    featureCount: match.featureCount ?? match.total ?? 0,
    rationale: match.method === 'gower'
      ? `${match.compared}/${match.featureCount} recorded factors compared.`
      : `${match.matched.length}/${match.total} configured criteria matched.`,
  };
}

// Dependency injection keeps race/eligibility/feedback behavior testable without a live patient API.
export async function runTemplateSearch({ ranked, query, factorSnapshot, evaluate, recordDisplayed, isCurrent }) {
  const result = await evaluate({ factorSnapshot });
  if (!isCurrent()) return null;
  const allowedIds = new Set(result.candidates.map(candidate => candidate.id));
  const matches = filterTemplateMatches(ranked, query).slice(0, TEMPLATE_SEARCH_CONFIG.maxResults);
  // All active templates can be browsed. Only server-eligible entries belong to this feedback event.
  const recorded = await recordDisplayed(result.eventId, matches.filter(({ template }) => allowedIds.has(template.id)).map(displayedTemplateCandidate));
  if (!isCurrent()) return null;
  return { event: { ...result, candidates: recorded.candidates }, matches: matches.map(row => ({
    ...row, reviewOnly: !allowedIds.has(row.template.id),
  })) };
}
