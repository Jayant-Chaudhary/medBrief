const crypto=require('node:crypto');
const fs=require('node:fs');
const {createDatabase}=require('./database');

// FCM HTTP v1 via a service-account assertion; no notification text from posts.
function createPushSender(credentials) {
 let cached;
 return async token=>{
  if(!credentials) throw new Error('Push configuration missing');
  if(!cached || cached.expires<Date.now()) {
   const now=Math.floor(Date.now()/1000);
   const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
   const unsigned=`${encode({alg:'RS256',typ:'JWT'})}.${encode({iss:credentials.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})}`;
   const assertion=`${unsigned}.${crypto.sign('RSA-SHA256',Buffer.from(unsigned),credentials.private_key).toString('base64url')}`;
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(10000)});
   if(!response.ok) throw new Error('Push authentication unavailable');
   const data=await response.json(); cached={token:data.access_token,expires:Date.now()+3000000};
  }
  const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(credentials.project_id)}/messages:send`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${cached.token}`},body:JSON.stringify({message:{fid:token,notification:{title:'MedBrief',body:'You have a new message.'},android:{priority:'HIGH'}}}),signal:AbortSignal.timeout(10000)});
  if(!response.ok) throw new Error('Push delivery unavailable');
 };
}
async function runOnce(db,send) {
 const jobs=await db('community_private.worker_tick');
 for(const job of jobs) {
  let delivered=job.tokens.length>0;
  for(const token of job.tokens) { try {await send(token);} catch {delivered=false;} }
  await db('community_private.finish_push',[job.jobId,delivered]);
 }
}
if(require.main===module){
 const db=createDatabase(process.env.COMMUNITY_WORKER_DATABASE_URL);
 const credentials=process.env.COMMUNITY_FCM_CREDENTIALS_FILE?JSON.parse(fs.readFileSync(process.env.COMMUNITY_FCM_CREDENTIALS_FILE,'utf8')):null;
 runOnce(db,createPushSender(credentials)).catch(()=>{process.stderr.write('Community worker unavailable; operator action required.\n');process.exitCode=1;});
}
module.exports={createPushSender,runOnce};
