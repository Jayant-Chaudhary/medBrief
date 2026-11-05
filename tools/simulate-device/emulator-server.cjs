/** Isolated synthetic emulator backend. Production routes and worker, RAM-only
 * Supabase stand-in. Never loads project credentials or writes a real database. */
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID, randomBytes } = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const serverRequire = createRequire(path.join(root, 'server/package.json'));
Object.assign(process.env, { NODE_ENV: 'test', LOG_LEVEL: 'silent',
  SESSION_TOKEN_SECRET: randomBytes(32).toString('hex'), STT_PROVIDER: 'local',
  CONSULT_AUDIO_CACHE_ENABLED: 'false', WHISPER_SERVICE_URL: 'http://127.0.0.1:8001' });
const express = serverRequire('express');
const controlToken = 'synthetic-emulator-control';
const patientToken = 'synthetic-emulator-patient';
const doctor = randomUUID(), patient = randomUUID();
let tables, objects, sessionId, events, outcomes, offlineUntil = 0, active = false;
let blockSockets = false, stateReads = 0, offlineRejected = 0;
let readyObserved = 0, recordingObserved = 0;
function reset() {
  sessionId = randomUUID(); objects = new Map(); events = []; outcomes = [];
  offlineUntil = 0;
  blockSockets = false; stateReads = 0; offlineRejected = 0;
  readyObserved = 0; recordingObserved = 0;
  tables = {
    profiles: [{id: patient, role: 'patient', full_name: 'Synthetic', clinician_details: null}],
    consult_sessions: [{id: sessionId, patient_id: patient, doctor_id: doctor,
      patient_required: true, status: 'waiting', room_code: 'SYN234',
      room_code_expires_at: new Date(Date.now() + 3600000).toISOString(), language_code: 'en'}],
    session_consents: [{id: randomUUID(), session_id: sessionId, role: 'doctor',
      user_id: doctor, accepted_at: new Date().toISOString(), consent_text_version: 'v1.0'}],
    session_devices: [{id:randomUUID(), session_id:sessionId, device:'doctor', status:'ready'}],
    audio_chunks: [], transcription_jobs: [], segments: [], consult_audio_gaps: [],
  };
}
reset();
const db = {
  auth: { getUser: async (token) => ({data:{user:token === patientToken ? {id:patient} : null},error:null}) },
  storage: { from: () => ({
    upload: async (key, bytes) => {objects.set(key, Buffer.from(bytes)); return {data:{path:key},error:null};},
    download: async (key) => ({data:objects.has(key) ? {arrayBuffer:async()=>objects.get(key)} : null,error:null}),
  }) },
  from(table) {
    if (!tables[table]) throw new Error('ERR_SYNTHETIC_TABLE');
    let action = 'select', payload, conflict, filters = [], maximum;
    const chain = {
      select() {return this;},
      eq(key,value) {filters.push(row=>row[key]===value);return this;},
      in(key,values) {filters.push(row=>values.includes(row[key]));return this;},
      lt(key,value) {filters.push(row=>row[key]<value);return this;},
      order() {return this;}, limit(value) {maximum=value;return this;},
      insert(value) {action='insert';payload=value;return this;},
      upsert(value, options={}) {action='upsert';payload=value;conflict=options.onConflict;return this;},
      update(value) {action='update';payload=value;return this;},
      single: async()=>finish(true), maybeSingle: async()=>finish(true),
      then(resolve,reject) {return Promise.resolve(finish(false)).then(resolve,reject);},
    };
    function finish(single) {
      let rows = tables[table].filter(row=>filters.every(filter=>filter(row)));
      if (action==='insert' || action==='upsert') {
        rows=[];
        for (const item of Array.isArray(payload) ? payload : [payload]) {
          const keys = conflict?.split(',') || (table==='audio_chunks' ? ['session_id','device','seq']
            : table==='consult_audio_gaps' ? ['session_id','device','gap_id'] : ['id']);
          const existing = tables[table].find(row=>keys.every(key=>item[key]!==undefined && row[key]===item[key]));
          if(existing && action==='insert') return {data:null,error:{code:'23505'}};
          const row=existing || {id:randomUUID(),received_at:new Date().toISOString()};
          Object.assign(row,item);
          if(!existing) tables[table].push(row);
          rows.push(row);
        }
      } else if(action==='update') rows.forEach(row=>Object.assign(row,payload));
      if (maximum!==undefined) rows=rows.slice(0,maximum);
      return {data:single ? (rows[0] ? {...rows[0]} : null) : rows.map(row=>({...row})),error:null};
    }
    return chain;
  },
};
const dbPath = serverRequire.resolve('./src/config/supabaseAdminClient');
require.cache[dbPath] = {id:dbPath,filename:dbPath,loaded:true,exports:db};
const sessions = serverRequire('./src/services/consultAudio/session.service');
const { processJob } = serverRequire('./src/services/consultAudio/transcriptionWorker');
// NODE_ENV=test intentionally defaults the production factory to fake STT.
// Native acceptance selects the local provider explicitly and reports its name.
const provider = serverRequire('./src/services/consultAudio/stt/providerFactory').getProvider('local');
const { consultRouter, timeRouter } = serverRequire('./src/routes/consultAudio.routes');
const { initSocketServer } = serverRequire('./src/services/consultAudio/socket.service');
const http = require('node:http');
const app = express(); const server = http.createServer(app);
const io = initSocketServer(server);
io.use((socket,next)=>blockSockets ? next(new Error('ERR_SYNTHETIC_SOCKET_OFF')) : next());
app.use(express.json());
app.use('/__test__', (req,res,next)=>req.headers.authorization===`Bearer ${controlToken}`
  ? next() : res.status(401).json({error:'ERR_SYNTHETIC_AUTH'}));
