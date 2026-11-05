// Run on clinician-labelled, consented/de-identified cases. Only aggregate metrics
// are printed. No examples, rules, identities or model completions are logged.
const fs=require('node:fs');
const {localScreening}=require('./screening');
async function evaluate(cases,screen){
 const metrics={urgentCases:0,missedUrgentTier:0,unflaggedUrgent:0,heldOnFailure:0,total:cases.length,falseFlagsOnNormal:0};
 for(const item of cases){
  if(!['normal','soon','urgent'].includes(item.label)||typeof item.text!=='string')throw new Error('Invalid evaluation input');
  if(item.label==='urgent')metrics.urgentCases++;
  try{const result=await screen(item.text);if(item.label==='urgent'&&result.tier!=='urgent')metrics.missedUrgentTier++;if(item.label==='urgent'&&result.state==='normal')metrics.unflaggedUrgent++;if(item.label==='normal'&&result.state!=='normal')metrics.falseFlagsOnNormal++;if(result.state==='error')metrics.heldOnFailure++;}
  catch{metrics.heldOnFailure++;if(item.label==='urgent')metrics.missedUrgentTier++;}
 }
 return metrics;
}
if(require.main===module){
 (async()=>{const cases=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));console.log(JSON.stringify(await evaluate(cases,localScreening()),null,2));})().catch(()=>{process.stderr.write('Evaluation unavailable; check local configuration and input format.\n');process.exitCode=1;});
}
module.exports={evaluate};
