import {createHash} from 'node:crypto';
import {runtimeError} from '../../agents/runtime/boundary.mjs';
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const workflowSkills={entry:'health-record',visit:'visit-preparation',chat:'health-assistant',document:'post-visit',transcription:'document-transcription',care_plan:'care-followup'};
export class AgnesAgent {
 constructor({runtime,store}){this.runtime=runtime;this.store=store;this.mode=runtime?.readiness.fixture?'fixture':'real';this.sessions=new Map();}
 async isReady({signal}={}){signal?.throwIfAborted();if(!this.runtime||!this.store)throw runtimeError('AGENT_NOT_CONFIGURED');return this.runtime.isReady();}
 async run({run,tools,signal}){
  await this.isReady({signal});if(run.workflow==='transcription'&&!this.runtime.readiness.image_input)throw runtimeError('IMAGE_MODEL_UNSUPPORTED');const skill=run.overview_refresh?'health-state':workflowSkills[run.workflow];if(!skill)throw runtimeError('UNKNOWN_WORKFLOW');
  const {store}=this;const key=store.reserveRuntime(run.id);let runtime,phase='runtime_open',session,iterator,reader,removePermission;const events=[],turns=[];let seen=0,wake;
  const abort=()=>{runtime?.bindings.revoke(key);try{store.revokeRuntime(run.id,key);}catch{}void session?.cancel().catch(()=>{});};
  signal?.addEventListener('abort',abort,{once:true});
  try{
   runtime=await this.runtime.openRun({workflow:store.internalRun(run.id).workflow});signal?.throwIfAborted();
  runtime.bindings.reserve(key,{runId:run.id,signal,tools,check:()=>store.checkRuntime(run.id,key,{unbound:!session}),repair:reason=>store.recordRuntimeRepair(run.id,key,reason)});
   phase='session_new';session=await runtime.client.session.new({cwd:runtime.workspace,preset:'healththread',sessionKey:key});
   store.bindRuntimeSession(run.id,key,session.id);this.sessions.set(key,session);signal?.throwIfAborted();
   removePermission=session.onPermissionRequest(async request=>{
    try{runtime.bindings.lookup(key);const name=request.toolCall?._meta?.['ai.agnes.harness']?.tool;if(request.sessionId===session.id&&['healththread_stage_candidates','healththread_stage_result'].includes(name)&&typeof request.toolCall.toolCallId==='string')return{verdict:'allowed-once'};}catch{}
    return{verdict:'rejected'};
   });
   phase='model_selection';
   for(const slot of ['primary','escalation','fast','compaction','verifier'])await session.setModel({slot,route:runtime.selected.route,model:runtime.selected.model});
   iterator=session.events()[Symbol.asyncIterator]();reader=(async()=>{for(;;){const item=await iterator.next();if(item.done)break;events.push(item.value);seen=item.value.seq;wake?.();}})();
   const prompt=run.overview_refresh?`$${skill}\n本轮仅重新综合身体近况概览。按 healththread_read_source → healththread_retrieve_context → healththread_stage_candidates 执行。healththread_retrieve_context 默认返回第一页；必须用同一工具按 source_page.next_offset 作为 source_offset 继续读取，直到 next_offset=null，读完全部页才暂存。读取授权原始资料、当前事实、上一版完整文档，以及存在时的 overview_resolution_context（已有资料刷新可能没有差异记录），按人的处理结果排除已拒绝/替换的旧候选；未解决分歧保持不确定。只提交 candidates=[] 和原生 overview、base_profile_revision、operation_key；不选原句候选、不提交 record_dialogue/comparisons、不创建新记录或医嘱。综合完整 format_version=2 的问题事件文档（summary、problems、background、uncertainties），同部位可有不同事件；复用稳定 key，保留有效来源支持的旧关注问题；八维未知用 null，简短综合，保留时间、来源归属与否认范围，不复制全部历史；uncertainties 只列影响当前理解的重要未知或矛盾，不穷举患者未说过的症状。业务输入：${JSON.stringify({source_id:run.source_ids[0],base_profile_revision:run.base_profile_revision,operation_key:'stage:'+run.id})}。暂存后停止等待核验。`:run.workflow==='transcription'?`$${skill}\n请对附带原始图像做忠实文字转录。先调用 healththread_read_source(source_id)，再调用 healththread_stage_result(kind=transcription)。不要分析病情、生成医嘱或猜测文字。业务输入：${JSON.stringify({source_id:run.source_ids[0],source_text_version:1,document_id:run.document_id,operation_key:'stage:'+run.id})}。完成暂存后停止。`:`$${skill}\n执行 HealthThread ${run.workflow==='care_plan'?'care_plan 独立已确认医嘱接续；先调用 healththread_get_confirmed_instructions(document_id)，再用 healththread_stage_result(kind=care_plan) 暂存，不重新提取候选':run.workflow==='document'?'document 文档提取；只按 healththread_read_source → healththread_retrieve_context → healththread_stage_candidates 的顺序执行；优先提交 document_source_refs 精简原句引用，由你分类并综合 overview，本轮不执行 care_plan':run.workflow+' 提取/沟通'}工作流。业务输入标识（内容必须通过工具读取）：${JSON.stringify({source_id:run.source_ids[0],record_thread_id:run.record_thread_id,selected_source_ids:run.source_ids.slice(1),document_id:run.document_id,base_profile_revision:run.base_profile_revision,operation_key:'stage:'+run.id})}。${run.workflow==='chat'?'chat 必须提供 automatic_record action=save|skip，普通自述无需征求保存同意。':['entry','document'].includes(run.workflow)?'必须提供原生 format_version=2 的完整 overview 文档。':''}先通过工具暂存，服务端在完整模型验证后自动保存。完成暂存后停止，不提前声称成功。`;
   const overviewBrief=['entry','document','chat'].includes(run.workflow)?'\n身体近况用于一页近期汇总，请按项目文档第四章八个维度组织你自己的简短综合，而不是字段抄录。summary 用2–3句清楚说明最近主要不适、已有依据的变化和最关键的未知，尽量不超过200字。每个非空 dimensions 值用1–2句易读的话概括，通常不超过120字；不重复整段原文或每条历史。以最近记录与仍在关注的问题为主，旧资料保留实际时间并作为背景，没有近期资料时说明截至最近记录，绝不把旧测量写成今天。仍有效旧问题照常保留稳定 key 与原始依据；同一问题内保留关键时间、用户自评分、单位、明确否认的时间范围，以及病历判断与实际执行的归属。没有依据的维度用null，重要未知集中在uncertainties，避免长问卷。不要生成健康总分、医学诊断或从未提及推断正常。患者可见文字不用内部ID、英文键、文档版本或处理步骤。':'';
   const dimensionBrief=overviewBrief?'\n八维内容分别归位：body_site_symptom=部位、左右侧与不适表现；time_course=开始、持续、频率与变化；self_rating=用户明确自评及量表范围；impact_context=睡眠、进食、活动影响与诱发/缓解情境；associated=伴随表现和明确否认，保留有效日期；measurements=原资料给出的体温、血压、检查值，保留原日期与单位；background_care=相关既往、用药、过敏、病历判断和处理计划/实际执行；evidence_status=患者自述、病历记载、已核对或存在分歧等依据状态。原文已有相关体温或血压时写入measurements；“今天没有恶心、呕吐”归入associated。不要把这些已知信息只放进其他维度或background，再将对应维度写null。只整理原文支持的内容，不补充疾病推断。':'';
   const reportBrief=overviewBrief?'\n每条具体信息只在最合适的维度展开，避免重复：background只补充问题维度尚未涵盖、且对理解当前近况必要的背景，不再次复述已写入background_care的同一病历/医嘱；已经结束且没有当前影响的旧症状不用放进近期background。uncertainties只保留最多3个真正影响当前理解的重要缺口或矛盾，不把“未来是否继续好转”一类泛泛未知列成问卷。':'';
   const retentionBrief=overviewBrief?'\n已有问题追加病历或后续自述时，保留 body_overview_context 中该问题所有仍有效原始 source_ids，再添加实际支持的新出处；不能仅保留相同 key 而把旧出处换成最新病历。新病历没有写自评分、睡眠/活动影响、否认或测量，不代表这些已知维度变成未知：从工具返回的原始 sources 综合既往与新增信息，保留原日期和患者/病历归属，不能将已有信息改为null或把旧值当今天。已删除或整条更正取代的证据不再保留；问题结束后按实际依据标记。overview只提交format_version、summary、problems、background、uncertainties五个字段，不复制服务端文档版本、更新时间、运行或其他元数据。':'';
   let turn;
   for(let attempt=0;attempt<3;attempt++){
    const initialInput=run.workflow==='transcription'?[{type:'text',text:prompt},{type:'image',data:store.original(run.owner,run.document_id).bytes.toString('base64'),mimeType:store.original(run.owner,run.document_id).media_type}]:prompt+overviewBrief+dimensionBrief+reportBrief+retentionBrief;
    phase='prompt';turn=await session.prompt(attempt===0?initialInput:`$${skill}\n上一轮未获得必需的 stage 工具回执。请使用已读证据完成本次暂存；不能将聊天 JSON 当作产物。`,{signal});
    signal?.throwIfAborted();
    turns.push({reason:turn.reason,stop_reason:turn.stopReason,last_seq:turn.lastSeq});
    const staged=runtime.bindings.lookup(key);
    // Core rejects malformed native arguments before tool_call hooks. Its
    // context hook is cached within a turn, so refresh only for this bounded,
    // already charged rejection. Preserve the same session and original ledger.
    if(turn.reason==='blocked'&&staged.schemaRepair?.pending&&!staged.invocations.some(i=>i.name.includes('_stage_'))){
     staged.schemaRepair.pending=false;
     continue;
    }
    if(turn.reason==='blocked'&&staged.repairs>0&&staged.repairs<=2&&staged.invocations.some(i=>i.name.includes('_stage_'))){
     // A saved, validated checkpoint may exhaust both repairs. Finishing its
     // SDK turn adds no business repair: all tools are disabled before prompting.
     if(staged.repairs<2)runtime.bindings.reject(key,'finalization');runtime.bindings.finalize(key);phase='finalization';
     turn=await session.prompt(`$${skill}\n本次有效业务产物已通过工具暂存。仅用一句文字确认已暂存、等待运行核验；禁止调用任何工具、修改产物或重复提取。`,{signal});
     turns.push({reason:turn.reason,stop_reason:turn.stopReason,last_seq:turn.lastSeq});
    }
    if(turn.reason!=='completed'||turn.stopReason!=='end_turn')throw Object.assign(runtimeError('AGH_TURN_INCOMPLETE'),{turn:{reason:turn.reason,stopReason:turn.stopReason,lastSeq:turn.lastSeq}});
    const entry=runtime.bindings.lookup(key);
    if(entry.invocations.some(i=>i.name.includes('_stage_')))break;
    runtime.bindings.reject(key,'outer:'+attempt);
   }
   if(seen<turn.lastSeq)await Promise.race([new Promise(resolve=>{wake=()=>{if(seen>=turn.lastSeq)resolve();};}),new Promise((_,reject)=>setTimeout(()=>reject(runtimeError('AGH_LEDGER_INCOMPLETE')),1000))]);
   phase='receipt_correlation';const entry=runtime.bindings.lookup(key);const correlations=[],effects=new Map();
   for(const invocation of entry.invocations){
    const call=events.find(e=>e.type==='tool/call'&&e.data.toolUseId===invocation.toolUseId);
    const result=events.find(e=>e.type==='tool/result'&&e.data.toolUseId===invocation.toolUseId);
    if(!call||!result||result.seq<=call.seq||result.seq>turn.lastSeq)throw runtimeError('AGH_RECEIPT_UNCORRELATED');
    const detail=await session.readToolDetail(call.seq,result.seq,{signal});
    if(detail.call.name!==invocation.name||detail.call.toolUseId!==invocation.toolUseId||canonical(detail.call.args)!==canonical(invocation.args)||detail.result?.isError||detail.result?.structured?.receipt?.id!==invocation.receipt?.id)throw runtimeError('AGH_RECEIPT_UNCORRELATED');
    const persisted=store.get(run.owner,'tool_receipt',invocation.receipt.id);
    if(persisted.run_id!==run.id||persisted.tool!==invocation.name||persisted.agh_session_id!==session.id||canonical(detail.result.structured.receipt)!==canonical(persisted)||persisted.args_hash!==createHash('sha256').update(canonical(invocation.args)).digest('hex'))throw runtimeError('AGH_RECEIPT_UNCORRELATED');
    const original=effects.get(persisted.id),isStage=invocation.name.includes('_stage_');
    if(isStage){const outcome=store.runtimeStageOutcome(run.id,key,invocation.name,invocation.args,persisted.id);const {receipt,...actualOutcome}=detail.result.structured;if(canonical(outcome)!==canonical(actualOutcome))throw runtimeError('AGH_RECEIPT_UNCORRELATED');}
    if(original){if(!isStage||original.tool_use_id!==persisted.agh_tool_use_id||original.tool!==invocation.name||call.seq<=original.call_seq||result.seq<=original.result_seq)throw runtimeError('AGH_RECEIPT_UNCORRELATED');}
    else if(persisted.agh_tool_use_id!==invocation.toolUseId)throw runtimeError('AGH_RECEIPT_UNCORRELATED');
    const correlation={receipt_id:persisted.id,operation_id:persisted.operation_id,tool:persisted.tool,tool_use_id:invocation.toolUseId,call_seq:call.seq,result_seq:result.seq,...(original?{replay_of_tool_use_id:original.tool_use_id}:{})};
    correlations.push(correlation);if(!original)effects.set(persisted.id,correlation);
   }
   const expected=run.workflow==='transcription'?['healththread_read_source','healththread_stage_result']:run.workflow==='care_plan'?['healththread_get_confirmed_instructions','healththread_stage_result']:['healththread_read_source','healththread_retrieve_context',['visit','chat'].includes(run.workflow)?'healththread_stage_result':'healththread_stage_candidates'];
   const actual=correlations.map(i=>i.tool);let cursor=0;for(const name of actual)if(name===expected[cursor])cursor++;
   if(cursor!==expected.length)throw runtimeError('MISSING_STAGED_OUTPUT');
   store.recordRuntimeEvidence(run.id,key,{session_id:session.id,last_seq:turn.lastSeq,reason:turn.reason,stop_reason:turn.stopReason,route:runtime.selected.route,model:runtime.selected.model,correlations,turns,repair_attempts:entry.repairs,fixture:runtime.readiness.fixture});
   return{agh:{provider:'agnes-ai',model:runtime.selected.model,session_id:session.id,last_seq:turn.lastSeq,tool_receipt_ids:[...effects.keys()]}};
  }catch(error){if(error.data?.turnEnd)turns.push({reason:error.data.turnEnd.reason,stop_reason:null,last_seq:seen,sequence_kind:'last_observed_sdk_event'});store.recordRuntimeDiagnostic(run.id,key,{phase,code:error.code||'UNKNOWN',rpc_code:error.data?.code||null,provider_code:error.data?.error?.code||null,reason:error.turn?.reason||error.data?.turnEnd?.reason||null,stop_reason:error.turn?.stopReason||error.data?.turnEnd?.stopReason||null,turns,last_seq:seen});throw error;
  }finally{
   signal?.removeEventListener('abort',abort);runtime?.bindings.revoke(key);try{store.revokeRuntime(run.id,key);}catch{}
   await iterator?.return();await reader?.catch(()=>{});removePermission?.();await session?.detach().catch(()=>{});try{await runtime?.close();}finally{runtime?.bindings.remove(key);this.sessions.delete(key);}
  }
 }
 async close(){await Promise.allSettled([...this.sessions.values()].map(s=>s.cancel()));await this.runtime?.close();}
}
