const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { createDatabase, CommunityError } = require('./database');
const { internalAuth, wrap, safeErrors } = require('./internal');
const { schemas } = require('./validation');

function createIdentityService({db,verifySession,secret}) {
  const app=express(); app.disable('x-powered-by');
  app.use(internalAuth(secret),express.json({limit:'32kb'}));
  app.use(wrap(async (req,res) => {
    if (!['/resolve','/notice','/reveal'].includes(req.path)) throw new CommunityError(404,'not_found');
    if (req.method!=='POST' || typeof req.body.token!=='string') throw new CommunityError(401,'unauthorized');
    const account=await verifySession(req.body.token);
    if (!account) throw new CommunityError(401,'unauthorized');
    res.set('Cache-Control','no-store');
    if (req.path==='/notice') return res.json(await db('community_private.notice_api'));
    const notice=req.body.noticeVersion;
    if (notice!==undefined && (typeof notice!=='string' || notice.length>100)) throw new CommunityError(400,'invalid_notice');
    const proof=await db('identity_private.issue_capability',[account,notice??null]);
    if (req.path==='/resolve') return res.json({proof});
    if (!['queue','context','decide','contact'].includes(req.body.operation)) throw new CommunityError(400,'invalid_operation');
    const args=req.body.operation==='decide' ? schemas.decision.parse(req.body.args) : ['context','contact'].includes(req.body.operation) ? {id:require('./validation').id.parse(req.body.args?.id)} : {};
    return res.json(await db('identity_private.reveal_api',[proof,req.body.operation,args]));
  }));
  app.use(safeErrors); return app;
}
if (require.main===module) {
  const supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const app=createIdentityService({db:createDatabase(process.env.COMMUNITY_IDENTITY_DATABASE_URL),secret:process.env.COMMUNITY_IDENTITY_SERVICE_KEY,verifySession:async token=>{const {data,error}=await supabase.auth.getUser(token); return error?null:data.user?.id;}});
  app.listen(Number(process.env.COMMUNITY_IDENTITY_PORT||4101),'127.0.0.1');
}
module.exports={createIdentityService};
