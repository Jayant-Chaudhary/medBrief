import { fitSimilarityModel, rankSimilarityModel, validateSimilarityDataset } from './similarityModel.js';
import { evaluateFactorRule } from './factorModel.js';
const normalize = value => String(value ?? '').trim().toLowerCase();
export const tags = value => [...new Set(String(value ?? '').split(',').map(normalize).filter(Boolean))];
export const blankMedication = () => ({ id: crypto.randomUUID(), name: '', strength: '', dose: '', route: '', frequency: '', duration: '', instructions: '', kind: 'medicine' });
export const blankDraft = () => ({ medications: [], instructions: '', followUp: '' });
export const blankTemplate = () => ({ id: crypto.randomUUID(), version: 1, name: '', purpose: '', required: '', optional: '', exclusions: '', minAge: '', maxAge: '', pregnancy: '', medications: [], instructions: '', followUp: '', archived: false, factorRules: [] });
export const medicationFields = ['name', 'strength', 'dose', 'route', 'frequency', 'duration', 'instructions'];
export function templateFromDraft(draft) {
  return { ...blankTemplate(), medications: draft.medications.map(row => Object.fromEntries(['id', ...medicationFields].map(key => [key, row[key] || '']).concat([['kind', row.kind || 'medicine']]))), instructions: draft.instructions, followUp: draft.followUp };
}
/** Read existing structured records only; never infer diagnoses from notes or lab values. */
export function buildPatientContext(patient = {}, appointment = {}) {
  const available = [];
  const conditions = Array.isArray(patient.confirmedConditions) ? patient.confirmedConditions.filter(value => typeof value === 'string') : [];
  const absent = Array.isArray(patient.confirmedAbsentFactors) ? patient.confirmedAbsentFactors.filter(value => typeof value === 'string') : [];
  const factors = conditions.join(', ');
  const age = patient.age !== null && patient.age !== undefined && String(patient.age).trim() !== '' && Number.isFinite(Number(patient.age)) && Number(patient.age) >= 0 ? String(patient.age) : '';
  const purpose = typeof appointment.purpose === 'string' ? appointment.purpose : '';
  const pregnancy = typeof patient.pregnancyStage === 'string' ? patient.pregnancyStage : '';
  if (age) available.push({ label: 'Age', value: age + ' years', source: 'Patient profile' });
  if (purpose) available.push({ label: 'Purpose', value: purpose, source: 'Visit record' });
  if (pregnancy) available.push({ label: 'Pregnancy stage', value: pregnancy, source: 'Patient record' });
  if (conditions.length) available.push({ label: 'Confirmed factors', value: conditions.join(', '), source: 'Patient record' });
  if (absent.length) available.push({ label: 'Confirmed absent', value: absent.join(', '), source: 'Patient record' });
  return { age, purpose, pregnancy, factors, absentFactors: absent.join(', '), available };
}

