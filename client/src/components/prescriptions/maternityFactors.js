const field = (id, label, type = 'text', extra = {}) => ({ id, label, type, group: 'Maternity card', unit: '', enabled: true, custom: false, reference: '', ...extra });
export const MATERNITY_FACTORS = [
  field('anc_first_date', 'First antenatal attendance', 'date'),
  field('lmp', 'Last menstrual period (LMP)', 'date'),
  field('edd', 'Expected date of delivery (EDD)', 'date'),
  field('gravida', 'Gravida', 'number'),
  field('para', 'Para', 'number'),
  field('living', 'Living children', 'number'),
  field('abortions', 'Abortions / pregnancy losses', 'number'),
  field('maternity_history', 'Relevant history / allergies recorded on card'),
  field('chest_history', 'Chest history / examination'),
  field('cvs_history', 'Cardiovascular history / examination'),
  field('baseline_date', 'Baseline investigation date', 'date'),
  field('baseline_results', 'Other baseline investigation results'),
  field('gestation_days', 'Additional gestational days', 'number', { unit: 'days' }),
  field('anc_last_date', 'Latest antenatal visit date', 'date'),
  field('fundal_height', 'Fundal height', 'number', { unit: 'cm' }),
  field('presentation', 'Fetal presentation', 'select', { options: ['Cephalic', 'Breech', 'Transverse', 'Oblique', 'Not assessed', 'Other'] }),
  field('brim_relation', 'Relation of presentation to brim'),
  field('fetal_heart_rate', 'Fetal heart rate', 'number', { unit: 'bpm' }),
  field('urine_albumin', 'Urine albumin on maternity card', 'select', { options: ['Negative', 'Trace', '1+', '2+', '3+', '4+', 'Not tested'] }),
  field('urine_sugar', 'Urine sugar on maternity card', 'select', { options: ['Negative', 'Trace', '1+', '2+', '3+', '4+', 'Not tested'] }),
  field('anc_next_date', 'Next antenatal visit', 'date'),
  field('anc_advice', 'Antenatal advice / notes'),
  field('maternity_investigations', 'Repeat investigations: dates, tests and results'),
  field('scan_date', 'Latest ultrasound date', 'date', { group: 'Scans & vaccinations' }),
  field('scan_weeks', 'Gestational weeks at latest ultrasound', 'number', { unit: 'weeks', group: 'Scans & vaccinations' }),
  field('scan_days', 'Additional days at latest ultrasound', 'number', { unit: 'days', group: 'Scans & vaccinations' }),
  field('scan_findings', 'Latest ultrasound report / findings', 'text', { group: 'Scans & vaccinations' }),
  field('scan_history', 'Ultrasound history', 'text', { group: 'Scans & vaccinations' }),
  field('vaccine_next_date', 'Recorded next vaccine / injection date', 'date', { group: 'Scans & vaccinations', reference: 'vaccination' }),
  field('delivery_type', 'Type of delivery', 'select', { group: 'Delivery & postnatal', options: ['Vaginal', 'Assisted vaginal', 'Caesarean', 'Other'] }),
  field('delivery_date', 'Delivery date and time', 'datetime-local', { group: 'Delivery & postnatal' }),
  field('delivery_indication', 'Delivery indication', 'text', { group: 'Delivery & postnatal' }),
  field('baby_sex', 'Sex of baby', 'select', { group: 'Delivery & postnatal', options: ['Female', 'Male', 'Indeterminate'], autoReuse: false }),
  field('birth_weight', 'Baby birth weight', 'number', { unit: 'kg', group: 'Delivery & postnatal', autoReuse: false }),
  field('apgar_1', 'APGAR at 1 minute', 'number', { group: 'Delivery & postnatal', autoReuse: false }),
  field('apgar_5', 'APGAR at 5 minutes', 'number', { group: 'Delivery & postnatal', autoReuse: false }),
  field('postnatal_next_date', 'Next postnatal visit', 'date', { group: 'Delivery & postnatal' }),
  field('postnatal_advice', 'Postnatal advice', 'text', { group: 'Delivery & postnatal' }),
];
const present = value => value !== undefined && value !== null && String(value).trim() !== '';
function datedRows(rows, asOf) {
  return (Array.isArray(rows) ? rows : []).filter(row => row.date && Number.isFinite(Date.parse(row.date)) && Date.parse(row.date) <= asOf)
    .sort((a,b) => Date.parse(b.date) - Date.parse(a.date));
}
/** Adapt the existing maternity API response. Never infer diagnoses or trimester from prose. */
export function maternityFactorValues(card, asOf = Date.now()) {
  if (!card?.episodeId) return {};
  const values = {};
  const set = (id, value, unit = '', date = '', section = 'Maternity card', row = {}) => {
    if (!present(value)) return;
    const previousDate = Date.parse(values[id]?.recordedAt);
    if (Number.isFinite(previousDate) && (!Number.isFinite(Date.parse(date)) || previousDate > Date.parse(date))) return;
    values[id] = { value: String(value).replaceAll('−', '-'), unit, recordedAt: date, source: section, episodeId: card.episodeId, sourceRowId: row.id || '', sourceClinician: row.clinician || '', needsReview: false };
  };
  const patient = card.patient || {}, baseline = card.investigations || {};
  for (const [id,key] of Object.entries({ anc_first_date:'attendance',lmp:'lmp',edd:'edd',gravida:'gravida',para:'para',living:'living',abortions:'abortions',maternity_history:'history' })) set(id,patient[key],'',patient.attendance || '');
  for (const [id,key] of Object.entries({ blood_group:'blood',chest_history:'chest',cvs_history:'cvs',baseline_results:'results',baseline_date:'resultsDate' })) set(id,baseline[key],'',baseline.resultsDate || '');
  set('hemoglobin',baseline.hb,'g/dL',baseline.resultsDate || '', 'Maternity baseline');
  set('tsh',baseline.tsh,'mIU/L',baseline.resultsDate || '', 'Maternity baseline');
  const visits = datedRows(card.visits, asOf);
  // Last recorded value per field, retaining its own observation date.
  const mappings = {
    weight:['weight','kg'],systolic:['systolic','mmHg'],diastolic:['diastolic','mmHg'],
    fundal_height:['fundal','cm'],presentation:['presentation',''],brim_relation:['brim',''],
    fetal_heart_rate:['fhr','bpm'],urine_albumin:['albumin',''],urine_sugar:['sugar',''],
    hemoglobin:['hb','g/dL'],tsh:['tsh','mIU/L'],anc_next_date:['next',''],anc_advice:['advice',''],
  };
  for (const [id,[key,unit]] of Object.entries(mappings)) {
    const row = visits.find(row => present(row[key]));
    if (row) set(id,row[key],unit,row.date,'Maternity antenatal visit',row);
  }
  const gestation = visits.find(row => present(row.weeks));
  if (gestation) {
    set('gestation_weeks',gestation.weeks,'weeks',gestation.date,'Maternity antenatal visit',gestation);
    // Weeks and days must be from the same visit; a missing day is not guessed.
    set('gestation_days',gestation.days,'days',gestation.date,'Maternity antenatal visit',gestation);
  }
  if (visits[0]) set('anc_last_date',visits[0].date,'',visits[0].date,'Maternity antenatal visit',visits[0]);
  const labs = datedRows(card.labs,asOf);
  set('maternity_investigations',labs.map(row=>[row.date,row.test,row.result,row.unit,row.notes].filter(present).join(' | ')).join('\n'),'','', 'Maternity investigation history');
  const scans = datedRows(card.scans,asOf);
  if (scans[0]) {
    const scan=scans[0];
    for (const [id,key,unit] of [['scan_date','date',''],['scan_weeks','weeks','weeks'],['scan_days','days','days'],['scan_findings','report','']]) set(id,scan[key],unit,scan.date,'Maternity ultrasound',scan);
    set('scan_history',scans.map(row=>[row.date,present(row.weeks)?row.weeks+' weeks':'',present(row.days)?row.days+' days':'',row.report].filter(present).join(' | ')).join('\n'),'','','Maternity ultrasound history');
  }
  const vaccines=datedRows(card.vaccines,asOf);
  if (vaccines.length) {
    set('vaccination_history',vaccines.map(row=>[row.date,row.name,row.dose,row.notes,row.next?'Next: '+row.next:''].filter(present).join(' | ')).join('\n'),'','','Maternity vaccination history');
    const next=vaccines.find(row=>present(row.next));
    if(next) set('vaccine_next_date',next.next,'',next.date,'Maternity vaccination',next);
  }
  const delivery=card.delivery || {};
  if(delivery.when && Number.isFinite(Date.parse(delivery.when)) && Date.parse(delivery.when)<=asOf) {
    for(const [id,key,unit] of [['delivery_type','type',''],['delivery_date','when',''],['delivery_indication','indication',''],['baby_sex','sex',''],['birth_weight','weight','kg'],['apgar_1','apgar1',''],['apgar_5','apgar5',''],['postnatal_next_date','next',''],['postnatal_advice','advice','']]) set(id,delivery[key],unit,delivery.when,'Maternity delivery/postnatal');
  }
  return values;
}
export function mergeFactorDefinitions(saved, defaults) {
  const ids = new Set(saved.map(item=>item.id));
  return [...saved,...defaults.filter(item=>!ids.has(item.id))];
}
