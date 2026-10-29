import test from 'node:test';
import assert from 'node:assert/strict';
import { MATERNITY_FACTORS, maternityFactorValues, mergeFactorDefinitions } from './maternityFactors.js';
import { DEFAULT_FACTORS, resolveFactorValues, usableFactor, contextWithFactors } from './factorModel.js';
import { blankDraft, blankMedication, capturePrescriptionTemplate, buildPatientContext } from './templateModel.js';
const now=Date.parse('2026-10-30T12:00:00Z');
const card=()=>({episodeId:'episode-a',patient:{id:'p',name:'Private name',phone:'private',attendance:'2026-04-01',lmp:'2026-03-01',edd:'2026-12-06',gravida:'2',para:'1',living:'0',abortions:'0',history:'Recorded history'},investigations:{blood:'O-',hb:'11',tsh:'2',resultsDate:'2026-04-01',chest:'Recorded',cvs:'Recorded'},visits:[{id:'v1',date:'2026-09-01',weeks:'26',days:'3',weight:'62',fundal:'25',presentation:'Cephalic',fhr:'145',albumin:'Negative',sugar:'Negative',systolic:'118',diastolic:'76',clinician:'Doctor'},{id:'v2',date:'2026-10-01',weeks:'30',weight:'64',fhr:'140'}],labs:[{date:'2026-09-01',test:'Example',result:'Negative',notes:'Recorded'}],scans:[{date:'2026-09-01',weeks:'26',days:'3',report:'Recorded findings'}],vaccines:[{date:'2026-09-01',name:'Example vaccine',dose:'Recorded dose',next:'2026-11-01'}],delivery:{type:'Vaginal',when:''}});
test('maternity baseline and obstetric fields are mapped without patient identifiers',()=>{
 const values=maternityFactorValues(card(),now);
 assert.equal(values.lmp.value,'2026-03-01');assert.equal(values.edd.value,'2026-12-06');
 assert.equal(values.gravida.value,'2');assert.equal(values.living.value,'0');
 assert.equal(values.blood_group.value,'O-');assert.equal(values.hemoglobin.value,'11');
 assert.equal(values.name,undefined);assert.equal(values.phone,undefined);
});
test('latest dated observations retain per-field dates and gestation days are not mixed',()=>{
 const values=maternityFactorValues(card(),now);
 assert.equal(values.gestation_weeks.value,'30');assert.equal(values.gestation_days,undefined);
 assert.equal(values.weight.value,'64');assert.equal(values.weight.sourceRowId,'v2');
 assert.equal(values.fundal_height.value,'25');assert.equal(values.fundal_height.recordedAt,'2026-09-01');
 assert.equal(values.fetal_heart_rate.value,'140');
});
test('scan, vaccine and repeat-lab narratives are reused without deriving diagnoses',()=>{
 const values=maternityFactorValues(card(),now);
 assert.equal(values.scan_findings.value,'Recorded findings');
 assert.match(values.vaccination_history.value,/Example vaccine/);
 assert.equal(values.vaccine_next_date.value,'2026-11-01');
 assert.match(values.maternity_investigations.value,/Example/);
 assert.equal(values.diabetes_status,undefined);
});
test('default delivery type is not treated as a real birth without a valid date',()=>{
 assert.equal(maternityFactorValues(card(),now).delivery_type,undefined);
 const source=card();source.delivery={type:'Caesarean',when:'2026-10-20T10:30',weight:'3.1',apgar1:'0',apgar5:'8',advice:'Recorded advice'};
 const values=maternityFactorValues(source,now);
 assert.equal(values.delivery_type.value,'Caesarean');assert.equal(values.apgar_1.value,'0');
 assert.equal(values.birth_weight.unit,'kg');assert.equal(values.postnatal_advice.value,'Recorded advice');
 source.delivery.when='2999-01-01T10:30';assert.equal(maternityFactorValues(source,now).delivery_type,undefined);
});
test('future visit observations and cards without an episode are not used',()=>{
 const source=card();source.visits.push({date:'2999-01-01',weight:'999'});
 assert.equal(maternityFactorValues(source,now).weight.value,'64');
 assert.deepEqual(maternityFactorValues({...source,episodeId:null},now),{});
});
test('later reports win over older maternity values; local doctor overrides win over both',()=>{
 const source=card();
 const reports=[{id:'r',report_date:'2026-10-02',lab_report_metrics:[{id:'m',standard_key:'hemoglobin',parsed_value:12,raw_value:'12',unit_standard:'g/dL',needs_review:false}]}];
 const imported=resolveFactorValues(DEFAULT_FACTORS,{age:30},{},reports,{},source);
 assert.equal(imported.hemoglobin.value,'12');assert.equal(imported.gestation_weeks.value,'30');
 const manual=resolveFactorValues(DEFAULT_FACTORS,{}, {},reports,{hemoglobin:{value:'13',unit:'g/dL',recordedAt:'2026-10-03'}},source);
 assert.equal(manual.hemoglobin.value,'13');
});
test('baseline results are not overwritten by older antenatal rows and TSH units are equivalent',()=>{
 const source=card();source.investigations.resultsDate='2026-10-15';source.visits[0].hb='9';
 const values=resolveFactorValues(DEFAULT_FACTORS,{}, {},[],{},source);
 assert.equal(values.hemoglobin.value,'11');
 assert.equal(usableFactor(DEFAULT_FACTORS.find(row=>row.id==='tsh'),values.tsh),true);
});
test('existing custom fields and hidden settings survive the new field catalogue',()=>{
 const saved=[{...DEFAULT_FACTORS[0],enabled:false,label:'My age label'},{id:'custom-a',label:'Custom',type:'text',unit:'',group:'Custom factors',enabled:true}];
 const merged=mergeFactorDefinitions(saved,DEFAULT_FACTORS);
 assert.equal(merged[0].enabled,false);assert.equal(merged[0].label,'My age label');
 assert.ok(merged.some(row=>row.id==='custom-a'));assert.ok(merged.some(row=>row.id==='fundal_height'));
 assert.equal(new Set(merged.map(row=>row.id)).size,merged.length);
});
test('neonatal fields remain available but do not automatically become maternal similarity rules',()=>{
 const source=card();source.delivery={type:'Vaginal',when:'2026-10-20T10:30',sex:'Female',weight:'3.1',apgar1:'8'};
 const values=resolveFactorValues(DEFAULT_FACTORS,{age:30},{},[],{},source);
 const context=contextWithFactors(buildPatientContext({age:30}),DEFAULT_FACTORS,values);
 const captured=capturePrescriptionTemplate(null,{...blankDraft(),medications:[{...blankMedication(),name:'Example'}]},context,'visit',false);
 assert.ok(context.factorRecords.birth_weight);
 assert.ok(!captured.factorRules.some(rule=>['birth_weight','baby_sex','apgar_1'].includes(rule.factorId)));
 assert.ok(MATERNITY_FACTORS.length>0);
});
