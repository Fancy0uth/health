import {realpathSync,readFileSync,statSync,unlinkSync} from 'node:fs';
import {mkdir,readFile,writeFile,open,unlink,chmod,rename} from 'node:fs/promises';
import {join,resolve,win32} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomBytes,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
export function judgeDataDirectory({platform=process.platform,home=homedir(),env=process.env}={}){
 if(env.HEALTHTHREAD_DATA_DIR)return resolve(env.HEALTHTHREAD_DATA_DIR);
 if(platform==='win32')return win32.join(env.LOCALAPPDATA||win32.join(home,'AppData','Local'),'HealthThread');
 return join(home,platform==='darwin'?'Library/Application Support':'.local/share','HealthThread');
}
export async function loadDeviceAccount(dir){
 await mkdir(dir,{recursive:true,mode:0o700});const file=join(dir,'device-account.json');
 try{await writeFile(file,JSON.stringify({username:'reviewer',password:randomBytes(32).toString('base64url')}),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
 let value;try{value=JSON.parse(await readFile(file,'utf8'));}catch{throw Error('LOCAL_ACCOUNT_INVALID');}
 if(value.username!=='reviewer'||typeof value.password!=='string'||value.password.length<32)throw Error('LOCAL_ACCOUNT_INVALID');
 return value;
}
function openBrowser(url){if(process.env.HEALTHTHREAD_NO_OPEN==='1')return;const command=process.platform==='darwin'?'/usr/bin/open':process.platform==='win32'?'rundll32.exe':'xdg-open';const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];const child=spawn(command,args,{detached:true,stdio:'ignore',windowsHide:true});child.on('error',()=>{});child.unref();}
async function readInstance(file){for(let i=0;i<30;i++){try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')throw e;await new Promise(r=>setTimeout(r,100));}}throw Error('LOCAL_INSTANCE_INVALID');}
// Only one recovering launcher may compare and remove an abandoned descriptor.
// Normal launchers still compete through the original exclusive instance-file creation.
function removeDeadRecoveryGuard(file){
 // Never reclaim live, unreadable, or partially written ownership. The launch deadline
 // makes those cases finite; an incomplete file does not establish permission to remove it.
 try{
  const before=statSync(file);const text=readFileSync(file,'utf8');const owner=JSON.parse(text);
  if(!Number.isSafeInteger(owner.pid)||owner.pid<=0||typeof owner.owner_id!=='string')return;
  try{process.kill(owner.pid,0);return;}catch(error){if(error.code!=='ESRCH')return;}
  const current=statSync(file);
  if(current.dev===before.dev&&current.ino===before.ino&&readFileSync(file,'utf8')===text)unlinkSync(file);
 }catch{}
}
async function reclaimInstance(file,expected){
 let guard;
 try{guard=await open(file+'.recovery','wx',0o600);}catch(error){if(error.code==='EEXIST'){removeDeadRecoveryGuard(file+'.recovery');return false;}throw error;}
 try{
  await guard.writeFile(JSON.stringify({pid:process.pid,owner_id:randomUUID()}));
  let current;try{current=await readInstance(file);}catch(error){if(error.code==='ENOENT')return false;throw error;}
  if(JSON.stringify(current)!==JSON.stringify(expected))return false;
  await unlink(file);return true;
 }finally{await guard.close();await unlink(file+'.recovery').catch(()=>{});}
}
export async function launchJudge({deadline=Date.now()+10000}={}){
 if(Date.now()>=deadline)throw Error('LOCAL_INSTANCE_BUSY');
 process.title='HealthThread';
 const dir=judgeDataDirectory();await mkdir(dir,{recursive:true,mode:0o700});const lock=join(dir,'instance.json');const instanceId=randomUUID();let ownsLock=false,app;
 try{
  try{const handle=await open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,instance_id:instanceId}));await handle.close();ownsLock=true;}
  catch(e){if(e.code!=='EEXIST')throw e;let previous;try{previous=await readInstance(lock);}catch(error){if(error.code==='ENOENT')return launchJudge({deadline});throw Error('LOCAL_INSTANCE_INVALID');}
   let alive=true;try{process.kill(previous.pid,0);}catch(error){if(error.code==='ESRCH')alive=false;}
   if(!alive){await reclaimInstance(lock,previous);await new Promise(r=>setTimeout(r,100));return launchJudge({deadline});}
   let candidate=null,refusals=0,onlyRefused=true;
   for(let i=0;i<30;i++){
    if(Date.now()>=deadline)throw Error('LOCAL_INSTANCE_BUSY');
    try{previous=await readInstance(lock);}catch(error){if(error.code==='ENOENT')return launchJudge({deadline});throw error;}
    const identity=JSON.stringify(previous);
    if(identity!==candidate){candidate=identity;refusals=0;onlyRefused=true;}
    // A published final descriptor means the listener was already bound. A live PID alone
    // cannot establish ownership after a forced shutdown because operating systems reuse PIDs.
    if(Number.isInteger(previous.port)&&previous.port>0&&previous.port<=65535&&typeof previous.instance_id==='string'&&typeof previous.launch_token==='string'){
     try{const res=await fetch(`http://127.0.0.1:${previous.port}/api/health`,{signal:AbortSignal.timeout(1000)});onlyRefused=false;const health=await res.json();if(health.instance_id===previous.instance_id){openBrowser(`http://localhost:${previous.port}/setup/#launch=${previous.launch_token}`);return null;}}
     catch(error){if(error.cause?.code==='ECONNREFUSED')refusals++;else onlyRefused=false;}
     if(onlyRefused&&refusals>=3){
      await reclaimInstance(lock,previous);
      await new Promise(r=>setTimeout(r,100));
      return launchJudge({deadline});
     }
    }
    await new Promise(r=>setTimeout(r,200));
   }
   throw Error('LOCAL_INSTANCE_BUSY');
  }
  const root=fileURLToPath(new URL('../',import.meta.url));process.env.AGH_ROOT=join(root,'.runtime/agnes-harness');process.env.AGH_ACCOUNT_HOME=join(dir,'agh-account');process.env.AGH_HOME=process.env.AGH_ACCOUNT_HOME;process.env.AGH_ACCOUNT_PROFILE='local-dev';process.env.HEALTHTHREAD_AGH_HOME=join(dir,'agh-home');
  const [{createApp},{createModelConfiguration}]=await Promise.all([import('../services/api/domain-server.mjs'),import('../services/api/model-configuration.mjs')]);
  const account=await loadDeviceAccount(dir);const modelConfiguration=createModelConfiguration();await modelConfiguration.initialize();const token=randomBytes(32).toString('base64url');
  app=createApp({root,dbPath:join(dir,'healththread-domain.sqlite'),demoAccounts:[account],agentFactory:store=>modelConfiguration.createAgent(store),modelConfiguration,modelConfigOwnerUsername:account.username,launchCredentials:{token,...account},instanceId});await app.listen(0);
  const port=app.server.address().port;const stateFile=join(dir,`instance-${instanceId}.tmp`);await writeFile(stateFile,JSON.stringify({pid:process.pid,instance_id:instanceId,port,launch_token:token}),{mode:0o600});await rename(stateFile,lock);await chmod(lock,0o600);
  const close=async()=>{await app.close();try{const current=JSON.parse(await readFile(lock,'utf8'));if(current.instance_id===instanceId)await unlink(lock);}catch{}};
  for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{close().then(()=>process.exit(0));});
  openBrowser(`http://localhost:${port}/setup/#launch=${token}`);return {app,close,port};
 }catch(e){await app?.close().catch(()=>{});if(ownsLock)await unlink(lock).catch(()=>{});throw e;}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url)){
 launchJudge().catch(async()=>{const dir=judgeDataDirectory();await mkdir(dir,{recursive:true,mode:0o700});await writeFile(join(dir,'startup.log'),`${new Date().toISOString()} STARTUP_FAILED\n`,{mode:0o600});const errorPage=join(dir,'startup-error.html');await writeFile(errorPage,'<!doctype html><meta charset="utf-8"><title>HealthThread 启动提示</title><h1>暂时无法启动 HealthThread</h1><p>请关闭已打开的 HealthThread 后重新打开。若仍失败，请将本目录的 startup.log 发给项目负责人。</p>',{mode:0o600});openBrowser(pathToFileURL(errorPage).href);process.exitCode=1;});
}
