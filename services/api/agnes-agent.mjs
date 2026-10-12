import {createHash} from 'node:crypto';
import {runtimeError} from '../../agents/runtime/boundary.mjs';
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const workflowSkills={entry:'health-record',visit:'visit-preparation',document:'post-visit',care_plan:'post-visit'};
export class AgnesAgent {
 constructor({runtime,store}){this.runtime=runtime;this.store=store;this.mode=runtime?.readiness.fixture?'fixture':'real';this.sessions=new Map();}
 async isReady({signal}={}){signal?.throwIfAborted();if(!this.runtime||!this.store)throw runtimeError('AGENT_NOT_CONFIGURED');return this.runtime.isReady();}
 async run({run,tools,signal}){
  await this.isReady({signal});const skill=workflowSkills[run.workflow];if(!skill)throw runtimeError('UNKNOWN_WORKFLOW');
  const {runtime,store}=this;const key=store.reserveRuntime(run.id);let phase='session_new',session,iterator,reader,removePermission;const events=[],turns=[];let seen=0,wake;
  runtime.bindings.reserve(key,{runId:run.id,signal,tools,check:()=>store.checkRuntime(run.id,key,{unbound:!session}),repair:reason=>store.recordRuntimeRepair(run.id,key,reason)});
  const abort=()=>{runtime.bindings.revoke(key);try{store.revokeRuntime(run.id,key);}catch{}void session?.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
   session=await runtime.client.session.new({cwd:runtime.workspace,preset:'healththread',sessionKey:key});
   store.bindRuntimeSession(run.id,key,session.id);this.sessions.set(key,session);signal?.throwIfAborted();
   removePermission=session.onPermissionRequest(async request=>{
    try{runtime.bindings.lookup(key);const name=request.toolCall?._meta?.['ai.agnes.harness']?.tool;if(request.sessionId===session.id&&['healththread_stage_candidates','healththread_stage_result'].includes(name)&&typeof request.toolCall.toolCallId==='string')return{verdict:'allowed-once'};}catch{}
    return{verdict:'rejected'};
   });
   phase='model_selection';
   for(const slot of ['primary','escalation','fast','compaction','verifier'])await session.setModel({slot,route:runtime.selected.route,model:runtime.selected.model});
   iterator=session.events()[Symbol.asyncIterator]();reader=(async()=>{for(;;){const item=await iterator.next();if(item.done)break;events.push(item.value);seen=item.value.seq;wake?.();}})();
   const prompt=`$${skill}\n执行 HealthThread ${run.workflow==='care_plan'?'care_plan 独立已确认医嘱接续':run.workflow+' 提取/沟通'}工作流。业务输入标识（内容必须通过工具读取）：${JSON.stringify({source_id:run.source_ids[0],document_id:run.document_id,base_profile_revision:run.base_profile_revision,operation_key:'stage:'+run.id})}。完成暂存后停止，不自行确认，不声称聊天文字已保存。`;
   let turn;
   for(let attempt=0;attempt<3;attempt++){
    phase='prompt';turn=await session.prompt(attempt===0?prompt:`$${skill}\n上一轮未获得必需的 stage 工具回执。请使用已读证据完成本次暂存；不能将聊天 JSON 当作产物。`,{signal});
    signal?.throwIfAborted();
    turns.push({reason:turn.reason,stop_reason:turn.stopReason,last_seq:turn.lastSeq});
    const staged=runtime.bindings.lookup(key);
    if(turn.reason==='blocked'&&staged.repairs>0&&staged.repairs<2&&staged.invocations.some(i=>i.name.includes('_stage_'))){
     runtime.bindings.reject(key,'finalization');runtime.bindings.finalize(key);phase='finalization';
     turn=await session.prompt(`$${skill}\n本次有效业务产物已通过工具暂存。仅用一句文字确认已暂存、待用户核对；禁止调用任何工具、修改产物或重复提取。`,{signal});
     turns.push({reason:turn.reason,stop_reason:turn.stopReason,last_seq:turn.lastSeq});
    }
    if(turn.reason!=='completed'||turn.stopReason!=='end_turn')throw Object.assign(runtimeError('AGH_TURN_INCOMPLETE'),{turn:{reason:turn.reason,stopReason:turn.stopReason,lastSeq:turn.lastSeq}});
    const entry=runtime.bindings.lookup(key);
    if(entry.invocations.some(i=>i.name.includes('_stage_')))break;
    runtime.bindings.reject(key,'outer:'+attempt);
   }
   if(seen<turn.lastSeq)await Promise.race([new Promise(resolve=>{wake=()=>{if(seen>=turn.lastSeq)resolve();};}),new Promise((_,reject)=>setTimeout(()=>reject(runtimeError('AGH_LEDGER_INCOMPLETE')),1000))]);
   phase='receipt_correlation';const entry=runtime.bindings.lookup(key);const correlations=[];
   for(const invocation of entry.invocations){
    const call=events.find(e=>e.type==='tool/call'&&e.data.toolUseId===invocation.toolUseId);
    const result=events.find(e=>e.type==='tool/result'&&e.data.toolUseId===invocation.toolUseId);
    if(!call||!result||result.seq<=call.seq||result.seq>turn.lastSeq)throw runtimeError('AGH_RECEIPT_UNCORRELATED');
    const detail=await session.readToolDetail(call.seq,result.seq,{signal});
    if(detail.call.name!==invocation.name||detail.call.toolUseId!==invocation.toolUseId||canonical(detail.call.args)!==canonical(invocation.args)||detail.result?.isError||detail.result?.structured?.receipt?.id!==invocation.receipt?.id)throw runtimeError('AGH_RECEIPT_UNCORRELATED');
    const persisted=store.get(run.owner,'tool_receipt',invocation.receipt.id);
    if(persisted.agh_session_id!==session.id||persisted.agh_tool_use_id!==invocation.toolUseId||persisted.args_hash!==createHash('sha256').update(canonical(invocation.args)).digest('hex'))throw runtimeError('AGH_RECEIPT_UNCORRELATED');
    correlations.push({receipt_id:persisted.id,tool:persisted.tool,tool_use_id:invocation.toolUseId,call_seq:call.seq,result_seq:result.seq});
   }
   const expected=run.workflow==='care_plan'?['healththread_get_confirmed_instructions','healththread_stage_result']:['healththread_read_source','healththread_retrieve_context',run.workflow==='visit'?'healththread_stage_result':'healththread_stage_candidates'];
   const actual=correlations.map(i=>i.tool);let cursor=0;for(const name of actual)if(name===expected[cursor])cursor++;
   if(cursor!==expected.length)throw runtimeError('MISSING_STAGED_OUTPUT');
   store.recordRuntimeEvidence(run.id,key,{session_id:session.id,last_seq:turn.lastSeq,reason:turn.reason,stop_reason:turn.stopReason,route:runtime.selected.route,model:runtime.selected.model,correlations,turns,repair_attempts:entry.repairs,fixture:runtime.readiness.fixture});
   return{agh:{provider:'agnes-ai',model:runtime.selected.model,session_id:session.id,last_seq:turn.lastSeq,tool_receipt_ids:correlations.map(r=>r.receipt_id)}};
  }catch(error){if(error.data?.turnEnd)turns.push({reason:error.data.turnEnd.reason,stop_reason:null,last_seq:seen,sequence_kind:'last_observed_sdk_event'});store.recordRuntimeDiagnostic(run.id,key,{phase,code:error.code||'UNKNOWN',rpc_code:error.data?.code||null,provider_code:error.data?.error?.code||null,reason:error.turn?.reason||error.data?.turnEnd?.reason||null,stop_reason:error.turn?.stopReason||error.data?.turnEnd?.stopReason||null,turns,last_seq:seen});throw error;
  }finally{
   signal?.removeEventListener('abort',abort);runtime.bindings.revoke(key);try{store.revokeRuntime(run.id,key);}catch{}
   await iterator?.return();await reader?.catch(()=>{});removePermission?.();await session?.detach().catch(()=>{});await runtime.releaseSession?.(key);runtime.bindings.remove(key);this.sessions.delete(key);
  }
 }
 async close(){await Promise.allSettled([...this.sessions.values()].map(s=>s.cancel()));await this.runtime?.close();}
}
