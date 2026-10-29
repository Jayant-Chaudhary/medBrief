import { MATERNITY_FACTORS, maternityFactorValues } from './maternityFactors.js';
﻿/** Starter data fields, not a universal prescribing checklist or diagnostic rules. */
export const FACTOR_SOURCES = {
  antenatal: { title: 'NICE NG201: antenatal assessment', url: 'https://www.nice.org.uk/guidance/ng201/chapter/recommendations' },
  medicines: { title: 'NICE NG5: medicines and allergy reconciliation', url: 'https://www.nice.org.uk/guidance/ng5/chapter/Recommendations' },
  diabetes: { title: 'NICE NG3: diabetes in pregnancy', url: 'https://www.nice.org.uk/guidance/ng3/chapter/Recommendations' },
  hypertension: { title: 'NICE NG133: hypertension in pregnancy', url: 'https://www.nice.org.uk/guidance/ng133/chapter/recommendations' },
  thyroid: { title: 'RCOG: thyroid disorders in pregnancy', url: 'https://www.rcog.org.uk/guidance/browse-all-guidance/green-top-guidelines/management-of-thyroid-disorders-in-pregnancy-no-76/' },
  infections: { title: 'WHO: HIV, syphilis and hepatitis B in pregnancy', url: 'https://www.who.int/teams/global-hiv-hepatitis-and-stis-programmes/populations/pregnant-and-lactating-women-and-girls' },
  vaccination: { title: 'CDC: vaccination records in pregnancy', url: 'https://www.cdc.gov/vaccines-pregnancy/recommended-vaccines/' },
};
const yesNo = ['Yes', 'No'];
const f = (id, label, group, type, extra = {}) => ({ id, label, group, type, unit: '', enabled: true, custom: false, reference: 'antenatal', ...extra });
export const FACTOR_GROUPS = ['Prescription checks', 'Pregnancy & history', 'Report measurements', 'Infection & prevention', 'Maternity card', 'Scans & vaccinations', 'Delivery & postnatal', 'Custom factors'];
export const DEFAULT_FACTORS = [
  f('age', 'Age', 'Prescription checks', 'number', { unit: 'years', profile: 'age' }),
  f('purpose', 'Consultation purpose / indication', 'Prescription checks', 'text', { appointment: 'purpose', reference: 'medicines' }),
  f('allergy_status', 'Drug allergy status', 'Prescription checks', 'select', { options: ['No known drug allergies', 'Allergy reported'], reference: 'medicines' }),
  f('allergy_details', 'Allergy and reaction details', 'Prescription checks', 'text', { reference: 'medicines' }),
  f('current_medicines', 'Current medicines, supplements and recent injections', 'Prescription checks', 'text', { reference: 'medicines' }),
  f('diabetes_status', 'Confirmed diabetes status', 'Prescription checks', 'select', { options: ['No diagnosed diabetes', 'Type 1 diabetes', 'Type 2 diabetes', 'Gestational diabetes', 'Other diabetes'], reference: 'diabetes' }),
  f('hypertension_status', 'Confirmed hypertension status', 'Prescription checks', 'select', { options: ['No diagnosed hypertension', 'Chronic hypertension', 'Gestational hypertension', 'Pre-eclampsia'], reference: 'hypertension' }),
  f('thyroid_status', 'Confirmed thyroid disease', 'Prescription checks', 'select', { options: ['No diagnosed thyroid disease', 'Hypothyroidism', 'Hyperthyroidism', 'Other thyroid disease'], reference: 'thyroid' }),
  f('kidney_disease', 'Known kidney disease', 'Prescription checks', 'select', { options: yesNo, reference: 'hypertension' }),
  f('liver_disease', 'Known liver disease', 'Prescription checks', 'select', { options: yesNo, reference: 'hypertension' }),
  f('pregnancy_stage', 'Pregnancy / postnatal stage', 'Pregnancy & history', 'select', { profile: 'pregnancyStage', options: ['Not pregnant', 'First trimester', 'Second trimester', 'Third trimester', 'Postnatal'] }),
  f('gestation_weeks', 'Gestational age', 'Pregnancy & history', 'number', { unit: 'weeks' }),
  f('breastfeeding', 'Breastfeeding', 'Pregnancy & history', 'select', { options: yesNo, reference: 'medicines' }),
  f('weight', 'Weight', 'Pregnancy & history', 'number', { unit: 'kg', metrics: ['weight'] }),
  f('height', 'Height', 'Pregnancy & history', 'number', { unit: 'cm', metrics: ['height'] }),
  f('booking_bmi', 'Booking BMI', 'Pregnancy & history', 'number', { unit: 'kg/m2' }),
  f('blood_group', 'Blood group and RhD status', 'Pregnancy & history', 'select', { profile: 'bloodType', options: ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'] }),
  f('antibody_screen', 'Red-cell antibody screen', 'Pregnancy & history', 'select', { options: ['Negative', 'Positive', 'Indeterminate'] }),
  f('obstetric_history', 'Previous pregnancy outcomes / complications', 'Pregnancy & history', 'text'),
  f('previous_gdm', 'Previous gestational diabetes', 'Pregnancy & history', 'select', { options: yesNo, reference: 'diabetes' }),
  f('previous_preeclampsia', 'Previous pre-eclampsia', 'Pregnancy & history', 'select', { options: yesNo, reference: 'hypertension' }),
  f('family_diabetes', 'First-degree family history of diabetes', 'Pregnancy & history', 'select', { options: yesNo, reference: 'diabetes' }),
  f('smoking', 'Current tobacco use / exposure', 'Pregnancy & history', 'text'),
  f('alcohol', 'Alcohol / other substance use', 'Pregnancy & history', 'text'),
  f('hemoglobin', 'Haemoglobin', 'Report measurements', 'number', { unit: 'g/dL', metrics: ['hemoglobin'] }),
  f('platelets', 'Platelet count', 'Report measurements', 'number', { unit: '10^3/µL', metrics: ['platelets'], reference: 'hypertension' }),
  f('systolic', 'Systolic blood pressure', 'Report measurements', 'number', { unit: 'mmHg', metrics: ['blood_pressure_systolic'], reference: 'hypertension' }),
  f('diastolic', 'Diastolic blood pressure', 'Report measurements', 'number', { unit: 'mmHg', metrics: ['blood_pressure_diastolic'], reference: 'hypertension' }),
  f('fasting_glucose', 'Fasting blood glucose', 'Report measurements', 'number', { unit: 'mg/dL', metrics: ['blood_glucose_fasting'], reference: 'diabetes' }),
  f('postmeal_glucose', 'Post-meal blood glucose', 'Report measurements', 'number', { unit: 'mg/dL', metrics: ['blood_glucose_pp'], reference: 'diabetes' }),
  f('random_glucose', 'Random blood glucose', 'Report measurements', 'number', { unit: 'mg/dL', metrics: ['blood_glucose_random'], reference: 'diabetes' }),
  f('hba1c', 'HbA1c', 'Report measurements', 'number', { unit: '%', metrics: ['hba1c'], reference: 'diabetes' }),
  f('ogtt', 'OGTT protocol, time points, values and units', 'Report measurements', 'text', { reference: 'diabetes' }),
  f('tsh', 'TSH', 'Report measurements', 'number', { unit: 'µIU/mL', metrics: ['tsh'], reference: 'thyroid' }),
  f('free_t4', 'Free T4', 'Report measurements', 'number', { unit: 'ng/dL', metrics: ['t4_free'], reference: 'thyroid' }),
  f('creatinine', 'Serum creatinine', 'Report measurements', 'number', { unit: 'mg/dL', metrics: ['creatinine'], reference: 'hypertension' }),
  f('alt', 'ALT', 'Report measurements', 'number', { unit: 'U/L', metrics: ['alt'], reference: 'hypertension' }),
  f('ast', 'AST', 'Report measurements', 'number', { unit: 'U/L', metrics: ['ast'], reference: 'hypertension' }),
  f('urine_protein', 'Urine protein', 'Report measurements', 'text', { metrics: ['urine_protein'], reference: 'hypertension' }),
  f('urine_culture', 'Urine culture / susceptibility result', 'Report measurements', 'text'),
  f('hiv_screen', 'HIV screening result', 'Infection & prevention', 'select', { options: ['Non-reactive', 'Reactive', 'Indeterminate', 'Not tested'], reference: 'infections' }),
  f('hepb_screen', 'Hepatitis B surface antigen result', 'Infection & prevention', 'select', { options: ['Non-reactive', 'Reactive', 'Indeterminate', 'Not tested'], reference: 'infections' }),
  f('syphilis_screen', 'Syphilis screening test and result', 'Infection & prevention', 'text', { reference: 'infections' }),
  f('vaccination_history', 'Vaccines / injections already received and dates', 'Infection & prevention', 'text', { reference: 'vaccination' }),
  f('vaccine_reaction', 'Previous vaccine reaction', 'Infection & prevention', 'text', { reference: 'vaccination' }),
  ...MATERNITY_FACTORS,
];
export function validDefinitions(value) {
  return Array.isArray(value) && new Set(value.map(item => item?.id)).size === value.length && value.every(item => item && typeof item.id === 'string' && typeof item.label === 'string' && typeof item.group === 'string' && ['number', 'text', 'select', 'date', 'datetime-local'].includes(item.type) && typeof item.enabled === 'boolean' && typeof item.unit === 'string' && (item.type !== 'select' || Array.isArray(item.options) && item.options.every(option => typeof option === 'string')));
}
export function validFactorValues(value) {
  return value && !Array.isArray(value) && typeof value === 'object' && Object.values(value).every(item => item && typeof item.value === 'string' && typeof item.unit === 'string' && typeof item.recordedAt === 'string');
}
const unitKey = unit => String(unit ?? '').replace('mIU/L', '\u00b5IU/mL').replaceAll('μ', 'µ').replaceAll(' ', '').toLowerCase();
export function usableFactor(definition, record) {
  if (!record || !String(record.value).trim() || record.needsReview) return false;
  if (definition.type === 'number' && (!Number.isFinite(Number(record.value)) || unitKey(definition.unit) !== unitKey(record.unit))) return false;
  if (['date','datetime-local'].includes(definition.type) && !Number.isFinite(Date.parse(record.value))) return false;
  if (definition.type === 'select' && !definition.options.includes(record.value)) return false;
  return true;
}
/** A thin view adapter over already-shared reports. No downloads or new database queries. */
export function resolveFactorValues(definitions, patient, appointment, reports, overrides = {}, maternityCard = null) {
  const result = {};
  const maternity = maternityFactorValues(maternityCard);
  for (const definition of definitions) {
    if (definition.profile && patient[definition.profile] !== undefined && patient[definition.profile] !== null && patient[definition.profile] !== '') {
      result[definition.id] = { value: String(patient[definition.profile]).replaceAll('−', '-'), unit: definition.unit, source: 'Patient profile', recordedAt: '', needsReview: false };
    }
    if (definition.appointment && appointment?.[definition.appointment]) {
      result[definition.id] = { value: String(appointment[definition.appointment]), unit: definition.unit, source: 'Visit record', recordedAt: appointment.scheduled_at || '', needsReview: false };
    }
    const candidates = [];
    for (const report of reports || []) {
      const date = report.report_date || report.uploaded_at;
      if (!date || !Number.isFinite(Date.parse(date)) || Date.parse(date) > Date.now()) continue;
      for (const metric of report.lab_report_metrics || []) {
        if (!definition.metrics?.includes(metric.standard_key)) continue;
        const reviewed = metric.reviewed_value !== null && metric.reviewed_value !== undefined;
        const bounded = !reviewed && /^[<>\u2264\u2265]/.test(String(metric.raw_value || '').trim());
        const value = reviewed ? metric.reviewed_value : bounded ? metric.raw_value : metric.parsed_value ?? metric.raw_value;
        if (value === null || value === undefined || String(value).trim() === '') continue;
        candidates.push({ value: String(value), unit: metric.unit_standard || metric.unit_raw || '', source: reviewed ? 'Clinician-reviewed report' : 'Extracted report', recordedAt: date, reportId: report.id, metricId: metric.id, printedValue: metric.raw_value == null ? '' : String(metric.raw_value), needsReview: bounded || !reviewed && metric.needs_review !== false });
      }
    }
    candidates.sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
    if (candidates.length) result[definition.id] = candidates[0];
    const cardRecord = maternity[definition.id];
    if (cardRecord) {
      const existing = result[definition.id];
      const cardDate = Date.parse(cardRecord.recordedAt);
      const existingDate = Date.parse(existing?.recordedAt);
      // A newer dated report wins; card-only fields and dated card observations are reused.
      if (!existing || !Number.isFinite(existingDate) || (Number.isFinite(cardDate) && cardDate >= existingDate)) result[definition.id] = cardRecord;
    }
    if (Object.hasOwn(overrides, definition.id)) result[definition.id] = { ...overrides[definition.id], source: 'Doctor entry', needsReview: false };
  }
  return result;
}
export function contextWithFactors(base, definitions, records) {
  const positive = new Set(String(base.factors || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const negative = new Set(String(base.absentFactors || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean));
  const factorRecords = {};
  const available = [...base.available];
  const context = { ...base, age: '', purpose: '', pregnancy: '' };
  for (const definition of definitions.filter(item => item.enabled)) {
    const record = records[definition.id];
    if (!usableFactor(definition, record)) continue;
    factorRecords[definition.id] = { ...record, label: definition.label, type: definition.type, autoReuse: definition.autoReuse !== false };
    if (definition.id === 'age') context.age = record.value;
    if (definition.id === 'purpose') context.purpose = record.value;
    if (definition.id === 'pregnancy_stage') context.pregnancy = record.value;
    if (definition.type === 'select' && ['Yes', 'No'].includes(record.value)) {
      (record.value === 'Yes' ? positive : negative).add(definition.label.toLowerCase());
    }
    if (definition.id === 'diabetes_status') {
      const diagnosed = record.value !== 'No diagnosed diabetes';
      positive.delete('diabetes'); negative.delete('diabetes');
      (diagnosed ? positive : negative).add('diabetes');
      if (diagnosed) positive.add(record.value.toLowerCase());
    }
  }
  for (const definition of definitions.filter(item => item.enabled)) {
    const record = records[definition.id];
    if (record && usableFactor(definition, record) && !available.some(item => item.label === definition.label)) available.push({ label: definition.label, value: record.value, source: record.source });
  }
  return { ...context, factors: [...positive].join(', '), absentFactors: [...negative].join(', '), available, factorRecords };
}
export function evaluateFactorRule(rule, context) {
  const record = context.factorRecords?.[rule.factorId];
  if (!record) return 'unknown';
  if (rule.operator === 'equals' && record.type !== 'number') return record.value.trim().toLowerCase() === String(rule.value).trim().toLowerCase() ? 'matched' : 'conflict';
  if (unitKey(record.unit) !== unitKey(rule.unit) || !String(rule.value).trim() || !String(record.value).trim()) return 'unknown';
  const current = Number(record.value), target = Number(rule.value);
  if (!Number.isFinite(current) || !Number.isFinite(target)) return 'unknown';
  if (rule.operator === 'equals') return current === target ? 'matched' : 'conflict';
  if (rule.operator === 'min') return current >= target ? 'matched' : 'conflict';
  if (rule.operator === 'max') return current <= target ? 'matched' : 'conflict';
  return 'unknown';
}
