/** Host-side controls for the isolated emulator test APK only. */
const {execFileSync} = require('node:child_process');
const fs = require('node:fs');
const mode = process.argv[2] || 'lock';
const device = 'emulator-5554';
const pkg = 'com.healthon.health_on_patient.emulator_test';
const adb = (...args) => execFileSync('adb',['-s',device,...args],{encoding:'utf8',stdio:['ignore','pipe','ignore']});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function control(route,post=false) {
  const response=await fetch(`http://127.0.0.1:4460/__test__/${route}`,{method:post?'POST':'GET',
    headers:{Authorization:'Bearer synthetic-emulator-control'},signal:AbortSignal.timeout(2000)});
  if(!response.ok) throw new Error('ERR_DRILL_CONTROL');
  return response.json();
}
function approveTestPermissions() {
  const activities=adb('shell','dumpsys','activity','activities');
  if(!/topResumedActivity=.*permissioncontroller/.test(activities) || !activities.includes(`launchedFromPackage=${pkg}`)) return;
  adb('shell','uiautomator','dump','/sdcard/medbrief-test-ui.xml');
  const xml=adb('shell','cat','/sdcard/medbrief-test-ui.xml');
  for(const id of ['permission_allow_foreground_only_button','permission_allow_button']) {
    const node=xml.match(new RegExp(`<node[^>]*resource-id="com.android.permissioncontroller:id/${id}"[^>]*bounds="\\[(\\d+),(\\d+)\\]\\[(\\d+),(\\d+)\\]"`));
    if(node){adb('shell','input','tap',String((+node[1]+ +node[3])/2|0),String((+node[2]+ +node[4])/2|0));break;}
  }
}
function pendingCount() {
  try {return adb('shell',`run-as ${pkg} find files/consult_pending_chunks -name '*.aac'`).trim().split('\n').filter(Boolean).length;}
  catch(_){return 0;}
}
(async()=>{
  const evidence={mode,screenOffMs:0,outageMs:0,pendingFilePeak:0};
  let started=0,locked=0,outage=0,plane=false,woke=false,call=false,answered=false,cancelled=false,lastReport=0;
  const deadline=Date.now()+11*60*1000;
  try {
    while(Date.now()<deadline) {
      let status;
      try {status=await control('status');}catch(_){await delay(1000);continue;}
      if(!status.recordingObserved) approveTestPermissions();
      if(mode==='lock' && status.readyObserved && !locked) {
        adb('shell','input','keyevent','223');locked=Date.now();
        evidence.screenAsleepAtStart=/mWakefulness=Asleep/.test(adb('shell','dumpsys','power'));
      }
      if(status.recordingObserved && !started) started=status.recordingObserved;
      if(started) {
        const elapsed=Date.now()-started;
        if(mode==='lock') {
          if(elapsed>=10000 && !outage) {
            await control('offline',true);outage=Date.now();
            adb('shell','cmd','connectivity','airplane-mode','enable');plane=true;
            evidence.airplaneEnabled=adb('shell','settings','get','global','airplane_mode_on').trim()==='1';
          }
          if(plane && Date.now()-outage>=30000) {
            adb('shell','cmd','connectivity','airplane-mode','disable');plane=false;evidence.outageMs=Date.now()-outage;
            evidence.airplaneRestored=adb('shell','settings','get','global','airplane_mode_on').trim()==='0';
          }
          if(elapsed>=300000 && !woke) {
            evidence.screenAsleepBeforeWake=/mWakefulness=Asleep/.test(adb('shell','dumpsys','power'));
            adb('shell','input','keyevent','224');adb('shell','wm','dismiss-keyguard');
            evidence.screenOffMs=Date.now()-locked;woke=true;
          }
        } else {
          if(elapsed>=10000 && !call){adb('emu','gsm','call','15551234567');call=true;}
          if(elapsed>=12000 && !answered){adb('emu','gsm','accept','15551234567');answered=true;}
          if(elapsed>=22000 && !cancelled){adb('emu','gsm','cancel','15551234567');cancelled=true;}
        }
        evidence.pendingFilePeak=Math.max(evidence.pendingFilePeak,pendingCount());
        if(Date.now()-lastReport>=30000) {
          console.log(JSON.stringify({elapsedSec:Math.round(elapsed/1000),received:status.chunks.length,
            processed:status.outcomes.length,pendingFilePeak:evidence.pendingFilePeak,offlineRejected:status.offlineRejected}));
          lastReport=Date.now();
        }
        if(status.device==='flushed') {
          Object.assign(evidence,{chunks:status.chunks.length,expected:status.expected,
            gaps:status.gaps,stateReads:status.stateReads,offlineRejected:status.offlineRejected,
            socketDisabled:status.blockSockets});
          fs.writeFileSync(`/tmp/medbrief-emulator-${mode}-evidence.json`,JSON.stringify(evidence,null,2));
          console.log(JSON.stringify(evidence));return;
        }
      }
      await delay(500);
    }
    throw new Error('ERR_DRILL_TIMEOUT');
  } finally {
    if(plane) adb('shell','cmd','connectivity','airplane-mode','disable');
    if(call&&!cancelled) {try{adb('emu','gsm','cancel','15551234567');}catch(_){}}
    if(locked&&!woke){adb('shell','input','keyevent','224');adb('shell','wm','dismiss-keyguard');}
  }
})().catch(error=>{console.error(error.message?.startsWith('ERR_')?error.message:'ERR_EMULATOR_DRILL');process.exitCode=1;});