/** Equal-weight criteria coverage, not a clinical probability. Unknowns earn no points. */
export function evaluateTemplate(template, context) {
  const factors = tags(context.factors);
  const absent = tags(context.absentFactors);
  const checks = [];
  const add = (label, status, required = true) => checks.push({ label, status, required });
  for (const factor of tags(template.required)) {
    add(`Required factor: ${factor}`, factors.includes(factor) ? 'matched' : absent.includes(factor) ? 'conflict' : 'unknown');
  }
  for (const factor of tags(template.optional).filter(factor => !tags(template.required).includes(factor))) {
    add(`Factor: ${factor}`, factors.includes(factor) ? 'matched' : absent.includes(factor) ? 'different' : 'unknown', false);
  }
  for (const factor of tags(template.exclusions)) {
    add(`Excluded factor: ${factor}`, factors.includes(factor) ? 'conflict' : absent.includes(factor) ? 'matched' : 'unknown');
  }
  if (template.purpose.trim()) add('Consultation purpose', !context.purpose?.trim() ? 'unknown' : normalize(context.purpose) === normalize(template.purpose) ? 'matched' : 'conflict');
  if (template.pregnancy) add('Pregnancy stage', !context.pregnancy ? 'unknown' : context.pregnancy === template.pregnancy ? 'matched' : 'conflict');
  if (template.minAge !== '' || template.maxAge !== '') {
    const known = context.age !== '' && context.age != null && Number.isFinite(Number(context.age)) && Number(context.age) >= 0;
    const outside = known && ((template.minAge !== '' && Number(context.age) < Number(template.minAge)) || (template.maxAge !== '' && Number(context.age) > Number(template.maxAge)));
    add(outside ? 'Age outside template range' : 'Age', !known ? 'unknown' : outside ? 'conflict' : 'matched');
  }
  const uniqueRules = new Map((template.factorRules || []).map(rule => [JSON.stringify([rule.factorId, rule.operator, rule.value, rule.unit]), rule]));
  for (const rule of uniqueRules.values()) {
    const comparison = { equals: '=', min: '>=', max: '<=' }[rule.operator];
    const status = evaluateFactorRule(rule, context);
    add(`${rule.label} ${comparison} ${rule.value}${rule.unit ? ' ' + rule.unit : ''}`, status === 'conflict' && rule.required === false ? 'different' : status, rule.required !== false);
  }
  const matched = checks.filter(check => check.status === 'matched').map(check => check.label);
  const missing = checks.filter(check => check.status === 'unknown').map(check => check.label);
  const conflicts = checks.filter(check => check.status === 'conflict').map(check => check.label);
  const total = checks.length;
  const score = total ? Math.round(matched.length / total * 100) : null;
  const blocked = template.archived || conflicts.length > 0 || (template.autoCapture && template.autoCapture.stage !== 'visit-completed');
  return {
    checks, matched, missing, conflicts, score, total,
    checked: total - missing.length,
    candidate: !blocked && matched.length > 0,
    suggested: !blocked && matched.length > 0 && !checks.some(check => check.required && check.status === 'unknown'),
  };
}

