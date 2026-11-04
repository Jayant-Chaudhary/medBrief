import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_FACTORS, resolveFactorValues, contextWithFactors, usableFactor, validDefinitions, validFactorValues } from './factorModel.js';
import { blankTemplate, buildPatientContext, evaluateTemplate, validLibrary } from './templateModel.js';
import { maternityFactorValues } from './maternityFactors.js';
const definition = id => DEFAULT_FACTORS.find(item => item.id === id);
const base = buildPatientContext({age:30},{});
test('starter factor definitions have stable unique IDs and valid types',()=>{
 assert.equal(validDefinitions(DEFAULT_FACTORS),true);
 assert.equal(new Set(DEFAULT_FACTORS.map(item=>item.id)).size,DEFAULT_FACTORS.length);
});
test('matching can reuse only the latest dated lab value already recorded on the maternity card',()=>{
 const card={episodeId:'episode-1',labs:[
  {id:'old',key:'hemoglobin',test:'Hb',result:'10.2',unit:'g/dL',date:'2026-08-01'},
  {id:'new',key:'hemoglobin',test:'Hb',result:'11.1',unit:'g/dL',date:'2026-10-01'},
 ]};
 const values=maternityFactorValues(card,Date.parse('2026-10-15T00:00:00Z'));
 assert.equal(values.hemoglobin.value,'11.1');
 assert.equal(values.hemoglobin.recordedAt,'2026-10-01');
 assert.equal(values.hemoglobin.source,'Maternity card · investigation');
});
test('missing maternity-card values stay unknown; no uploaded-report fallback exists',()=>{
 const cardValues=maternityFactorValues({episodeId:'episode-1',labs:[]},Date.parse('2026-10-15T00:00:00Z'));
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},{}, {episodeId:'episode-1',labs:[]});
 assert.equal(cardValues.hemoglobin,undefined);
 assert.equal(records.hemoglobin,undefined);
});
test('doctor overrides survive source refresh and clearing explicitly means unknown',()=>{
 const overrides={hemoglobin:{value:'12',unit:'g/dL',recordedAt:'2026-09-03'}};
 assert.equal(validFactorValues(overrides),true);
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},overrides);
 assert.equal(records.hemoglobin.value,'12');assert.equal(records.hemoglobin.source,'Doctor entry');
 overrides.hemoglobin.value='';
 assert.equal(usableFactor(definition('hemoglobin'),resolveFactorValues(DEFAULT_FACTORS,{}, {},overrides).hemoglobin),false);
});
test('lab values never create a diabetes diagnosis or clear allergies',()=>{
 const records=resolveFactorValues(DEFAULT_FACTORS,{}, {},{}, {episodeId:'episode-1',labs:[{key:'blood_glucose_random',result:'200',unit:'mg/dL',date:'2026-09-01'}]});
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
 const records=resolveFactorValues(DEFAULT_FACTORS,{age:30},{},overrides);
 const context=contextWithFactors(base,DEFAULT_FACTORS,records);
 assert.equal(context.age,'');
 const result=evaluateTemplate({...blankTemplate(),minAge:'18'},context);
 assert.equal(result.missing.length,1);
});
