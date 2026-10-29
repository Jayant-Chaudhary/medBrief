import test from 'node:test';
import assert from 'node:assert/strict';
import { fitSimilarityModel, selectGhostSuggestion, acceptGhostItem, handleGhostKey, referenceFeatures, validateSimilarityDataset } from './similarityModel.js';
import { blankDraft, blankMedication, blankTemplate, rankTemplates, templatesFromDataset } from './templateModel.js';
const definitions=[{id:'age',label:'Age',type:'number',unit:'years',enabled:true},{id:'hb',label:'Hb',type:'number',unit:'g/dL',enabled:true},{id:'stage',label:'Stage',type:'select',unit:'',options:['First','Second','Third'],enabled:true}];
const snapshot=(age,hb,stage)=>({age:{type:'number',value:String(age),unit:'years',confirmed:true},hb:{type:'number',value:String(hb),unit:'g/dL',confirmed:true},stage:{type:'select',value:stage,unit:'',confirmed:true}});
const context=(age=31,hb=11.2,stage='Second')=>({factors:'',absentFactors:'',purpose:'',pregnancy:'',age:String(age),factorRecords:snapshot(age,hb,stage)});
const template=(id,age,hb,stage)=>({...blankTemplate(),id,name:'Case '+id,factorSnapshot:snapshot(age,hb,stage),medications:[{...blankMedication(),name:'Example '+id,strength:'recorded strength',dose:'recorded dose',frequency:'recorded frequency',duration:'recorded duration'}]});
const cases=()=>[template('a',30,11,'Second'),template('b',40,13,'Third'),template('c',20,9,'First')];
test('mixed numeric/categorical Gower similarity ranks nearby cases without exact numeric matches',()=>{
 const ranked=rankTemplates(cases(),context(),definitions);
 assert.deepEqual(ranked.map(item=>item.template.id),['a','b','c']);
 assert.equal(ranked[0].match.score,97);assert.equal(ranked[0].match.compared,3);
 assert.ok(Math.abs(ranked[0].match.rawSimilarity-29/30)<1e-10);
});
test('fit ranges are derived solely from reference cases, never the query patient',()=>{
 const refs=cases();
 const before=fitSimilarityModel(refs,definitions);
 rankTemplates(refs,context(1000,1000,'Second'),definitions);
 assert.deepEqual(fitSimilarityModel(refs,definitions).ranges,before.ranges);
 assert.equal(before.ranges[JSON.stringify(['age','years'])].max,40);
});
test('missing data reduces supported similarity and coverage without becoming a zero measurement',()=>{
 const query=context();delete query.factorRecords.hb;
 const result=rankTemplates(cases(),query,definitions)[0].match;
 assert.equal(result.compared,2);assert.equal(result.coverage,2/3);assert.equal(result.score,65);
 assert.equal(result.similarityDetails.find(row=>row.factorId==='hb').actual,null);
 assert.equal(selectGhostSuggestion(rankTemplates(cases(),query,definitions),blankDraft()).suggestion,null);
});
test('a one-field reference does not outrank a well-supported complete case',()=>{
 const refs=cases();const sparse=template('sparse',30,11,'Second');sparse.factorSnapshot={age:snapshot(30,11,'Second').age};
 const ranked=rankTemplates([...refs,sparse],context(30,11,'Second'),definitions);
 assert.equal(ranked[0].template.id,'a');assert.equal(ranked.find(row=>row.template.id==='sparse').match.score,33);
});
test('units, unverified, stale and unknown categorical values are excluded pairwise',()=>{
 const query=context();query.factorRecords.hb.unit='g/L';query.factorRecords.age.stale=true;query.factorRecords.stage.value='Not assessed';
 const ranked=rankTemplates(cases(),query,definitions);
 assert.ok(ranked.every(row=>row.match.compared===0 && !row.match.candidate));
 const ref=template('bad',30,11,'Second');ref.factorSnapshot.age.confirmed=false;
 assert.equal(referenceFeatures(ref,definitions).age,undefined);
});
test('zero-spread numeric features use exact comparison rather than inventing a clinical scale',()=>{
 const result=rankTemplates([template('one',30,11,'Second')],context(),definitions)[0].match;
 assert.equal(result.score,33);assert.ok(result.similarityDetails.some(row=>row.reason.includes('No observed numeric spread')));
});
test('archived, in-progress, and own-visit references do not influence fitting or suggestions',()=>{
 const refs=cases();const archived=template('archive',999,999,'Second');archived.archived=true;
 const pending=template('pending',888,888,'Second');pending.autoCapture={stage:'draft'};
 const model=fitSimilarityModel([...refs,archived,pending],definitions,{excludeTemplateIds:['a']});
 assert.deepEqual(model.references.map(row=>row.template.id),['b','c']);
 assert.equal(model.ranges[JSON.stringify(['age','years'])].max,40);
 const ranked=rankTemplates([...refs,archived,pending],context(),definitions,{excludeTemplateIds:['a']});
 assert.equal(ranked.find(row=>row.template.id==='archive').match.candidate,false);
 assert.equal(ranked.find(row=>row.template.id==='a').match.candidate,false);
 assert.ok(ranked.some(row=>row.template.id==='archive'),'Archived records remain manageable');
});
test('known exclusion conflicts block suggestions even with perfect statistical similarity',()=>{
 const refs=cases();refs[0].exclusions='factor x';
 const query={...context(30,11),factors:'factor x'};
 const result=rankTemplates(refs,query,definitions).find(row=>row.template.id==='a').match;
 assert.equal(result.score,100);assert.equal(result.candidate,false);assert.equal(result.conflicts.length,1);
});
test('clear best case produces a ghost without mutating the draft or manufacturing dosage',()=>{
 const draft=blankDraft(),before=JSON.stringify(draft);
 const ghost=selectGhostSuggestion(rankTemplates(cases(),context(),definitions),draft).suggestion;
 assert.equal(ghost.template.id,'a');assert.equal(JSON.stringify(draft),before);
 const accepted=acceptGhostItem(draft,ghost);
 assert.equal(accepted.medications[0].dose,'recorded dose');assert.equal(accepted.medications[0].duration,'recorded duration');
 assert.equal(accepted.medications[0].source.id,'a');assert.equal(draft.medications.length,0);
 assert.equal(acceptGhostItem(accepted,ghost),accepted);
});
test('different prescriptions with tied top matches suppress the ghost',()=>{
 const refs=cases();refs.push({...template('a2',30,11,'Second'),medications:[{...blankMedication(),name:'Different example'}]});
 const result=selectGhostSuggestion(rankTemplates(refs,context(),definitions),blankDraft());
 assert.equal(result.suggestion,null);assert.match(result.reason,/similarly ranked/);
});
test('unknown mandatory criteria allow comparison but withhold ghost suggestions',()=>{
 const refs=cases();refs[0].required='factor missing';
 const result=selectGhostSuggestion(rankTemplates(refs,context(),definitions),blankDraft());
 assert.equal(result.suggestion,null);
});
test('accepting a ghost fills only a pristine row and preserves partially written items',()=>{
 const ghost=selectGhostSuggestion(rankTemplates(cases(),context(),definitions),blankDraft()).suggestion;
 const empty=blankMedication();const partial={...blankMedication(),dose:'doctor-entered dose'};
 const filled=acceptGhostItem({...blankDraft(),medications:[partial,empty]},ghost);
 assert.equal(filled.medications.length,2);assert.equal(filled.medications[0].dose,'doctor-entered dose');
 assert.equal(filled.medications[1].name,'Example a');
});
test('Tab acceptance is explicit; Shift+Tab, composition and typing retain native behavior',()=>{
 let accepted=0,dismissed=0,prevented=0;
 const event=(key,extra={})=>({key,preventDefault(){prevented++;},stopPropagation(){},...extra});
 const ghost={medication:{name:'Example'}},row=blankMedication();
 assert.equal(handleGhostKey(event('Tab'),row,ghost,()=>accepted++,()=>dismissed++),true);
 assert.equal(accepted,1);
 for(const e of [event('Tab',{shiftKey:true}),event('Tab',{isComposing:true}),event('a')]) assert.equal(handleGhostKey(e,row,ghost,()=>accepted++,()=>dismissed++),false);
 assert.equal(handleGhostKey(event('Tab'),{...row,duration:'written'},ghost,()=>accepted++,()=>dismissed++),false);
 assert.equal(handleGhostKey(event('Escape'),row,ghost,()=>accepted++,()=>dismissed++),true);
 assert.equal(dismissed,1);assert.equal(prevented,2);
});
test('versioned template JSON validates and converts to the app shape',()=>{
 const payload={schemaVersion:1,templates:[{id:'pipeline-case',name:'Pipeline case',status:'completed',factorSnapshot:snapshot(30,11,'Second'),medications:[{name:'Example',strength:'',dose:'recorded',route:'',frequency:'recorded',duration:'recorded'}]}]};
 assert.equal(validateSimilarityDataset(payload).ok,true);
 const converted=templatesFromDataset(payload);
 assert.equal(converted[0].medications[0].id,'pipeline-case-item-0');
 assert.equal(rankTemplates(converted,context(30,11),definitions)[0].match.score,100);
 assert.equal(validateSimilarityDataset({...payload,schemaVersion:2}).ok,false);
 assert.equal(validateSimilarityDataset({schemaVersion:1,templates:[payload.templates[0],payload.templates[0]]}).ok,false);
 assert.equal(validateSimilarityDataset({schemaVersion:1,templates:[{...payload.templates[0],factorSnapshot:{age:{type:'number',value:'bad',unit:'years',confirmed:true}}}]}).ok,false);
});
test('model artifacts survive JSON serialization with identical rankings',()=>{
 const model=fitSimilarityModel(cases(),definitions);
 assert.deepEqual(JSON.parse(JSON.stringify(model)).ranges,model.ranges);
});
