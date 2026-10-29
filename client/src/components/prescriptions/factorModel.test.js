import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FACTORS, resolveFactorValues, contextWithFactors, usableFactor, validDefinitions, validFactorValues } from './factorModel.js';
import { blankTemplate, buildPatientContext, evaluateTemplate, validLibrary } from './templateModel.js';
const definition = id => DEFAULT_FACTORS.find(item => item.id === id);
const report = (value, changes = {}, date = '2026-09-01') => ({ id:'report', report_date:date, lab_report_metrics:[{id:'metric',standard_key:'hemoglobin',parsed_value:value,raw_value:String(value),unit_standard:'g/dL',needs_review:false,...changes}] });
const base = buildPatientContext({age:30},{});
test('starter factor definitions have stable unique IDs and valid types',()=>{
 assert.equal(validDefinitions(DEFAULT_FACTORS),true);
 assert.equal(new Set(DEFAULT_FACTORS.map(item=>item.id)).size,DEFAULT_FACTORS.length);
});
test('latest shared report is selected regardless of input order and zero is not lost',()=>{
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},[report(11),report(0,{},'2026-09-02')]);
 assert.equal(records.hemoglobin.value,'0');assert.equal(records.hemoglobin.recordedAt,'2026-09-02');
 assert.equal(usableFactor(definition('hemoglobin'),records.hemoglobin),true);
});
test('newer unreviewed results stay unknown instead of silently using an older reading',()=>{
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},[report(11),report(9,{needs_review:true},'2026-09-02')]);
 assert.equal(records.hemoglobin.value,'9');
 assert.equal(usableFactor(definition('hemoglobin'),records.hemoglobin),false);
 assert.equal(contextWithFactors(base,DEFAULT_FACTORS,records).factorRecords.hemoglobin,undefined);
});
test('bounds are retained as printed and cannot become exact readings',()=>{
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},[report(0.5,{raw_value:'<0.5',needs_review:true})]);
 assert.equal(records.hemoglobin.value,'<0.5');
 assert.equal(usableFactor(definition('hemoglobin'),records.hemoglobin),false);
});
test('unit mismatches and future report dates are excluded from matching',()=>{
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},[report(110,{unit_standard:'g/L'})]);
 assert.equal(usableFactor(definition('hemoglobin'),records.hemoglobin),false);
 assert.equal(resolveFactorValues(DEFAULT_FACTORS,{}, {},[report(12,{},'2999-01-01')]).hemoglobin,undefined);
});
test('doctor overrides survive source refresh and clearing explicitly means unknown',()=>{
 const overrides={hemoglobin:{value:'12',unit:'g/dL',recordedAt:'2026-09-03'}};
 assert.equal(validFactorValues(overrides),true);
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},[report(9)],overrides);
 assert.equal(records.hemoglobin.value,'12');assert.equal(records.hemoglobin.source,'Doctor entry');
 overrides.hemoglobin.value='';
 assert.equal(usableFactor(definition('hemoglobin'),resolveFactorValues(DEFAULT_FACTORS,{}, {},[report(9)],overrides).hemoglobin),false);
});
test('lab values never create a diabetes diagnosis or clear allergies',()=>{
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},[{id:'r',report_date:'2026-09-01',lab_report_metrics:[{standard_key:'blood_glucose_random',parsed_value:200,unit_standard:'mg/dL',needs_review:false}]}]);
 const context=contextWithFactors(base,DEFAULT_FACTORS,records);
 assert.equal(context.factors,'');assert.equal(context.absentFactors,'');
 assert.equal(context.factorRecords.allergy_status,undefined);
});
test('custom factors immediately work as typed template rules with unknowns lowering scores',()=>{
 const custom={id:'custom-a',label:'Example factor',group:'Custom factors',type:'select',unit:'',options:['Yes','No'],custom:true,enabled:true};
 const defs=[...DEFAULT_FACTORS,custom];
 const context=contextWithFactors(base,defs,{[custom.id]:{value:'Yes',unit:'',source:'Doctor entry'}});
 const template={...blankTemplate(),name:'Example',factorRules:[{factorId:custom.id,label:custom.label,unit:'',operator:'equals',value:'Yes'},{factorId:'creatinine',label:'Creatinine',unit:'mg/dL',operator:'max',value:'1'}]};
 const result=evaluateTemplate(template,context);
 assert.equal(result.score,50);assert.equal(result.missing.length,1);
 const disabled=contextWithFactors(base,defs.map(item=>({...item,enabled:false})),context.factorRecords);
 assert.equal(evaluateTemplate(template,disabled).score,0);
 assert.equal(validLibrary([template]),true);
});
test('numeric equality is numeric, and repeated identical rules do not inflate scores',()=>{
 const context=contextWithFactors(base,DEFAULT_FACTORS,{hemoglobin:{value:'11.0',unit:'g/dL',source:'Doctor entry'}});
 const rule={factorId:'hemoglobin',label:'Hb',unit:'g/dL',operator:'equals',value:'11'};
 const result=evaluateTemplate({...blankTemplate(),factorRules:[rule,{...rule}]},context);
 assert.equal(result.total,1);assert.equal(result.score,100);
 assert.equal(evaluateTemplate({...blankTemplate(),factorRules:[{...rule,value:'12'}]},context).conflicts.length,1);
});
test('malformed stored custom rules and duplicate factor IDs fail validation',()=>{
 assert.equal(validLibrary([{...blankTemplate(),factorRules:[{factorId:'x'}]}]),false);
 assert.equal(validDefinitions([DEFAULT_FACTORS[0],DEFAULT_FACTORS[0]]),false);
});

test('clearing a profile field explicitly makes it unknown for matching',()=>{
 const overrides={age:{value:'',unit:'years',recordedAt:'2026-09-03'}};
 const records=resolveFactorValues(DEFAULT_FACTORS,{age:30},{},[],overrides);
 const context=contextWithFactors(base,DEFAULT_FACTORS,records);
 assert.equal(context.age,'');
 const result=evaluateTemplate({...blankTemplate(),minAge:'18'},context);
 assert.equal(result.missing.length,1);
});
