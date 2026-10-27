const express=require('express');
const {createDatabase,CommunityError}=require('./database');
const {createInternalClient,wrap,safeErrors}=require('./internal');
const {schemas,id}=require('./validation');

function createCommunityRouter({db,identity,safety}) {
 const router=express.Router();
 router.use((req,res,next)=>{
  const json=res.json.bind(res);
  const forbidden=new Set(['proof','community_id','communityId','auth_user_id','authUserId','author_id','subject_id','member_id','token_hash']);
  const unsafe=value=>value && typeof value==='object' && Object.entries(value).some(([key,child])=>forbidden.has(key)||unsafe(child));
  // Status must be set before the original json method sends the response.
  res.json=value=>{if(unsafe(value)){res.status(503);return json({error:'community_response_rejected'});}return json(value);};
  next();
 });
 router.use((req,res,next)=>{res.set('Cache-Control','no-store'); const token=req.get('Authorization'); if(!token?.startsWith('Bearer ')) return res.status(401).json({error:'unauthorized'}); req.communityToken=token.slice(7); next();});
 router.get('/notice',wrap(async(req,res)=>res.json(await identity('/notice',{token:req.communityToken}))));
 router.post('/enrol',wrap(async(req,res)=>{if(typeof req.body.noticeVersion!=='string') throw new CommunityError(400,'invalid_notice'); await identity('/resolve',{token:req.communityToken,noticeVersion:req.body.noticeVersion}); res.json({enrolled:true});}));
 router.use((req,res,next)=>identity('/resolve',{token:req.communityToken}).then(({proof})=>{req.communityProof=proof; next();}).catch(next));
 const read=(path,op,map=()=>({}))=>router.get(path,wrap(async(req,res)=>res.json(await db('community_private.read_api',[req.communityProof,op,map(req)]))));
 const optional=value=>value===undefined?undefined:id.parse(value);
 read('/me','me'); read('/tags','tags');
 router.get('/moderator/tags',wrap(async(req,res)=>res.json(await db('community_private.manage_tags',[req.communityProof,{}]))));
 router.post('/moderator/tags',wrap(async(req,res)=>{
  const args=require('zod').z.object({slug:require('zod').z.string().regex(/^[a-z0-9-]{1,60}$/),name:require('zod').z.string().min(1).max(80),active:require('zod').z.boolean()}).strict().parse(req.body);
  args.name=(await safety('/redact',{text:args.name})).text;
  res.json(await db('community_private.manage_tags',[req.communityProof,args]));
 }));
 read('/posts','feed',req=>({tag:optional(req.query.tag),before:optional(req.query.before)}));
 router.get('/posts/mine',wrap(async(req,res)=>res.json(await db('community_private.own_posts',[req.communityProof]))));
 read('/posts/:id','post',req=>({id:id.parse(req.params.id)}));
 read('/posts/:id/comments','comments',req=>({postId:id.parse(req.params.id),parentId:optional(req.query.parentId),before:optional(req.query.before)}));
 read('/care/threads','threads'); read('/care/threads/:id/messages','messages',req=>({id:id.parse(req.params.id),before:optional(req.query.before)}));
 read('/professional/cases','cases'); read('/professional/queue','queue'); read('/professional/cases/:id/revisions','review',req=>({id:id.parse(req.params.id)}));
 router.get('/professional/alerts',wrap(async(req,res)=>res.json(await db('community_private.read_alerts',[req.communityProof]))));
 const action=(path,op,schema)=>router.post(path,wrap(async(req,res)=>res.json(await db('community_private.action_api',[req.communityProof,op,schema.parse(req.body)]))));
 action('/reports','report',schemas.report); action('/help','help',schemas.help); action('/care/respond','respond',schemas.respond);
 action('/professional/claim','claim_case',schemas.simple); action('/posts/remove','remove_post',schemas.simple); action('/comments/remove','remove_comment',schemas.simple);
 action('/devices','register_device',schemas.register_device); action('/devices/remove','unregister_device',schemas.register_device);
 for(const [path,operation] of [['/posts','create_post'],['/posts/edit','edit_post'],['/comments','create_comment'],['/comments/edit','edit_comment'],['/care/messages','send_message']]) {
  router.post(path,wrap(async(req,res)=>res.json(await safety('/process',{proof:req.communityProof,operation,args:schemas[operation].parse(req.body)}))));
 }
 for(const operation of ['outreach','assess_case','close_case','review_revision']) {
  router.post(`/professional/${operation}`,wrap(async(req,res)=>{
   const args=schemas.professional.parse(req.body);
   args.reason=(await safety('/redact',{text:args.reason})).text;
   res.json(await db('community_private.professional_action',[req.communityProof,operation,args]));
  }));
 }
 router.get('/professional/reveals',wrap(async(req,res)=>res.json(await identity('/reveal',{token:req.communityToken,operation:'queue'}))));
 router.post('/professional/reveals/decide',wrap(async(req,res)=>{
  const args=schemas.decision.parse(req.body);
  args.reason=(await safety('/redact',{text:args.reason})).text;
  if(args.singleApproverReason) args.singleApproverReason=(await safety('/redact',{text:args.singleApproverReason})).text;
  res.json(await identity('/reveal',{token:req.communityToken,operation:'decide',args}));
 }));
 router.post('/professional/reveals/context',wrap(async(req,res)=>res.json(await identity('/reveal',{token:req.communityToken,operation:'context',args:{id:id.parse(req.body.id)}}))));
 router.post('/professional/reveals/contact',wrap(async(req,res)=>res.json(await identity('/reveal',{token:req.communityToken,operation:'contact',args:{id:id.parse(req.body.id)}}))));
 router.use((req,res)=>res.status(404).json({error:'not_found'})); router.use(safeErrors); return router;
}
function configuredRouter(env=process.env){return createCommunityRouter({db:createDatabase(env.COMMUNITY_DATABASE_URL),identity:createInternalClient(env.COMMUNITY_IDENTITY_URL,env.COMMUNITY_IDENTITY_SERVICE_KEY),safety:createInternalClient(env.COMMUNITY_SAFETY_URL,env.COMMUNITY_SAFETY_SERVICE_KEY)});}
module.exports={createCommunityRouter,configuredRouter};
