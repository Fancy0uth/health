import {LIMITS,DomainError,errorBody} from './domain-errors.mjs';
const PUBLIC_CODES=new Set(['AGENT_NOT_CONFIGURED','AGNES_PROVIDER_REQUIRED','DEPENDENCY_UNAVAILABLE','DEADLINE_EXCEEDED','MISSING_STAGED_OUTPUT','INVALID_AGENT_OUTPUT','TOOL_SEQUENCE_REQUIRED','REVISION_CONFLICT','SCOPE_REVOKED','RUN_CANCELLED','AGH_NOT_READY','OUTPUT_REPAIR_EXHAUSTED']);
export class DispatchQueue {
 constructor(store,agent=null,{limits={},onDiagnostic=event=>console.error(JSON.stringify(event))}={}){
  this.store=store;this.agent=agent;this.limits={...LIMITS,...limits};this.onDiagnostic=onDiagnostic;
  this.running=new Map();this.pendingFailures=new Set();this.closed=false;
  this.dispatchFailures=0;this.nextAttemptAt=0;this.suspended=false;this.lastError=null;
  this.timer=setInterval(()=>this.kick(),250);this.timer.unref();this.kick();
 }
 status(){
  return {state:this.suspended?'suspended':this.dispatchFailures?'backoff':'ready',suspended:this.suspended,consecutive_failures:this.dispatchFailures,next_attempt_at:this.nextAttemptAt||null,last_error:this.lastError?{...this.lastError}:null};
 }
 recordFailure(error,phase,runId=null){
  this.dispatchFailures++;
  this.suspended=this.dispatchFailures>=this.limits.dispatchMaxAttempts;
  const delay=Math.min(this.limits.dispatchBackoffMaxMs,this.limits.dispatchBackoffMs*2**Math.min(this.dispatchFailures-1,20));
  this.nextAttemptAt=this.suspended?0:this.store.clock()+delay;
  const code=String(error?.code||'').startsWith('ERR_SQLITE')?'STORAGE_UNAVAILABLE':'DISPATCH_UNAVAILABLE';
  this.lastError={...errorBody(new DomainError(503,code,code),phase).error,retryable:!this.suspended};
  // Never log SQL, error.message, credentials, paths or source text. Logging cannot escape the scheduler.
  try{this.onDiagnostic({...this.lastError,run_id:runId,attempt:this.dispatchFailures,next_attempt_at:this.nextAttemptAt||null,suspended:this.suspended});}catch{}
 }
 settleUnrecordedFailures(){
  for(const runId of this.pendingFailures){
   const current=this.store.internalRun(runId);
   if(['needs_review','completed'].includes(current.status)){
    this.store.transaction(()=>{const latest=this.store.internalRun(runId);latest.execution_error=errorBody(new DomainError(503,'STORAGE_UNAVAILABLE','STORAGE_UNAVAILABLE'),'after_checkpoint').error;this.store.save('run',latest);});
   }else this.store.failRun(runId,'STORAGE_UNAVAILABLE','interrupted');
   this.pendingFailures.delete(runId);
  }
 }
 kick(){
  if(this.closed||this.suspended||this.store.clock()<this.nextAttemptAt)return;
  try{
   this.settleUnrecordedFailures();
   const pending=this.store.all('dispatch').filter(x=>x.state==='queued');
   for(const dispatch of pending){
    if(this.running.size>=this.limits.concurrency)break;
    if([...this.running.values()].filter(task=>task.owner===dispatch.owner).length>=this.limits.userConcurrency)continue;
    const run=this.store.claimRun(dispatch.run_id);if(!run)continue;
    const controller=new AbortController(),task={owner:run.owner,controller,promise:null};
    this.running.set(run.id,task);
    task.promise=this.execute(run,controller).catch(error=>{
     controller.abort();this.pendingFailures.add(run.id);this.recordFailure(error,'dispatch_execution',run.id);
    }).finally(()=>{this.running.delete(run.id);if(!this.closed)queueMicrotask(()=>this.kick());});
   }
   this.dispatchFailures=0;this.nextAttemptAt=0;this.lastError=null;
  }catch(error){this.recordFailure(error,'dispatch_claim');}
 }
 // Explicit operator recovery after the finite retry budget; never replays an unknown remote effect.
 resume(){if(!this.closed){this.suspended=false;this.dispatchFailures=0;this.nextAttemptAt=0;this.kick();}return this.status();}
 async execute(run,controller){let timeout,abortHandler;try{
  if(!this.agent||!['fixture','real'].includes(this.agent.mode))throw new DomainError(503,'AGENT_NOT_CONFIGURED');
  const deadline=Math.max(1,Math.min(this.limits.deadlineMs,run.deadline-this.store.clock()));
  const execute=Promise.resolve().then(async()=>{if(this.agent.isReady&&!(await this.agent.isReady({signal:controller.signal})))throw new DomainError(503,'AGH_NOT_READY');return this.agent.run({run,scope:{run_id:run.id,allowed_source_ids:run.source_ids,snapshot_revision:run.base_profile_revision,consent_version:run.consent_version,expires_at:run.expires_at},tools:this.boundTools(run.id,controller.signal),signal:controller.signal});});
  const expired=new Promise((_,reject)=>{timeout=setTimeout(()=>{reject(new DomainError(504,'DEADLINE_EXCEEDED'));controller.abort();},deadline);});
  const aborted=new Promise((_,reject)=>{abortHandler=()=>reject(new DomainError(409,'RUN_CANCELLED'));if(controller.signal.aborted)abortHandler();else controller.signal.addEventListener('abort',abortHandler,{once:true});});
  const output=await Promise.race([execute,expired,aborted]);const current=this.store.internalRun(run.id);
  if(!['needs_review','completed'].includes(current.status))throw new DomainError(422,'MISSING_STAGED_OUTPUT');
  let metadata={mode:'fixture'};
  if(this.agent.mode==='real'){
   const agh=output?.agh;if(!agh||agh.provider!=='agnes-ai'||typeof agh.session_id!=='string'||!agh.session_id||!Number.isSafeInteger(agh.last_seq)||agh.last_seq<0||typeof agh.model!=='string')throw new DomainError(422,'INVALID_AGENT_OUTPUT');
   if(!Array.isArray(agh.tool_receipt_ids)||agh.tool_receipt_ids.length!==current.tool_receipts.length||!current.tool_receipts.every((id,i)=>agh.tool_receipt_ids[i]===id))throw new DomainError(422,'INVALID_AGENT_OUTPUT');
   metadata={mode:'real',agh:{provider:agh.provider,model:agh.model,session_id:agh.session_id,last_seq:agh.last_seq,tool_receipt_ids:agh.tool_receipt_ids}};
  }
  this.store.setRuntime(run.id,metadata);
 }catch(error){const code=PUBLIC_CODES.has(error.code)?error.code:'DEPENDENCY_UNAVAILABLE';const current=this.store.internalRun(run.id);
  if(['needs_review','completed'].includes(current.status)){this.store.transaction(()=>{const latest=this.store.internalRun(run.id);latest.execution_error=errorBody(new DomainError(503,code,code),'after_checkpoint').error;this.store.save('run',latest);});}
  else this.store.failRun(run.id,code,['AGENT_NOT_CONFIGURED','AGH_NOT_READY','AGNES_PROVIDER_REQUIRED'].includes(code)?'blocked':'failed');
 }finally{clearTimeout(timeout);if(abortHandler)controller.signal.removeEventListener('abort',abortHandler);}}
 boundTools(runId,signal){
  return Object.freeze(Object.fromEntries(Object.entries(this.store.toolsFor(runId)).map(([name,call])=>[name,args=>{
   if(signal.aborted)throw new DomainError(409,'RUN_CANCELLED');
   return call(args);
  }])));
 }
 cancel(runId){this.running.get(runId)?.controller.abort();}
 async drain(){this.kick();while(this.running.size){await Promise.allSettled([...this.running.values()].map(x=>x.promise));this.kick();}}
 async close(){this.closed=true;clearInterval(this.timer);for(const [rid,t]of this.running){try{this.store.failRun(rid,'RUN_INTERRUPTED','interrupted');}catch(error){this.recordFailure(error,'dispatch_close',rid);}finally{t.controller.abort();}}await Promise.allSettled([...this.running.values()].map(t=>t.promise));if(this.agent?.close)await this.agent.close();}
}
