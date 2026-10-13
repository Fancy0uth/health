import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {judgeDataDirectory,loadDeviceAccount} from '../scripts/launch-judge.mjs';
test('distribution data lives outside the install on macOS and Windows',()=>{
 assert.equal(judgeDataDirectory({platform:'darwin',home:'/Users/example',env:{}}),'/Users/example/Library/Application Support/HealthThread');
 assert.equal(judgeDataDirectory({platform:'win32',home:'C:\\Users\\Judge',env:{LOCALAPPDATA:'C:\\Users\\Judge\\AppData\\Local'}}),'C:\\Users\\Judge\\AppData\\Local\\HealthThread');
});
test('device account is private and stable across program updates',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-judge-'));t.after(()=>rm(dir,{recursive:true,force:true}));const first=await loadDeviceAccount(dir);assert.ok(first.password.length>=32);assert.deepEqual(await loadDeviceAccount(dir),first);
 const file=join(dir,'device-account.json');if(process.platform!=='win32')assert.equal((await stat(file)).mode&0o777,0o600);
 await writeFile(file,'{}');await assert.rejects(loadDeviceAccount(dir),/LOCAL_ACCOUNT_INVALID/);assert.equal(await readFile(file,'utf8'),'{}');
});

import {spawn} from 'node:child_process';
import {symlink} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const launcher=fileURLToPath(new URL('../scripts/launch-judge.mjs',import.meta.url));
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function startLauncher(script,dir){
 const child=spawn(process.execPath,[script],{env:{...process.env,HEALTHTHREAD_DATA_DIR:dir,HEALTHTHREAD_NO_OPEN:'1'},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 const exited=new Promise(resolve=>{child.once('error',e=>resolve({error:e}));child.once('exit',(code,signal)=>resolve({code,signal}));});
 return{child,exited,output:()=>output};
}
async function waitForInstance(dir,processes){
 const until=Date.now()+15000;
 while(Date.now()<until){
  try{const state=JSON.parse(await readFile(join(dir,'instance.json'),'utf8'));if(state.port){const response=await fetch(`http://127.0.0.1:${state.port}/api/health`,{signal:AbortSignal.timeout(1000)});if((await response.json()).instance_id===state.instance_id)return state;}}catch{}
  if(processes.every(p=>p.child.exitCode!==null))assert.fail('Launcher exited before becoming ready: '+processes.map(p=>p.output()).join('\n'));
  await delay(30);
 }
 assert.fail('Launcher did not become ready: '+processes.map(p=>p.output()).join('\n'));
}
async function waitForExit(process){let timeout;try{return await Promise.race([process.exited,new Promise(resolve=>{timeout=setTimeout(()=>resolve({timeout:true}),12000);})]);}finally{clearTimeout(timeout);}}
async function stopLaunchers(processes){for(const p of processes)if(p.child.exitCode===null)p.child.kill('SIGTERM');await Promise.all(processes.map(async p=>{const timer=setTimeout(()=>p.child.kill('SIGKILL'),3000);await p.exited;clearTimeout(timer);}));}
test('direct invocation through a symlink starts an isolated authenticated setup server',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-link-'));const link=join(dir,'launch-via-link.mjs');await symlink(launcher,link);const started=startLauncher(link,join(dir,'data'));t.after(async()=>{await stopLaunchers([started]);await rm(dir,{recursive:true,force:true});});
 const state=await waitForInstance(join(dir,'data'),[started]);assert.equal(state.pid,started.child.pid);const base=`http://127.0.0.1:${state.port}`;
 const login=await fetch(base+'/api/auth/launch',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:state.launch_token})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0];const configuration=await fetch(base+'/api/model-config',{headers:{Cookie:cookie}});const status=await configuration.json();assert.equal(status.configured,false);assert.equal(status.can_manage,true);assert.equal(status.runtime_status,'unconfigured');assert.equal((await fetch(base+'/setup/')).status,200);
});
test('simultaneous launchers reuse one ready process and leave its descriptor intact',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-race-'));const processes=Array.from({length:4},()=>startLauncher(launcher,dir));t.after(async()=>{await stopLaunchers(processes);await rm(dir,{recursive:true,force:true});});const state=await waitForInstance(dir,processes);const owner=processes.find(p=>p.child.pid===state.pid);assert.ok(owner);const others=processes.filter(p=>p!==owner);
 for(const process of others){const result=await waitForExit(process);assert.equal(result.code,0,process.output());}
 assert.equal(owner.child.exitCode,null);assert.deepEqual(JSON.parse(await readFile(join(dir,'instance.json'),'utf8')),state);await assert.rejects(readFile(join(dir,'startup.log')),{code:'ENOENT'});
 // A second invocation can observe an empty file while the winning process initially writes its descriptor.
 await writeFile(join(dir,'instance.json'),'');const duringWrite=startLauncher(launcher,dir);processes.push(duringWrite);await delay(250);await writeFile(join(dir,'instance.json'),JSON.stringify(state));const result=await waitForExit(duringWrite);assert.equal(result.code,0,duringWrite.output());assert.equal(owner.child.exitCode,null);
});