export function rankTemplates(templates, context, definitions = [], options = {}) {
  const model = fitSimilarityModel(templates, definitions, options);
  return rankSimilarityModel(model, context, evaluateTemplate);
}
/** Adapt the agreed template JSON without requiring changes to the data pipeline. */
export function templatesFromDataset(payload) {
  const validation = validateSimilarityDataset(payload);
  if (!validation.ok) throw new Error(validation.error);
  return payload.templates.map((template, index) => ({
    ...blankTemplate(),
    id: template.id,
    name: template.name || `Historical prescription ${index + 1}`,
    version: Number.isInteger(template.version) ? template.version : 1,
    factorSnapshot: structuredClone(template.factorSnapshot),
    medications: template.medications.map((item, i) => ({ ...blankMedication(), ...item, id: item.id || `${template.id}-item-${i}` })),
    updatedAt: template.updatedAt || '',
  }));
}
const medicationIdentity = row => normalize(row.name);
export function applyTemplate(draft, template, selectedIds, includeInstructions, includeFollowUp) {
  const selected = new Set(selectedIds);
  const names = new Set(draft.medications.map(medicationIdentity).filter(Boolean));
  let skipped = 0;
  const additions = [];
  for (const row of template.medications) {
    if (!selected.has(row.id)) continue;
    if (names.has(medicationIdentity(row))) { skipped++; continue; }
    names.add(medicationIdentity(row));
    additions.push({ ...row, id: crypto.randomUUID(), source: { id: template.id, version: template.version, name: template.name } });
  }
  const append = (current, next) => !next || current.split('\n\n').includes(next) ? current : [current, next].filter(Boolean).join('\n\n');
  return { draft: { ...draft, medications: [...draft.medications, ...additions], instructions: includeInstructions ? append(draft.instructions, template.instructions) : draft.instructions, followUp: includeFollowUp ? append(draft.followUp, template.followUp) : draft.followUp }, skipped, added: additions.length };
}
export function storageKeys(ownerId, patientId, appointmentId) {
  const owner = encodeURIComponent(ownerId);
  return { library: `medbrief.rx.templates.v1.${owner}`, draft: `medbrief.rx.draft.v1.${owner}.${encodeURIComponent(patientId)}.${encodeURIComponent(appointmentId)}` };
}
export function readLocal(key, fallback, validate) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return { value: fallback, error: '' };
    const value = JSON.parse(raw);
    if (!validate(value)) throw new Error('Invalid saved data');
    return { value, error: '' };
  } catch { return { value: fallback, error: 'Saved data could not be read. It has been preserved; writing is paused for this record.' }; }
}
export function validMedication(row) { return row && typeof row.id === 'string' && medicationFields.every(key => typeof row[key] === 'string'); }
export function validDraft(value) { return value && Array.isArray(value.medications) && value.medications.every(validMedication) && typeof value.instructions === 'string' && typeof value.followUp === 'string'; }
function validRules(value) { return value === undefined || Array.isArray(value) && value.every(rule => rule && ['factorId','label','value','unit'].every(key => typeof rule[key] === 'string') && ['equals','min','max'].includes(rule.operator)); }
export function validLibrary(value) { return Array.isArray(value) && value.every(row => validDraft(row) && typeof row.id === 'string' && Number.isInteger(row.version) && validRules(row.factorRules) && ['name','purpose','required','optional','exclusions','minAge','maxAge','pregnancy'].every(key => typeof row[key] === 'string') && typeof row.archived === 'boolean'); }
/** One automatic reusable copy per visit. No patient identity or free-text notes are copied. */
export function autoTemplateId(visitId) {
  return 'auto-visit-' + encodeURIComponent(visitId);
}
export function capturePrescriptionTemplate(previous, draft, context, visitId, completed, now = new Date().toISOString()) {
  const medications = draft.medications.filter(row => row.name.trim()).map(row => ({
    id: row.id,
    name: row.name.trim(), strength: row.strength.trim(), dose: row.dose.trim(),
    route: row.route.trim(), frequency: row.frequency.trim(), duration: row.duration.trim(),
    kind: row.kind || 'medicine', instructions: '',
  }));
  if (!medications.length) {
    if (!previous || previous.autoCapture?.empty) return previous || null;
    return { ...previous, archived: true, updatedAt: now, autoCapture: { ...previous.autoCapture, empty: true, stage: 'draft' } };
  }
  // Snapshot only structured fields. Observed similarity is not a contraindication rule.
  const factorRules = Object.entries(context.factorRecords || {})
    .filter(([,record]) => record.autoReuse !== false && ['number','select'].includes(record.type))
    .map(([factorId,record]) => ({ factorId, label: record.label, unit: record.unit || '', operator: 'equals', value: String(record.value), required: false }));
  const factorSnapshot = Object.fromEntries(Object.entries(context.factorRecords || {})
    .filter(([, record]) => record.autoReuse !== false && record.needsReview !== true && record.confirmed !== false && ['number','select'].includes(record.type))
    .map(([id, record]) => [id, { type: record.type, value: record.value, unit: record.unit || '', label: record.label || id, recordedAt: record.recordedAt || '', confirmed: true }]));
  const stage = completed ? 'visit-completed' : 'draft';
  const signature = JSON.stringify({ medications, factorRules, factorSnapshot, stage });
  if (previous?.autoCapture?.signature === signature && !previous.autoCapture.empty) return previous;
  const title = medications.slice(0,2).map(row => row.name).join(' + ') + (medications.length > 2 ? ` + ${medications.length - 2} more` : '');
  return {
    ...blankTemplate(), ...previous,
    id: autoTemplateId(visitId),
    name: previous?.autoCapture?.customized ? previous.name : title.slice(0,100),
    version: previous ? previous.version + 1 : 1,
    medications,
    factorSnapshot,
    // Never copy consultation notes, patient instructions or follow-up text automatically.
    instructions: previous?.autoCapture?.customized ? previous.instructions : '',
    followUp: previous?.autoCapture?.customized ? previous.followUp : '',
    factorRules: previous?.autoCapture?.customized ? previous.factorRules : factorRules,
    archived: previous?.autoCapture?.empty ? false : previous?.archived || false,
    updatedAt: now,
    autoCapture: { signature, stage, empty: false, customized: previous?.autoCapture?.customized || false },
  };
}
