// Model-selected intent and source-checked content; these labels are interface copy.
export function assistantText(payload) {
  const introduction={greeting:'你好，我可以帮你整理身体感受、核对健康记录，或准备就诊资料。',clarify:'可以先把你想整理的情况说清楚。',prepare:'我们可以先核对本次描述，再准备医生沟通卡。',records:'可以在健康时间线核对已保存的原话和事实来源。',scope:'我能协助整理健康信息和就诊资料。诊断、治疗调整和分诊判断需由医疗专业人员确认。'}[payload.intent];
  if(!introduction)throw new Error('助手回复格式有误。');
  return [introduction,payload.intent==='greeting'?'':payload.speech?`你提供的原话：\n${payload.speech}`:'',payload.questions.length?`待你补充：\n${payload.questions.map(q=>'• '+q).join('\n')}`:''].filter(Boolean).join('\n\n');
}
