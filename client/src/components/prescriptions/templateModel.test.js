import test from 'node:test';
import assert from 'node:assert/strict';
import { blankDraft, blankTemplate, blankMedication, evaluateTemplate, applyTemplate, templateFromDraft, storageKeys, readLocal, validLibrary, buildPatientContext, rankTemplates, capturePrescriptionTemplate, autoTemplateId } from './templateModel.js';
const context = { factors: 'factor A, Factor B', purpose: 'Follow-up', pregnancy: '', age: '30' };
function template(overrides={}) { return {...blankTemplate(),name:'Example',purpose:'Follow-up',required:'factor a',...overrides}; }
test('matches normalized confirmed factors and purpose',()=>{
  const result=evaluateTemplate(template({optional:'factor b'}),context);
  assert.equal(result.suggested,true);assert.equal(result.matched.length,3);
});
test('unknown required factors are missing, not matches',()=>{
  const result=evaluateTemplate(template({required:'factor c'}),context);
  assert.equal(result.suggested,false);assert.deepEqual(result.missing,['Required factor: factor c']);
});
test('known exclusions and age or pregnancy conflicts prevent suggestions',()=>{
  for(const changes of [{exclusions:'factor b'},{minAge:'40'},{maxAge:'20'},{pregnancy:'Third trimester'}]) {
    const result=evaluateTemplate(template(changes),{...context,pregnancy:'First trimester'});
    assert.equal(result.suggested,false);assert.ok(result.conflicts.length);
  }
});
test('unknown age and pregnancy stay unknown; untagged and archived templates are not suggested',()=>{
  const result=evaluateTemplate(template({minAge:'18',pregnancy:'First trimester'}),{...context,age:''});
  assert.deepEqual(result.missing,['Pregnancy stage','Age']);
  assert.equal(evaluateTemplate(blankTemplate(),context).suggested,false);
  assert.equal(evaluateTemplate(template({archived:true}),context).suggested,false);
});
test('selectively appends without overwriting; skips duplicate medication names',()=>{
  const existing={...blankMedication(),name:'Example medicine',dose:'existing dose'};
  const duplicate={...blankMedication(),name:' EXAMPLE MEDICINE ',dose:'different dose'};
  const selected={...blankMedication(),name:'Another example'};
  const omitted={...blankMedication(),name:'Omitted example'};
  const source=template({medications:[duplicate,selected,omitted],instructions:'Reusable instructions',followUp:'Unselected follow-up'});
  const draft={...blankDraft(),medications:[existing],instructions:'Existing instructions'};
  const before=JSON.stringify({source,draft});
  const result=applyTemplate(draft,source,[duplicate.id,selected.id],true,false);
  assert.equal(result.skipped,1);assert.equal(result.added,1);
  assert.equal(result.draft.medications[0].dose,'existing dose');
  assert.equal(result.draft.medications[1].source.version,1);
  assert.equal(result.draft.followUp,'');assert.match(result.draft.instructions,/Existing instructions/);
  assert.equal(JSON.stringify({source,draft}),before);
  const again=applyTemplate(result.draft,source,[selected.id],true,false);
  assert.equal(again.draft.medications.length,2);
  assert.equal(again.draft.instructions,result.draft.instructions);
});
test('templates copy reusable content without patient, encounter or source metadata',()=>{
  const draft={...blankDraft(),patientId:'private-patient',medications:[{...blankMedication(),name:'Example',source:{name:'old'}}]};
  const result=templateFromDraft(draft);
  assert.equal(result.patientId,undefined);assert.equal(result.medications[0].source,undefined);
  assert.notEqual(result.medications[0],draft.medications[0]);
});
test('drafts and libraries are scoped by clinician and encounter',()=>{
  assert.notEqual(storageKeys('doctor-a','patient','visit').library,storageKeys('doctor-b','patient','visit').library);
  assert.notEqual(storageKeys('doctor-a','patient','visit-a').draft,storageKeys('doctor-a','patient','visit-b').draft);
});
test('corrupt local library is preserved without writes',()=>{
  let writes=0;
  globalThis.localStorage={getItem:()=>'{broken',setItem:()=>writes++};
  const result=readLocal('key',[],validLibrary);
  assert.ok(result.error);assert.deepEqual(result.value,[]);assert.equal(writes,0);
  delete globalThis.localStorage;
});

test('criteria score includes unknowns and reports limited coverage',()=>{
  const result=evaluateTemplate(template({purpose:'',required:'factor c, factor d',minAge:'18'}),context);
  assert.equal(result.score,33);
  assert.equal(result.total,3);
  assert.equal(result.checked,1);
  assert.equal(result.missing.length,2);
  assert.equal(result.candidate,true);
  assert.equal(result.suggested,false);
});
test('unknown exclusions are never treated as absent',()=>{
  const value=template({purpose:'',required:'',exclusions:'factor c'});
  assert.equal(evaluateTemplate(value,context).score,0);
  assert.equal(evaluateTemplate(value,context).missing.length,1);
  const cleared=evaluateTemplate(value,{...context,absentFactors:'factor c'});
  assert.equal(cleared.score,100);
  assert.equal(cleared.missing.length,0);
  assert.equal(evaluateTemplate(value,{...context,factors:'factor c'}).conflicts.length,1);
});
test('no matching criteria or no known criteria never produces a positive percentage',()=>{
  assert.equal(evaluateTemplate(blankTemplate(),context).score,null);
  assert.equal(evaluateTemplate(template(),{factors:'',age:'',purpose:''}).score,0);
});

