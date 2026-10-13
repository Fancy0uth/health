import { requestAgent } from './api.js';
const demoReplies = [
  { test: /就诊|准备|资料|不舒服|不适|腹胀|反酸|沟通卡/, answer: '已按你的描述整理本次困扰。\n\n开始时间、发生频率、近期用药和已知过敏仍需你核对。确认后可生成医生沟通卡。', action: null },
  { test: /记录|整理|时间线/, answer: '可以在健康时间线查看原话、核对日期和补充信息。', action: 'timeline' },
  { test: /补充|遗漏|影响/, answer: '可以补充每次持续多久、出现频率，以及是否影响进食或日常活动。不确定的内容先留为「未记录」，由你核对后再更新。', action: 'home' },
];

export async function askAssistant(question, context = {}) {
  // Configure window.HEALTHTHREAD_API_URL to connect a project-owned backend.
  // Keep model credentials on that backend, never in browser code.
  const endpoint = window.HEALTHTHREAD_API_URL;
  if (endpoint) {
    let payload;
    try {payload = await requestAgent(endpoint, { question, messages: context.messages || [],...(context.retry_source_id?{retry_source_id:context.retry_source_id}:{}) }, {onProgress:context.onProgress});}
    catch(error){
      const runtimeFailure=['DEPENDENCY_UNAVAILABLE','INVALID_AGENT_OUTPUT','OUTPUT_REPAIR_EXHAUSTED','MISSING_STAGED_OUTPUT','TOOL_SEQUENCE_REQUIRED','AGENT_NOT_CONFIGURED','AGNES_PROVIDER_REQUIRED','AGH_NOT_READY','DEADLINE_EXCEEDED'].includes(error.code);
      const message=runtimeFailure||!/[\u3400-\u9fff]/u.test(error.message||'')?'暂时没能完成这次回复。你的原话已保留，可以稍后重试。':error.message;
      const readable=Object.assign(new Error(message,{cause:error}),error);readable.message=message;readable.cause=error;throw readable;
    }
    if (typeof payload.answer !== 'string') throw new Error('回复格式有误，请稍后重试。');
    return { answer: payload.answer, action: ['home', 'timeline', 'card'].includes(payload.action) ? payload.action : null, demo: false,visit_result_id:payload.visit_result_id,visit_status:payload.visit_status,visit_retry_run_id:payload.visit_retry_run_id,record_retry_run_id:payload.record_retry_run_id,record_status:payload.record_status,record_change_id:payload.record_change_id,record_source_id:payload.record_source_id,run_id:payload.run_id,source_id:payload.source_id,runtime:payload.runtime,execution_error:payload.execution_error };
  }
  await new Promise(resolve => setTimeout(resolve, 420));
  const relatedCount = (context.records || []).filter(r => /胃|腹|反酸/.test(r.text)).length;
  if (/饭后.*(胀|反酸)/.test(question) && /就诊|医院|准备/.test(question)) {
    return { answer: `根据你说的饭后腹胀和反酸，已整理本次困扰与${relatedCount === 2 ? '两' : relatedCount}条相关记录。\n\n用药、过敏和对进食的影响还未记录。核对这些信息后，可生成医生沟通卡。`, action: null, demo: true };
  }
  const match = demoReplies.find(item => item.test.test(question));
  if (match?.action === 'timeline') {
    const records = context.records || [];
    const summary = records.slice(0, 3).map(r => `${r.date || '日期未记录'} · ${r.summary || r.text}`).join('\n');
    return { answer: records.length ? `当前有 ${records.length} 条记录：\n${summary}\n\n如需更正日期，请到时间线查看来源。` : '目前还没有健康记录，可以先聊聊你的身体感受。', action: 'timeline', demo: true };
  }
  return match
    ? { answer: match.answer, action: match.action, demo: true }
    : { answer: '我可以帮你整理记录、查看时间线，或准备就诊沟通信息。请告诉我你想核对哪件事；不确定的信息会保留为「未记录」。', action: null, demo: true };
}

export function appendAssistantReply(sessions,id,message) {
  const current=sessions.find(session=>session.id===id);
  if(!current)return false;
  const existing=message.run_id&&current.messages.find(m=>m.role==='assistant'&&m.run_id===message.run_id);
  if(existing)Object.assign(existing,message);else current.messages.push({role:'assistant',...message});
  delete current.failedQuestion;
  return true;
}

export function executionLabel(run) {
  if(!run)return '';
  if(run.runtime?.mode==='real'&&run.runtime.agh?.provider==='agnes-ai'&&run.runtime.agh.tool_receipt_ids?.length>=3)return 'Agnes 模型 · AGH 回执已核验';
  if(run.execution_error)return '产物已暂存，AGH 完整回执未核验';
  if(run.runtime?.mode==='fixture')return '测试模型输出';
  if(['failed','blocked','cancelled','interrupted'].includes(run.status))return ({failed:'本次处理未完成',blocked:'模型服务暂不可用',cancelled:'本次处理已取消',interrupted:'本次处理中断'})[run.status];
  return '正在核验 AGH 处理回执';
}
