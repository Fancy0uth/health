// Model-selected intent and source-checked content; these labels are interface copy.
export function assistantText(payload) {
  if(payload.format_version===2){if(typeof payload.reply!=='string'||!payload.reply.trim())throw new Error('助手回复格式有误。');return payload.reply;}
  const introduction={greeting:'你好，我可以帮你整理身体感受、核对健康记录，或准备就诊资料。',clarify:'可以先把你想整理的情况说清楚。',prepare:'我们可以先核对本次描述，再准备医生沟通卡。',offer_visit:'我可以根据这段对话整理一份医生沟通卡，方便你向医生说明情况。确认现在生成吗？',confirm_visit:'已收到你的确认。',records:'可以在健康时间线核对已保存的原话和事实来源。',scope:'我能协助整理健康信息和就诊资料。诊断、治疗调整和分诊判断需由医疗专业人员确认。'}[payload.intent];
  if(!introduction)throw new Error('助手回复格式有误。');
  return [introduction,payload.intent==='greeting'?'':payload.speech?`你提供的原话：\n${payload.speech}`:'',payload.questions.length?`待你补充：\n${payload.questions.map(q=>'• '+q).join('\n')}`:''].filter(Boolean).join('\n\n');
}

// Project only server-owned child runs and saved artifacts into the conversation.
export function assistantMessage(payload,run={},runs=[],results=[]) {
  const message={text:assistantText(payload),run_id:run.id,action:payload.intent==='records'?'timeline':null,demo:false};
  const visit=['confirm_visit','confirm_both'].includes(payload.intent);
  const record=['confirm_record','confirm_both'].includes(payload.intent);
  const failed=item=>item&&(['failed','blocked','interrupted','cancelled'].includes(item.status)||item.execution_error);
  const retryable=item=>item&&['failed','blocked','interrupted'].includes(item.status)&&!item.result_id&&!item.fact_change_id;
  if(run.record_save_status&&run.record_save_status!=='skipped'){
    message.record_status=run.record_save_status;message.record_source_id=run.source_ids?.[0];message.record_thread_id=run.record_thread_id;
  }else if(payload.automatic_record?.action==='save'){message.record_status=failed(run)?'failed':'saving';}
  if(record&&!payload.automatic_record){
    const child=runs.find(item=>item.id===run.continuation_record_run_id);
    if(failed(child)||failed(run)){message.record_status='failed';if(retryable(child))message.record_retry_run_id=child.id;message.text+='\n\n记录整理未完成，原来的对话已保留。';}
    else if(['needs_review','completed'].includes(child?.status)&&child.runtime&&child.fact_change_id){message.record_status='needs_review';message.record_change_id=child.fact_change_id;message.record_source_id=child.source_ids?.[0];message.text+='\n\n记录已保存，待你核对后确认。';}
    else{message.record_status='saving';message.text+='\n\n正在整理记录，保存后会在这里显示查看入口。';}
  }
  if(!visit)return message;
  const child=runs.find(item=>item.id===run.continuation_run_id);
  const result=child&&results.find(item=>item.id===child.result_id&&item.kind==='visit_preparation');
  if(failed(child)||failed(run)){message.visit_status='failed';if(retryable(child))message.visit_retry_run_id=child.id;message.text+='\n\n沟通卡生成未完成，原来的对话已保留。'+(message.visit_retry_run_id?'可以点击“重试生成沟通卡”再试一次。':'');}
  else if(child?.status==='completed'&&child.runtime&&result){message.text+='\n\n医生沟通卡已生成，可以查看并修改。';message.action='card';message.visit_result_id=result.id;message.visit_status='completed';}
  else {message.visit_status='generating';message.text+='\n\n正在生成医生沟通卡，完成后会在这里显示查看入口。';}
  return message;
}

// A retry may only continue the latest turn in its canonical conversation.
export function eligibleChatRetries(runs=[]) {
  const chats=Object.values(runs).filter(run=>run.workflow==='chat');
  const groups=new Map();
  for(const run of chats){const key=run.conversation_id||run.id;const group=groups.get(key)||[];group.push(run);groups.set(key,group);}
  return [...groups.values()].flatMap(group=>{
    if(group.some(run=>['queued','running'].includes(run.status)))return [];
    const parents=new Set(group.map(run=>run.parent_run_id).filter(Boolean));
    const latest=group.filter(run=>!parents.has(run.id)).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''))[0];
    return latest&&['failed','blocked','interrupted'].includes(latest.status)&&!latest.deleted&&!latest.result_id&&!latest.fact_change_id?[latest]:[];
  });
}