test('context reuses structured records without inferring conditions from prose or labs',()=>{
  const result=buildPatientContext({age:30,history:'diabetes',notes:'factor a',labResults:{glucose:200}},{});
  assert.equal(result.age,'30');
  assert.equal(result.factors,'');
  assert.equal(result.pregnancy,'');
  assert.equal(result.available.length,1);
  const structured=buildPatientContext({confirmedConditions:['factor a'],confirmedAbsentFactors:['factor c'],pregnancyStage:'First trimester'},{purpose:'Follow-up'});
  assert.equal(structured.factors,'factor a');
  assert.equal(structured.absentFactors,'factor c');
  assert.equal(structured.available[0].source,'Visit record');
});
test('context preserves unknown and invalid ages',()=>{
  for(const age of [null,undefined,'','not a number',-1]) assert.equal(buildPatientContext({age}).age,'');
});
test('several options are ranked by criteria match with conflicts last',()=>{
  const first=template({name:'Full',required:'factor a'});
  const second=template({name:'Partial',required:'factor a, factor c'});
  const third=template({name:'Conflict',exclusions:'factor a'});
  const ranked=rankTemplates([third,second,first],context);
  assert.deepEqual(ranked.map(item=>item.template.name),['Full','Partial','Conflict']);
});


test('automatic capture creates one stable copy per visit and updates only on change',()=>{
 const draft={...blankDraft(),medications:[{...blankMedication(),name:'Example',dose:'one',frequency:'once',duration:'one day'}]};
 const first=capturePrescriptionTemplate(null,draft,{},'visit-a',false,'2026-10-30T00:00:00Z');
 assert.equal(first.id,autoTemplateId('visit-a'));
 assert.equal(first.autoCapture.stage,'draft');
 assert.equal(capturePrescriptionTemplate(first,draft,{},'visit-a',false),first);
 const next=capturePrescriptionTemplate(first,{...draft,medications:[{...draft.medications[0],duration:'two days'}]}, {},'visit-a',false);
 assert.equal(next.id,first.id);assert.equal(next.version,2);
 assert.equal(next.medications[0].duration,'two days');
});
test('automatic capture excludes identity and patient-specific free text',()=>{
 const draft={...blankDraft(),patientName:'Private person',instructions:'Private instructions',followUp:'Private follow-up',medications:[{...blankMedication(),name:'Example',instructions:'Private directions',source:{id:'old'}}]};
 const context={factorRecords:{age:{type:'number',label:'Age',value:'30',unit:'years'},allergy_notes:{type:'text',label:'Allergy notes',value:'Private note'}}};
 const result=capturePrescriptionTemplate(null,draft,context,'visit-a',false);
 assert.equal(result.patientName,undefined);assert.equal(result.instructions,'');assert.equal(result.followUp,'');
 assert.equal(result.medications[0].instructions,'');assert.equal(result.medications[0].source,undefined);
 assert.equal(result.factorRules.length,1);assert.equal(result.factorRules[0].factorId,'age');
});
test('unfinished visits are excluded from suggestions; completed visits become options',()=>{
 const context={factorRecords:{age:{type:'number',label:'Age',value:'30',unit:'years'}}};
 const draft={...blankDraft(),medications:[{...blankMedication(),name:'Example'}]};
 const first=capturePrescriptionTemplate(null,draft,context,'visit-a',false);
 assert.equal(evaluateTemplate(first,context).candidate,false);
 const completed=capturePrescriptionTemplate(first,draft,context,'visit-a',true);
 assert.equal(completed.autoCapture.stage,'visit-completed');
 assert.equal(evaluateTemplate(completed,context).candidate,true);
 const different=evaluateTemplate(completed,{factorRecords:{age:{type:'number',label:'Age',value:'31',unit:'years'}}});
 assert.equal(different.conflicts.length,0);assert.equal(different.checks[0].status,'different');
});
test('empty prescriptions create no automatic template and clearing archives the existing copy',()=>{
 assert.equal(capturePrescriptionTemplate(null,blankDraft(),{},'v',false),null);
 const first=capturePrescriptionTemplate(null,{...blankDraft(),medications:[{...blankMedication(),name:'Example'}]}, {},'v',false);
 const cleared=capturePrescriptionTemplate(first,blankDraft(),{},'v',false);
 assert.equal(cleared.archived,true);assert.equal(cleared.autoCapture.empty,true);
 const restored=capturePrescriptionTemplate(cleared,{...blankDraft(),medications:[{...first.medications[0],name:'Updated'}]}, {},'v',false);
 assert.equal(restored.archived,false);
});
test('automatic refresh respects manual archiving and customized names or rules',()=>{
 const draft={...blankDraft(),medications:[{...blankMedication(),name:'Example'}]};
 const first=capturePrescriptionTemplate(null,draft,{},'v',true);
 const customized={...first,archived:true,name:'My title',factorRules:[],autoCapture:{...first.autoCapture,customized:true}};
 const changed=capturePrescriptionTemplate(customized,{...draft,medications:[{...draft.medications[0],dose:'updated'}]}, {},'v',true);
 assert.equal(changed.archived,true);assert.equal(changed.name,'My title');
 assert.equal(changed.medications[0].dose,'updated');
});