import http from 'node:http';
async function listening(server){await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});return server.address().port;}
test('a stale descriptor whose PID was reused is reclaimed only after refused connections',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-reused-pid-'));const probe=http.createServer();const port=await listening(probe);await new Promise(resolve=>probe.close(resolve));
 const stale={pid:process.pid,instance_id:'abandoned-instance',port,launch_token:'abandoned-token'};await writeFile(join(dir,'instance.json'),JSON.stringify(stale));const started=startLauncher(launcher,dir);t.after(async()=>{await stopLaunchers([started]);await rm(dir,{recursive:true,force:true});});const ready=await waitForInstance(dir,[started]);assert.equal(ready.pid,started.child.pid);assert.notEqual(ready.instance_id,stale.instance_id);assert.doesNotThrow(()=>process.kill(process.pid,0));
});
test('a responding different server never authorizes reclaiming an existing instance descriptor',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-unmatched-'));const probe=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({instance_id:'another-live-service'}));});const port=await listening(probe);const stale={pid:process.pid,instance_id:'expected-instance',port,launch_token:'unused-token'};await writeFile(join(dir,'instance.json'),JSON.stringify(stale));const started=startLauncher(launcher,dir);t.after(async()=>{await stopLaunchers([started]);probe.closeAllConnections();await new Promise(resolve=>probe.close(resolve));await rm(dir,{recursive:true,force:true});});assert.equal((await waitForExit(started)).code,1);assert.deepEqual(JSON.parse(await readFile(join(dir,'instance.json'),'utf8')),stale);
});
test('a timeout followed by refused connections does not authorize reclaiming a descriptor',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-timeout-'));let stopTimer;const probe=http.createServer(()=>{stopTimer??=setTimeout(()=>{probe.closeAllConnections();probe.close();},1500);});const port=await listening(probe);const stale={pid:process.pid,instance_id:'slow-live-service',port,launch_token:'unused-token'};await writeFile(join(dir,'instance.json'),JSON.stringify(stale));const started=startLauncher(launcher,dir);t.after(async()=>{clearTimeout(stopTimer);await stopLaunchers([started]);probe.closeAllConnections();if(probe.listening)await new Promise(resolve=>probe.close(resolve));await rm(dir,{recursive:true,force:true});});assert.equal((await waitForExit(started)).code,1);assert.deepEqual(JSON.parse(await readFile(join(dir,'instance.json'),'utf8')),stale);
});
test('simultaneous stale-descriptor recovery preserves the new single owner',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-reclaim-race-'));const probe=http.createServer();const port=await listening(probe);await new Promise(resolve=>probe.close(resolve));await writeFile(join(dir,'instance.json'),JSON.stringify({pid:process.pid,instance_id:'stale-shared-instance',port,launch_token:'unused-token'}));const processes=Array.from({length:4},()=>startLauncher(launcher,dir));t.after(async()=>{await stopLaunchers(processes);await rm(dir,{recursive:true,force:true});});const ready=await waitForInstance(dir,processes);const owner=processes.find(p=>p.child.pid===ready.pid);assert.ok(owner);for(const process of processes.filter(p=>p!==owner))assert.equal((await waitForExit(process)).code,0,process.output());assert.equal(owner.child.exitCode,null);assert.deepEqual(JSON.parse(await readFile(join(dir,'instance.json'),'utf8')),ready);await assert.rejects(readFile(join(dir,'startup.log')),{code:'ENOENT'});
});
test('a recovery guard left by a dead process is removed before recovering the stale instance',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-orphan-guard-'));const dead=spawn(process.execPath,['-e',''],{stdio:'ignore'});await new Promise(resolve=>dead.once('exit',resolve));const stale={pid:dead.pid,instance_id:'dead-owner',port:12345,launch_token:'unused'};await writeFile(join(dir,'instance.json'),JSON.stringify(stale));await writeFile(join(dir,'instance.json.recovery'),JSON.stringify({pid:dead.pid,owner_id:'orphan-guard'}));const started=startLauncher(launcher,dir);t.after(async()=>{await stopLaunchers([started]);await rm(dir,{recursive:true,force:true});});const ready=await waitForInstance(dir,[started]);assert.equal(ready.pid,started.child.pid);await assert.rejects(readFile(join(dir,'instance.json.recovery')),{code:'ENOENT'});
});
test('an occupied recovery guard stops retrying at a finite deadline without removing live ownership',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-live-guard-'));const dead=spawn(process.execPath,['-e',''],{stdio:'ignore'});await new Promise(resolve=>dead.once('exit',resolve));const stale={pid:dead.pid,instance_id:'dead-instance-live-guard',port:12345,launch_token:'unused'};const guard={pid:process.pid,owner_id:'live-guard'};await writeFile(join(dir,'instance.json'),JSON.stringify(stale));await writeFile(join(dir,'instance.json.recovery'),JSON.stringify(guard));const started=startLauncher(launcher,dir);t.after(async()=>{await stopLaunchers([started]);await rm(dir,{recursive:true,force:true});});assert.equal((await waitForExit(started)).code,1);assert.deepEqual(JSON.parse(await readFile(join(dir,'instance.json.recovery'),'utf8')),guard);assert.deepEqual(JSON.parse(await readFile(join(dir,'instance.json'),'utf8')),stale);
});
test('an incomplete recovery guard produces a bounded failure without deleting unknown ownership',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'ht-launch-empty-guard-'));const dead=spawn(process.execPath,['-e',''],{stdio:'ignore'});await new Promise(resolve=>dead.once('exit',resolve));await writeFile(join(dir,'instance.json'),JSON.stringify({pid:dead.pid,instance_id:'abandoned-incomplete-guard'}));await writeFile(join(dir,'instance.json.recovery'),'');const wrapper=join(dir,'bounded-launch.mjs');await writeFile(wrapper,`import {launchJudge} from ${JSON.stringify(new URL('../scripts/launch-judge.mjs',import.meta.url).href)};await launchJudge({deadline:Date.now()+300}).catch(()=>{process.exitCode=1;});`);const started=startLauncher(wrapper,dir);t.after(async()=>{await stopLaunchers([started]);await rm(dir,{recursive:true,force:true});});assert.equal((await waitForExit(started)).code,1);assert.equal(await readFile(join(dir,'instance.json.recovery'),'utf8'),'');
});
