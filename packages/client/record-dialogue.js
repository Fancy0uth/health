import {fieldLabel,assertionLabel,scopeLabel,precisionLabel} from './presentation.js';

export const isRecordConfirmation=text=>typeof text==='string'&&/^(确认|确认记录|确认本次记录|确认以上记录)[。！!]?$/u.test(text.trim());

// The model supplies validated candidates and questions. Framing and metadata
// come from the saved source and review object, never from a second extraction.
export function recordSummaryText(summary,sources=[]) {
  const byId=new Map(sources.map(source=>[source.id,source]));
  const originals=summary.source_ids.map(id=>byId.get(id)).filter(Boolean);
  const facts=summary.proposals.map((proposal,index)=>{
    const time=proposal.effective_time;
    return `${index+1}. ${fieldLabel(proposal.field)}：${proposal.value}\n断言：${assertionLabel(proposal.assertion)}；时间范围：${scopeLabel(proposal.temporal_scope)}\n原文时间：${time.raw??'未记录'}；精度：${precisionLabel(time.precision)}；起止时间：${time.start??'未换算'} → ${time.end??'未换算'}\n原文依据：${proposal.evidence.map(e=>`“${e.quote}”${e.locator.page==null?'':`（第 ${e.locator.page} 页）`}`).join('；')}`;
  });
  return `本次记录汇总（待你确认）\n\n用户原文：\n${originals.map((source,index)=>`${index+1}. ${source.text}\n记录时间：${source.recorded_at||source.created_at}`).join('\n')}\n来源类型：用户自述\n\n候选事实：\n${facts.join('\n\n')||'暂未提取到可确认事实，请补充具体身体感受。'}\n\n未记录 / 待补充：${summary.missing_fields.join('、')||'暂无额外待补充字段'}${summary.questions.length?'\n\n想向你确认：\n'+summary.questions.map((q,i)=>`${i+1}. ${q}`).join('\n'):''}\n\n${summary.proposals.length?'请核对以上全部信息；有修改可直接补充，准确无误后回复“确认”或“确认记录”。也可以稍后到健康时间线逐项确认。':'请先补充信息，暂时不能确认空记录。'}\n确认前只保存原文和待核对草稿。`;
}

export function recordConfirmationText(confirmation) {
  const selected=confirmation.accepted_change_ids.length;
  return selected?`已确认 ${selected} 项记录信息，并保存到健康时间线。${confirmation.outcome.rejected_change_ids?.length?'未选择的候选未写入正式事实。':''}`:'本次候选未确认，原文仍保留。';
}