app.post('/__test__/reset', (req,res)=>{
  if(active) return res.status(409).json({error:'ERR_SYNTHETIC_BUSY'});
  reset();res.json({sessionId,roomCode:'SYN234'});
});
app.get('/__test__/status', (req,res)=>res.json({sessionId,
  state:tables.consult_sessions[0].status, chunks:tables.audio_chunks.map(c=>({seq:c.seq,
    durationMs:c.duration_ms,status:c.status,bytes:c.size_bytes,silent:c.silent})),
  device:tables.session_devices.find(d=>d.device==='patient')?.status,
  expected:tables.session_devices.find(d=>d.device==='patient')?.expected_chunks ?? null,
  gaps:tables.consult_audio_gaps.map(g=>({reason:g.reason_code,durationMs:g.duration_ms})),
  outcomes,events,offline:Date.now()<offlineUntil,stateReads,offlineRejected,blockSockets,readyObserved,recordingObserved}));
app.post('/__test__/observed_ready',(req,res)=>{readyObserved=Date.now();res.json({ok:true});});
app.post('/__test__/observed_recording',(req,res)=>{recordingObserved=Date.now();res.json({ok:true});});
app.post('/__test__/start', async(req,res,next)=>{
  try {await sessions.startConsultation({sessionId,doctorUserId:doctor});res.json({ok:true});} catch(error){next(error);}
});
app.post('/__test__/end', async(req,res,next)=>{
  try {await sessions.endConsultation({sessionId,doctorUserId:doctor});res.json({ok:true});} catch(error){next(error);}
});
app.post('/__test__/offline', (req,res)=>{offlineUntil=Date.now()+30000;res.json({ok:true});});
app.post('/__test__/socket_off', (req,res)=>{blockSockets=true;io.disconnectSockets(true);res.json({ok:true});});
app.use('/api/consults',(req,res,next)=>{
  if(req.path.endsWith('/state')) stateReads++;
  if(Date.now()<offlineUntil) {offlineRejected++;req.socket.destroy();return;}
  res.on('finish',()=>{
    if(res.statusCode<300 && req.method==='POST') {
      if(req.path.endsWith('/chunks')) events.push(`chunk:${req.headers['x-seq']}`);
      if(req.path.endsWith('/final')) events.push('final');
      void pump();
    }
  });
  next();
},consultRouter);
app.use('/api/time',timeRouter);
app.use((error,req,res,next)=>{res.status(error.status || 500).json({error:'ERR_SYNTHETIC_REQUEST'});});
async function pump() {
  if(active) return;
  active=true;
  try {
    for(const job of tables.transcription_jobs.filter(j=>j.status==='queued')) {
      job.status='transcribing';job.attempts=1;
      const result=await processJob({...job}, provider);
      const chunk=tables.audio_chunks.find(c=>c.id===job.chunk_id);
      outcomes.push({seq:chunk.seq,ok:result.ok,errorCode:result.ok ? null : result.error,
        provider:provider.name,segments:result.segmentsCount ?? null});
    }
  } finally {active=false;}
}
server.listen(4460,'127.0.0.1',()=>console.log(JSON.stringify({fixtureReady:true,port:4460})));
function stop(){server.close(()=>process.exit(0));}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
