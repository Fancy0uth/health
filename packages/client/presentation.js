export const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const lines = value => esc(value).replaceAll('\n','<br>');
export const unknown = value => value == null || value === '' ? '未知 / 未记录' : String(value);
export const locatorText = evidence => `${evidence.source_id} · 原文 v${evidence.source_text_version} · ${evidence.locator?.page == null?'粘贴 / 自述原文':`第 ${evidence.locator.page} 页`} · UTF-16 [${evidence.locator?.start},${evidence.locator?.end})`;
export const capabilityText = name => ({department:'科室推荐未配置（D01 未批准）；请自行咨询医疗机构。',triage:'观察分级未配置（D02 未批准）；不生成临床分级。',audio:'音频 / 语音转写未支持；请使用文字输入。',ocr:'图片与扫描件 OCR 未支持；请粘贴原文或上传有文本层的 PDF。'})[name] || '该能力暂未配置。';
export const fieldLabel=value=>({reported_text:'记录原话',symptom:'症状',diagnosis:'诊断原文',medication:'用药原文',instruction:'医嘱原文',allergy:'过敏信息',test:'检查原文',observation:'观察原文'})[value]||'记录原话';
export const assertionLabel=value=>({affirmed:'自述肯定',negated:'自述否认',uncertain:'不确定 / 待排'})[value]||'断言未明确';
export const scopeLabel=value=>({current:'当前',past:'既往',unknown:'时间未明确'})[value]||'时间未明确';
export const precisionLabel=value=>({exact:'确切日期',interval:'时间区间',relative:'相对时间',unknown:'时间未明确'})[value]||'时间未明确';
export const sourceLabel=value=>value==='medical_document'?'病历原文':'用户自述';
export const reviewLabel=value=>({pending:'待核对',confirmed:'已核对',rejected:'已拒绝',expired:'已失效'})[value]||'尚未取得状态';
export const diagnostics=(text,title='处理与定位记录')=>`<details class="domain-diagnostics"><summary>${esc(title)}</summary><pre>${esc(text)}</pre></details>`;
export function evidenceHtml(evidence) {
  return `<div class="domain-evidence"><blockquote>${lines(evidence.quote)}</blockquote><p class="small muted">引用原文 · 版本 ${evidence.source_text_version} · ${evidence.locator?.page==null?'文字来源':`第 ${evidence.locator.page} 页`}</p><button type="button" class="domain-source" data-action="source" data-id="${esc(evidence.source_id)}">查看完整原文</button>${diagnostics(locatorText(evidence))}</div>`;
}
export function candidateHtml(proposal,{selected=false,mobile=false,before=null,disabled=false}={}) {
  const time=proposal.effective_time||{};
  const technical = `候选 ${proposal.id}\n字段 ${proposal.field} · 断言 ${proposal.assertion} · 范围 ${proposal.temporal_scope} · 精度 ${time.precision}\n事件 ${proposal.episode_id||'未关联'}`;
  return `<article class="${mobile?'card':'panel'} domain-candidate"><label class="domain-check"><input type="checkbox" data-proposal="${esc(proposal.id)}" ${selected?'checked':''} ${disabled?'disabled':''}><strong>${lines(proposal.value)}</strong></label><dl class="domain-meta"><dt>字段</dt><dd>${esc(fieldLabel(proposal.field))}</dd><dt>断言 / 时间范围</dt><dd>${esc(assertionLabel(proposal.assertion))} · ${esc(scopeLabel(proposal.temporal_scope))}</dd><dt>原文时间 / 精度</dt><dd>${esc(time.raw??'未识别明确时间，请核对原句')} · ${esc(precisionLabel(time.precision))}</dd><dt>起止时间</dt><dd>${esc(time.start??'未换算')} → ${esc(time.end??'未换算')}</dd><dt>事件关联</dt><dd>${proposal.fact_id?'保留所选事实所属事件':'这条原文的独立事件；不自动合并'}</dd><dt>确认前</dt><dd>${lines(before?.value || '没有当前事实')}</dd><dt>确认后</dt><dd>${lines(proposal.value)}${proposal.proposal_kind==='retraction'?'（撤回该事实）':''}</dd></dl>${(proposal.evidence||[]).map(evidenceHtml).join('')}${diagnostics(technical)}</article>`;
}
export function claimLabel(claim,sources=[]) {
  if(claim.fact_refs?.length) return '用户已核对事实（依赖所列事实版本）';
  const kinds=(claim.evidence||[]).map(e=>sources.find(s=>s.id===e.source_id)?.kind);
  return kinds.some(kind=>kind==='medical_document')?'未核对病历原文（不作为已确认事实）':'未核对用户自述 / 原文（不作为已确认事实）';
}
export function claimHtml(claim,sources=[]) {
  return `<article class="domain-claim"><p>${lines(claim.text)}</p><strong class="small">${esc(claimLabel(claim,sources))}</strong>${(claim.fact_refs||[]).map(f=>`<p class="small muted">已核对事实 · 版本 ${esc(f.revision)}</p>${diagnostics('事实 '+f.fact_id+' · v'+f.revision)}`).join('')}${(claim.evidence||[]).map(evidenceHtml).join('')}</article>`;
}
export function cardText(result,{sources=[],run=null,localDraft=null}={}) {
  const payload=result.payload||{};
  const state=result.validity==='stale'||result.status==='stale'?'已过期：依赖资料已变化，请重新生成':'当前版本：资料整理稿，需核对来源';
  const runtime=run?.execution_error?'执行在保存检查点后异常；不能据此证明真实运行完成。':run?.runtime?.mode==='fixture'?'合成 fixture 测试产物，非真实模型验证。':run?.runtime?.mode==='real'?'真实运行元数据由服务端提供。':'运行来源尚未取得或未验证。';
  const claims=(payload.claims||[]).map(claim=>`${claim.text}\n[${claimLabel(claim,sources)}]\n${(claim.fact_refs||[]).map(ref=>`事实 ${ref.fact_id} v${ref.revision}`).join('\n')}\n${(claim.evidence||[]).map(e=>`${locatorText(e)}\n引用：${e.quote}`).join('\n')}`).join('\n\n');
  return `医生沟通卡\n${state}\n结果 ${result.id||'未知'} · ${result.created_at||'时间未记录'}\n${runtime}\n${localDraft!=null?'本机打印草稿（未修改服务端结果）：\n'+localDraft:claims||payload.speech||''}\n\n想问医生：\n${(payload.questions||[]).join('\n')}\n\n未知 / 尚需补充：\n${(payload.unknowns||[]).join('\n')}\n\n${capabilityText('department')}\n${capabilityText('triage')}`;
}
export const runLabel = run => run.phase==='result_withdrawn'?'依赖来源已删除 · 产物已撤回':run.phase==='confirmed'?'用户核对事务已完成':run.phase==='rejected'?'候选已明确拒绝':({queued:'原文已保存 · 等待处理',running:'原文已保存 · 正在整理',needs_review:'候选已暂存 · 等待用户核对（尚未成为正式事实）',completed:'产物检查点已保存',failed:'原文已保存 · 处理失败',blocked:'原文已保存 · 运行未配置 / 被阻止',cancelled:'运行已取消',interrupted:'原文已保存 · 运行中断'})[run.status] || run.status;

export const terminalReasonLabel=reason=>({run_cancelled:'运行已取消，候选已失效。',consent_changed:'分析授权已变化，候选已失效。',source_scope_changed:'来源范围已变化，候选已失效。',reanalysed:'已从保存原文重新分析，此候选已失效。'})[reason]||'此检查点已结束，不能再次确认。';
