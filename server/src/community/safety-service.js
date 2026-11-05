const express=require('express');
const {createDatabase,CommunityError}=require('./database');
const {internalAuth,wrap,safeErrors}=require('./internal');
const {localScreening}=require('./screening');
const {schemas}=require('./validation');

function createSafetyService({db,screen,secret}) {
 const app=express(); app.disable('x-powered-by'); app.use(internalAuth(secret),express.json({limit:'64kb'}));
 app.post('/redact',wrap(async(req,res)=>{
  if(typeof req.body.text!=='string'||req.body.text.length>10000) throw new CommunityError(400,'invalid_text');
  res.set('Cache-Control','no-store').json({text:(await screen(req.body.text)).body});
 }));
 app.post('/process',wrap(async(req,res)=>{
  const {operation,proof}=req.body;
  if(!['create_post','edit_post','create_comment','edit_comment','send_message'].includes(operation)||typeof proof!=='string') throw new CommunityError(400,'invalid_operation');
  // Strict parsing rejects caller-supplied state/tier/screening/author fields.
  const args=schemas[operation].parse(req.body.args);
  const screened=await screen(args.body);
  if(args.title!==undefined){
   const title=await screen(args.title); args.title=title.body;
   const rank={normal:0,soon:1,urgent:2};
   if(rank[title.tier]>rank[screened.tier]) screened.tier=title.tier;
   if(title.state==='error'||screened.state==='error') screened.state='error';
   else if(screened.tier!=='normal') screened.state='held';
   screened.screening.title=title.screening;
  }
  const fn=operation==='send_message'?'community_private.message_screened':'community_private.submit_screened';
  const values=operation==='send_message'?[proof,{...args,...screened}]:[proof,operation,{...args,...screened}];
  res.set('Cache-Control','no-store').json(await db(fn,values));
 }));
 app.use((req,res)=>res.status(404).json({error:'not_found'})); app.use(safeErrors); return app;
}
if(require.main===module) {
 const screen=localScreening();
 if(process.env.COMMUNITY_LLM_BYPASS==='true') process.stderr.write('Community LLM bypass enabled for synthetic testing; pattern removal and rules remain active.\n');
 createSafetyService({db:createDatabase(process.env.COMMUNITY_WORKER_DATABASE_URL),screen,secret:process.env.COMMUNITY_SAFETY_SERVICE_KEY}).listen(Number(process.env.COMMUNITY_SAFETY_PORT||4102),'127.0.0.1');
}
module.exports={createSafetyService};
