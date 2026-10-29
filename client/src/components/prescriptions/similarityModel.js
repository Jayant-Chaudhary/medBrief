/**
 * Non-parametric mixed-data nearest-neighbour retrieval. No outcome labels or
 * generated clinical recommendations. Numeric ranges are fitted on references,
 * never on the current patient. See SIMILARITY_MODEL.md for the scoring contract.
 */
export const SIMILARITY_MODEL_VERSION = 'gower-coverage-v1';
export const GHOST_POLICY = Object.freeze({ minCompared: 3, minCoverage: 0.6, minScore: 70, minMargin: 5 });
const norm = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
export const normalizeSimilarityUnit = value => norm(value).replaceAll('μ','u').replaceAll('µ','u').replaceAll(' ','').replace(/^miu\/l$/, 'uiu/ml');
const UNKNOWN_LABELS = new Set(['unknown','not tested','not assessed','not recorded','not available']);
const safeFactorId = id => /^[a-zA-Z0-9_.:-]+$/.test(id) && !['__proto__','constructor','prototype'].includes(id);
const hasValue = record => record && record.value !== null && record.value !== undefined && String(record.value).trim() !== '' && record.needsReview !== true && record.confirmed !== false && record.stale !== true;
function observation(record, definition) {
  if (!hasValue(record) || definition?.enabled === false || definition?.autoReuse === false || record.autoReuse === false) return null;
  const type = record.type || definition?.type;
  if (type === 'number') {
    const value = Number(record.value);
    if (!Number.isFinite(value)) return null;
    return { type, value, unit: record.unit ?? definition?.unit ?? '', label: definition?.label || record.label || '', recordedAt: record.recordedAt || '' };
  }
  if (type === 'select' || type === 'categorical') {
    if (UNKNOWN_LABELS.has(norm(record.value))) return null;
    if (definition?.options && !definition.options.includes(String(record.value))) return null;
    return { type: 'select', value: String(record.value), unit: '', label: definition?.label || record.label || '', recordedAt: record.recordedAt || '' };
  }
  return null;
}
export function referenceFeatures(template, definitions = []) {
  const schema = new Map(definitions.map(item => [item.id, item]));
  const features = {};
  if (template.factorSnapshot && typeof template.factorSnapshot === 'object') {
    for (const [id, record] of Object.entries(template.factorSnapshot)) {
      if (!safeFactorId(id)) continue;
      const value = observation(record, schema.get(id));
      if (value) features[id] = value;
    }
  } else if (template.autoCapture) {
    // Compatibility with automatically captured cases from before snapshots.
    for (const rule of template.factorRules || []) {
      if (rule.operator !== 'equals' || rule.required !== false) continue;
      if (!safeFactorId(rule.factorId)) continue;
      const value = observation({ value: rule.value, unit: rule.unit, type: rule.valueType, label: rule.label }, schema.get(rule.factorId));
      if (value) features[rule.factorId] = value;
    }
  }
  return features;
}
export function fitSimilarityModel(templates, definitions = [], { excludeTemplateIds = [], weights = {} } = {}) {
  const excluded = new Set(excludeTemplateIds);
  const eligible = templates.filter(template => !excluded.has(template.id) && !template.archived && (!template.autoCapture || template.autoCapture.stage === 'visit-completed'));
  const ranges = {}, featureIds = new Set();
  const references = eligible.map(template => {
    const features = referenceFeatures(template, definitions);
    for (const [id, record] of Object.entries(features)) {
      featureIds.add(id);
      if (record.type !== 'number') continue;
      const key = JSON.stringify([id, normalizeSimilarityUnit(record.unit)]);
      const stats = ranges[key] || { min: record.value, max: record.value, count: 0 };
      stats.min = Math.min(stats.min, record.value); stats.max = Math.max(stats.max, record.value); stats.count++;
      ranges[key] = stats;
    }
    return { template, features };
  });
  const featureWeights = {};
  for (const id of featureIds) featureWeights[id] = Number.isFinite(weights[id]) && weights[id] > 0 ? weights[id] : 1;
  return { version: SIMILARITY_MODEL_VERSION, method: 'gower', references, featureIds: [...featureIds].sort(), ranges, weights: featureWeights, definitions };
}
export function scoreSimilarity(model, reference, context, ruleMatch) {
  const source = reference.features;
  if (!Object.keys(source).length) {
    // A manually defined rule template is not a historical patient observation.
    return { ...ruleMatch, method: 'rules', rawSimilarity: null, coverage: ruleMatch.total ? ruleMatch.checked / ruleMatch.total : 0, compared: ruleMatch.checked, featureCount: ruleMatch.total, modelVersion: model.version, similarityDetails: [], candidate: ruleMatch.candidate, suggested: ruleMatch.suggested };
  }
  const schema = new Map(model.definitions.map(item => [item.id, item]));
  const details = [];
  let comparedWeight = 0, totalWeight = 0, contribution = 0, compared = 0;
  for (const id of model.featureIds) {
    const weight = model.weights[id]; totalWeight += weight;
    const expected = source[id];
    const actual = observation(context.factorRecords?.[id], schema.get(id));
    let reason = '', similarity = null, range = null;
    if (!expected) reason = 'Missing from reference';
    else if (!actual) reason = 'Missing or unverified in patient';
    else if (expected.type !== actual.type) reason = 'Different data types';
    else if (expected.type === 'number' && normalizeSimilarityUnit(expected.unit) !== normalizeSimilarityUnit(actual.unit)) reason = 'Incompatible units';
    else if (expected.type === 'number') {
      const stats = model.ranges[JSON.stringify([id, normalizeSimilarityUnit(expected.unit)])];
      range = stats ? stats.max - stats.min : 0;
      similarity = range > 0 ? Math.max(0, 1 - Math.abs(actual.value - expected.value) / range) : Number(actual.value === expected.value);
      if (!range) reason = 'No observed numeric spread; exact comparison only';
    } else similarity = Number(norm(actual.value) === norm(expected.value));
    if (similarity !== null) { compared++; comparedWeight += weight; contribution += weight * similarity; }
    details.push({ factorId: id, label: schema.get(id)?.label || expected?.label || actual?.label || id, expected: expected?.value ?? null, actual: actual?.value ?? null, unit: expected?.unit || actual?.unit || '', patientDate: actual?.recordedAt || '', referenceDate: expected?.recordedAt || '', similarity, reason, range });
  }
  const rawSimilarity = comparedWeight ? contribution / comparedWeight : null;
  const coverage = totalWeight ? comparedWeight / totalWeight : 0;
  const supported = rawSimilarity === null ? null : rawSimilarity * coverage;
  const mandatoryUnknown = ruleMatch.checks.some(check => check.required && check.status === 'unknown');
  const candidate = !ruleMatch.conflicts.length && compared > 0 && rawSimilarity > 0;
  return { ...ruleMatch, supportedSimilarity: supported, method: 'gower', score: supported === null ? null : Math.round(100 * supported), rawSimilarity, coverage, compared, featureCount: model.featureIds.length, similarityDetails: details, modelVersion: model.version, candidate, suggested: candidate && !mandatoryUnknown };
}
export function rankSimilarityModel(model, context, evaluateRules) {
  return model.references.map(reference => ({ template: reference.template, match: scoreSimilarity(model, reference, context, evaluateRules(reference.template, context)) }))
    .sort((a,b) => Number(a.match.conflicts.length > 0) - Number(b.match.conflicts.length > 0) ||
      Number(b.match.method === 'gower') - Number(a.match.method === 'gower') ||
      (b.match.supportedSimilarity ?? (b.match.score ?? -1) / 100) - (a.match.supportedSimilarity ?? (a.match.score ?? -1) / 100) || b.match.compared - a.match.compared ||
      String(a.template.id).localeCompare(String(b.template.id)));
}
const itemIdentity = row => norm(row.name);
const regimen = template => JSON.stringify((template.medications || []).map(row => [itemIdentity(row),norm(row.strength),norm(row.dose),norm(row.route),norm(row.frequency),norm(row.duration),row.kind || 'medicine']).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b))));
export function selectGhostSuggestion(ranked, draft, policy = GHOST_POLICY) {
  const candidates = ranked.filter(item => item.match.candidate);
  const best = candidates[0];
  if (!best || best.match.method !== 'gower') return { suggestion: null, reason: 'Comparable recorded cases are needed for a ghost suggestion.' };
  const match = best.match;
  if (!match.suggested || match.compared < policy.minCompared || match.coverage < policy.minCoverage || match.supportedSimilarity * 100 < policy.minScore) return { suggestion: null, reason: 'More comparable factors or a stronger match are needed for a ghost suggestion.' };
  const alternative = candidates.slice(1).find(item => item.match.method === 'gower' && regimen(item.template) !== regimen(best.template));
  if (alternative && (best.match.supportedSimilarity - alternative.match.supportedSimilarity) * 100 < policy.minMargin) return { suggestion: null, reason: 'Top prescriptions are similarly ranked. Review the options before choosing.' };
  const existing = new Set(draft.medications.map(itemIdentity).filter(Boolean));
  const medication = best.template.medications.find(row => row.name?.trim() && !existing.has(itemIdentity(row)));
  if (!medication) return { suggestion: null, reason: 'The best match has no additional medicine items.' };
  return { suggestion: { ...best, medication, key: `${best.template.id}:${best.template.version}:${medication.id}:${match.score}:${match.compared}` }, reason: '' };
}
export function acceptGhostItem(draft, suggestion) {
  if (!suggestion) return draft;
  if (draft.medications.some(row => itemIdentity(row) === itemIdentity(suggestion.medication))) return draft;
  const item = { ...suggestion.medication, id: crypto.randomUUID(), source: { id: suggestion.template.id, version: suggestion.template.version, name: suggestion.template.name } };
  const empty = draft.medications.findIndex(row => ['name','strength','dose','route','frequency','duration','instructions'].every(key => !String(row[key] || '').trim()));
  return { ...draft, medications: empty < 0 ? [...draft.medications, item] : draft.medications.map((row,index) => index === empty ? item : row) };
}
/** Versioned, narrow handoff for the independent data pipeline. */
export function validateSimilarityDataset(payload) {
  if (!payload || payload.schemaVersion !== 1 || !Array.isArray(payload.templates)) return { ok: false, error: 'Expected schemaVersion: 1 and a templates array.' };
  const ids = new Set();
  for (const template of payload.templates) {
    if (!template || typeof template.id !== 'string' || ids.has(template.id) || template.status !== 'completed' || !template.factorSnapshot || Array.isArray(template.factorSnapshot) || typeof template.factorSnapshot !== 'object' || !Array.isArray(template.medications)) return { ok: false, error: 'Templates require unique IDs, completed status, a factorSnapshot and medication items.' };
    ids.add(template.id);
    if (template.name !== undefined && typeof template.name !== 'string') return { ok: false, error: 'Template names must be strings.' };
    for (const [id,record] of Object.entries(template.factorSnapshot)) {
      if (!safeFactorId(id)) return { ok: false, error: 'Invalid factor identifier.' };
      if (!record || !['number','select'].includes(record.type) || typeof record.unit !== 'string' || typeof record.confirmed !== 'boolean' || (record.value !== null && !['number','string'].includes(typeof record.value)) || (record.type === 'number' && record.value !== null && (String(record.value).trim() === '' || !Number.isFinite(Number(record.value))))) return { ok: false, error: 'Factor records need a valid type, value, unit and explicit confirmed flag; null means unknown.' };
    }
    for (const item of template.medications) if (!item || typeof item.name !== 'string' || !item.name.trim() || ['strength','dose','route','frequency','duration'].some(key => typeof item[key] !== 'string') || (item.instructions !== undefined && typeof item.instructions !== 'string') || (item.kind !== undefined && !['medicine','injection','vaccination'].includes(item.kind))) return { ok: false, error: 'Medication items need a name and explicit structured fields.' };
  }
  return { ok: true, error: '' };
}
export const emptyMedicationRow = row => ['name','strength','dose','route','frequency','duration','instructions'].every(key => !String(row[key] || '').trim());
/** Tab accepts only in a completely empty item; Shift+Tab and composition keep native behavior. */
export function handleGhostKey(event, row, suggestion, accept, dismiss) {
  if (!suggestion || !emptyMedicationRow(row) || event.isComposing || event.defaultPrevented) return false;
  if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
    event.preventDefault(); accept(); return true;
  }
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); dismiss(); return true;
  }
  return false;
}
