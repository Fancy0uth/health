// Presentation only: all health interpretation and relationships come from saved model/server objects.
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
export const dimensionLabels={body_site:'身体部位',symptom:'症状与感受',onset:'开始时间',course:'变化过程',self_rating:'自评程度',impact:'生活影响',context:'出现情境',associated:'伴随表现',measurement:'体征与测量',background:'长期背景'};
const views=[['overview','身体近况'],['events','记录经过'],['current_problems','来源详情'],['unknowns','待处理差异']];
const reviewLabels={patient_report:'患者自述 · 自动整理',document_report:'病历记载 · 自动整理',confirmed:'已核对',pending:'待核对',deferred:'暂缓核对',kept_existing:'保留旧记录'};
const actionAttr=mode=>mode==='mobile'?'data-action':'data-act';
const button=(label,action,mode,extra='')=>`<button type="button" class="${mode==='mobile'?'button secondary':'btn btn-secondary'}" ${actionAttr(mode)}="${action}" ${extra}>${esc(label)}</button>`;
const note=text=>`<p class="muted small">${esc(text)}</p>`;
const refsOf=row=>row.source_refs||row.evidence||[];
function sourcesMarkup(row,mode){return refsOf(row).map(ref=>{const id=typeof ref==='string'?ref:ref.source_id;return id?`<div class="health-source">${typeof ref==='object'&&ref.quote?`<blockquote>${esc(ref.quote)}</blockquote>`:''}${button('查看来源','source',mode,`data-id="${esc(id)}"`)}</div>`:'';}).join('');}
function observationsMarkup(rows=[]){return rows.length?`<dl class="health-observations">${rows.map(o=>`<div><dt>${esc(dimensionLabels[o.dimension]||o.dimension)}</dt><dd>${esc(o.value)}${o.unit&&!String(o.value??'').includes(o.unit)?` <span>${esc(o.unit)}</span>`:''}${o.observed_at?`<small>观察时间：${esc(o.observed_at)}</small>`:''}</dd></div>`).join('')}</dl>`:'';}
const unnormalizedTime='未标准化（以原文为准）';
export function eventTimeText(row,observations=row.health_observations||row.observations||[]){
  if(row.effective_time?.raw||row.event_time)return row.effective_time?.raw||row.event_time;
  const times=observations.flatMap(o=>[o.dimension==='onset'?o.value:null,o.observed_at]).filter(Boolean);
  for(const fact of row.facts||[]){const time=eventTimeText(fact);if(time!==unnormalizedTime)times.push(time);}
  return [...new Set(times)].join(' / ')||unnormalizedTime;
}
function factMarkup(f,profile,mode){
  const observations=f.observations||f.health_observations||(profile.observations||[]).filter(o=>o.fact_id===f.fact_id&&o.revision===f.revision);
  const refs=refsOf(f).length?f:{source_refs:observations.flatMap(refsOf)};
  return `<article class="health-fact"><p>${esc(f.value||f.text||'')}</p>${note(`${reviewLabels[f.review_status]||'来源记录'} · v${f.revision??'未记录'} · 事件时间：${eventTimeText(f,observations)}`)}${observationsMarkup(observations)}${sourcesMarkup(refs,mode)}${f.fact_id?button('更正这条事实','profile-correct',mode,`data-id="${esc(f.fact_id)}" data-version="${esc(f.revision)}"`):''}</article>`;
}
export function healthProfileMarkup(profile,view='overview',mode='web',retrying=new Set()){
  const tabs=`<div class="health-tabs" role="group" aria-label="健康画像视图">${views.map(([key,label])=>`<button type="button" ${actionAttr(mode)}="profile-view" data-view="${key}" aria-pressed="${view===key}">${label}</button>`).join('')}</div>`;
  if(!profile)return tabs+note('尚无结构化画像。旧记录仍可在健康记录中查看和核对；不会补造未记录的信息。');
  let body='';
  if(view==='overview'){
    const overview=profile.overview;
    body=!overview||overview.status==='not_recorded'?note('还没有身体近况概览。聊聊近期的身体感受，保存后会自动整理。'):overview.status==='stale'?overviewRecoveryMarkup(overview,mode,retrying):`<article class="overview-summary"><h2>最近的整体情况</h2><p>${esc(overview.summary)}</p>${note('根据已保存资料整理'+(overview.updated_at?' · 更新于 '+new Date(overview.updated_at).toLocaleString('zh-CN',{hour12:false}):''))}</article><div class="body-region-grid">${(overview.regions||[]).map(region=>`<article class="body-region"><div class="region-heading"><h3>${esc(region.label)}</h3><span class="region-status">${esc(({reported:'患者自述',documented:'病历记载',improving:'有所好转',resolved:'已缓解',uncertain:'有待核实'})[region.status]||'已有记录')}</span></div><p>${esc(region.summary)}</p><details data-disclosure="${esc(region.id)}"><summary>查看来源与时间</summary>${note(region.updated_at?'更新于 '+new Date(region.updated_at).toLocaleString('zh-CN',{hour12:false}):'时间以原文为准')}${sourcesMarkup({source_refs:region.source_ids||[]},mode)}</details></article>`).join('')}</div>`;
  }else if(view==='events')body=(profile.events||[]).map(e=>`<article class="health-event"><h3>${esc(e.title||e.summary||e.label||'健康事件')}</h3>${note('事件时间：'+eventTimeText(e)+' · 记录时间：'+(e.recorded_at||e.created_at||'未记录'))}<label class="field"><span>当前状态（不会改写当时的记录）</span><select name="episode-status" data-episode="${esc(e.id)}" data-version="${esc(e.version)}">${[['active','持续中'],['improved','已好转'],['resolved','已结束']].map(([key,label])=>`<option value="${key}" ${e.status===key?'selected':''}>${label}</option>`).join('')}</select></label>${(e.facts||[]).map(f=>factMarkup(f,profile,mode)).join('')||note('本事件尚无已核对事实。')}</article>`).join('');
  else if(view==='unknowns'){
    body=(profile.unknowns||[]).map(u=>`<div class="health-unknown"><strong>${esc(typeof u==='string'?u:dimensionLabels[u.dimension]||u.dimension||u.label||'含义待核实')}</strong>${note(typeof u==='string'?'待补充':u.message||u.value||'未记录，不能据此认为没有。')}${typeof u==='object'?sourcesMarkup(u,mode):''}</div>`).join('');
    body+=(profile.conflicts||[]).map(c=>`<article class="health-comparison"><h3>待处理的${c.relation==='conflict'?'冲突':'新旧差异'}</h3><p>${esc(c.reason)}</p><p>旧记录：${esc(c.old_snapshot?.value)}</p><p>新候选：${esc(c.new_snapshot?.value)}</p>${sourcesMarkup(c.old_snapshot||{},mode)}${(c.new_snapshot?.evidence?.[0]?.source_id)?button('前往核对','profile-review',mode,`data-id="${esc(c.new_snapshot.evidence[0].source_id)}"`):''}</article>`).join('');
  }else body=(profile[view]||[]).map(f=>factMarkup(f,profile,mode)).join('');
  return `<section class="health-profile">${tabs}${body||note(view==='unknowns'?'当前没有待补充或冲突信息。':'此视图尚无已核对内容。')}<p class="muted small">近况由模型根据患者自述与病历记载整理，不代表医学确认。未提及的部位不推断为正常。</p></section>`;
}
export const documentForSource=(documents=[],sourceId)=>sourceId?documents.find(item=>item.source_id===sourceId||item.analysis_source_id===sourceId):undefined;
export const sourceProvenanceLabel=source=>source?.input_kind==='image_transcript'?'病历识别文字':source?.kind==='medical_document'?'病历原文':'患者原文';
export const captureDisclosureState=root=>new Set(Array.from(root.querySelectorAll?.('details[data-disclosure]')||[]).filter(node=>node.open).map(node=>node.dataset.disclosure));
export function restoreDisclosureState(root,openKeys){for(const node of root.querySelectorAll?.('details[data-disclosure]')||[])node.open=openKeys.has(node.dataset.disclosure);}
export function recordTimeLabel(item){
  if(item.date)return '事件时间：'+item.date;
  const recorded=item.created&&item.created!=='未记录'?item.created:item.recorded_at||item.created_at;
  return recorded?'记录时间：'+recorded:'记录时间未记录';
}
export function documentSourceMarkup(item,mode='web'){
  const transcript=item.transcript||item.analysis_source_id&&item.analysis_source_id!==item.source_id;
  return `<section class="document-source"><h2>${transcript?'病历识别文字':'病历原文'}</h2>${note(item.name||'病历资料')}${note(transcript?'由模型识别，保留原始文件；不确定内容见下方。':'由上传或粘贴的病历原文保留。')}<blockquote>${esc(item.original||item.transcript?.text||'识别文字尚未取得，请查看原始文件或处理进度。')}</blockquote>${documentAnalysisMarkup(item,mode)}${button('查看原文与分析','medical-review',mode,`data-id="${esc(item.source_id)}"`)}</section>`;
}
export const recordStatusLabel=item=>item?.edit_recovery?({pending:'正在更新记录',failed:'修改整理未完成',stopped:'修改整理已停止'})[item.edit_recovery.state]||'修改原文已保存':({patient_report:'患者自述 · 已保存',document_report:'病历记载 · 已保存',confirmed:'已核对',reference:'就诊描述'})[item?.status]||(item?.review_state==='exceptions'?'有待处理差异':item?.analysis==='failed'?'整理未完成':'原文已保存');
function recoveryButton(id,retryable,mode,retrying,label='重试整理记录'){return id&&retryable?button(retrying.has(id)?'正在重试…':label,'retry-recovery',mode,`data-id="${esc(id)}" ${retrying.has(id)?'disabled':''}`):'';}
export function recordRecoveryMarkup(item,mode='web',retrying=new Set()){
  const recovery=item?.edit_recovery;if(!recovery)return '';
  return `<div class="document-analysis" role="status"><strong>${esc(recordStatusLabel(item))}</strong>${note(recovery.state==='pending'?'修改原文已保存，正在重新整理。':'修改原文已保存，整理未完成。下方内容保留你的完整修改。')}${recoveryButton(recovery.run_id,recovery.retryable===true,mode,retrying)}</div>`;
}
function overviewRecoveryMarkup(overview,mode,retrying){
  const pending=overview.refresh_state==='pending';
  return `<div class="document-analysis" role="status"><strong>${pending?'近况概览正在更新':'近况概览更新未完成'}</strong>${note(pending?'记录已变化，正在根据最新内容重新整理。':'已保存的记录仍然保留，近况概览尚未更新。')}${recoveryButton(overview.refresh_run_id,overview.refresh_retryable===true,mode,retrying,'重试更新近况')}</div>`;
}
export function recordSaveMarkup(message){const label=({saved:'已自动保存 · 可修改',saved_with_exceptions:'已保存 · 有待处理差异',saving:'正在整理记录…',failed:'记录整理未完成'})[message?.record_status];return label?`<p class="record-save-status" role="status">${label}</p>`:'';}
export const resolutionKey=(candidateId,factId,revision)=>[candidateId,factId,revision].join('|');
export const reviewProposals=change=>(change?.proposals||[]).filter(p=>!['confirmed','kept_existing','rejected'].includes(p.proposal_status));
export function selectedResolutions(snapshot,ids,choices){
  const resolutions=[];
  for(const p of reviewProposals(snapshot).filter(p=>ids.includes(p.id)))for(const c of p.comparisons||[]){
    const action=choices[resolutionKey(p.id,c.fact_id,c.revision)];
    if(!action&&(c.requires_resolution||c.relation==='conflict'))throw new Error('请为所选冲突选择处理方式：保留旧记录、替换、分别保留或暂缓。');
    if(action)resolutions.push({candidate_id:p.id,fact_id:c.fact_id,revision:c.revision,action});
  }
  return resolutions;
}
export function comparisonMarkup(proposal,choices={},mode='web'){
  return observationsMarkup(proposal.health_observations||[])+(proposal.comparisons||[]).map(c=>{
    const old=c.old_snapshot||{},next=c.new_snapshot||proposal,key=resolutionKey(proposal.id,c.fact_id,c.revision);
    return `<section class="health-comparison"><h3>${({conflict:'可能冲突',update:'更新内容',duplicate:'可能重复',related:'相关记录'})[c.relation]||'对照已有记录'}</h3>${note(c.reason||'请根据原文确认两条记录的关系。')}<div class="health-compare-columns"><div><strong>已有记录 · v${esc(c.revision)}</strong><p>${esc(old.value||'')}</p>${note('事件时间：'+eventTimeText(old)+' · 核对时间：'+(old.confirmed_at||'未记录'))}${sourcesMarkup(old,mode)}</div><div><strong>本次候选 · 待核对</strong><p>${esc(next.value||proposal.value)}</p>${note('事件时间：'+eventTimeText(next))}${sourcesMarkup(next,mode)}</div></div><label class="field"><span>这两条内容如何处理${c.requires_resolution||c.relation==='conflict'?'（所选冲突必填）':'（可选）'}</span><select name="comparison-resolution" data-resolution="${esc(key)}"><option value="">请选择处理方式</option>${[['keep_existing','保留旧记录，不写入本次候选'],['replace','用本次内容更新旧记录（旧版本保留）'],['keep_both','分别保留两次记录'],['defer','暂缓处理，继续留待核对']].map(([value,label])=>`<option value="${value}" ${choices[key]===value?'selected':''}>${label}</option>`).join('')}</select></label></section>`;
  }).join('');
}
export function careDetailsMarkup(task,draft='',mode='web',busy=false){
  const guidance=task.source_kind==='model_guidance';
  return `<section class="care-original"><h3>${guidance?'模型建议 · '+(task.category==='recovery'?'恢复指导':'注意事项'):'原始医嘱'}</h3><blockquote>${esc(task.text)}</blockquote>${note(task.schedule?'原文时间：'+task.schedule:'未指定截止时间')}${(task.instruction_refs||[]).map(ref=>note('医嘱原文 · v'+ref.revision)).join('')}${sourcesMarkup({source_refs:task.source_refs||[]},mode)}</section>${guidance?note('根据相关资料整理，供沟通和日常记录参考，不替代原始医嘱。'):''}${!guidance?`<section class="care-explanation"><h3>模型解释</h3><p>${esc(task.explanation||'这条旧事项尚未生成解释，请以原始医嘱为准。')}</p>${note('解释仅帮助理解，不改变原始剂量、频次或医嘱。')}${task.questions?.length?`<h3>向医生核实</h3><ul>${task.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul>`:''}</section>`:''}${task.validity!=='current'?note('来源依赖已过期。反馈会保留原医嘱版本，不会重新启用事项。'):''}<section class="care-feedback"><h3>反馈执行情况</h3><label class="field"><span>进展、新的感受，或想问的问题</span><textarea id="care-feedback-text" name="careFeedback" rows="4" data-task="${esc(task.id)}" placeholder="例如：今天完成了记录，还有一处想向医生核实…">${esc(draft)}</textarea></label>${note('提交后保存为患者自述并继续对话，有关变化会自动整理到近况概览。')}${button(busy?'正在保存…':'保存反馈并继续对话','care-feedback',mode,`data-id="${esc(task.id)}" data-version="${esc(task.version)}" ${busy?'disabled':''}`)}</section>`;
}
export function profileCorrectionMarkup(fact,text,mode='web',busy=false){return `<section class="health-fact"><h2>更正这条事实</h2>${note('当前事实 · v'+fact.revision)}<blockquote>${esc(fact.value)}</blockquote><label class="field"><span>正确的完整描述</span><textarea id="profile-correction-text" name="profileCorrection" rows="5">${esc(text)}</textarea></label>${note('原始记录和旧版本保留。保存后仍需核对候选。')}${button(busy?'正在保存…':'保存修改并核对','save-profile-correction',mode,busy?'disabled':'')}</section>`;}
export function documentStatusLabel(item){
  if(!item)return '等待文件';
  if(['queued','transcribing','verifying'].includes(item.extraction_status))return item.extraction_status==='queued'?'等待识别图片':'正在识别图片';
  if(item.extraction_status==='unreadable')return '图片文字未能辨清';
  if(['failed','blocked','interrupted','cancelled'].includes(item.extraction_status))return '图片识别未完成';
  if(['queued','running'].includes(item.analysis_status))return item.analysis_status==='queued'?'等待分析':'正在分析';
  if(['failed','blocked','interrupted','cancelled'].includes(item.analysis_status))return '分析未完成';
  if(item.proposals?.length)return '待核对';
  if(['queued','running'].includes(item.care_status))return '正在整理诊后建议';
  if(['failed','blocked','interrupted','cancelled'].includes(item.care_status))return '诊后建议未完成';
  if(item.care_status==='completed')return '已整理';
  if(item.analysis==='running'||['queued','running'].includes(item.run_status))return item.run_status==='queued'?'等待分析':'正在分析';
  if(item.analysis==='failed')return '分析未完成';
  if(item.status==='confirmed')return '已核对';
  return item.analysis==='complete'||item.analysis_status==='completed'?'分析已结束':'原文已保存';
}
export function documentAnalysisMarkup(item,mode='web',retrying=false){
  if(!item)return note('可上传 PNG / JPEG 图片、文字文件或带文本的 PDF，也可以直接粘贴病历文字。');
  const label=retrying?'正在处理':documentStatusLabel(item);
  const processing=retrying||['等待识别图片','正在识别图片','等待分析','正在分析','正在整理诊后建议'].includes(label);
  const failed=/未完成|未能辨清/.test(label),careFailure=label==='诊后建议未完成';
  const detail=processing?'原件已保存。图片先识别为完整文字，再结合相关记录分析，最后整理医嘱解释和模型建议。':failed?'本次处理尚未完成，原件与已取得的文字仍保留，可从失败步骤重试。':item.proposals?.length?'记录已自动整理。以下差异或不确定内容需要一起核实。':'病历内容已保留。患者自述、病历记载和模型建议分别呈现，均可查看来源。';
  const originalUrl=typeof item.original_url==='string'&&/^\/api\/documents\/[^/]+\/original$/.test(item.original_url)?item.original_url:null;
  return `<aside class="document-analysis" role="status" ${processing?'aria-busy="true"':''}><strong>${processing?'<span class="loading-dot" aria-hidden="true"></span>':''}${esc(label)}</strong>${note(detail)}${item.transcript?.uncertainties?.length?`<div class="transcript-uncertainty"><strong>识别中不确定的内容</strong><ul>${item.transcript.uncertainties.map(value=>`<li>${esc(value)}</li>`).join('')}</ul></div>`:''}<div class="document-actions">${originalUrl?`<a class="${mode==='mobile'?'button secondary':'btn btn-secondary'}" href="${esc(originalUrl)}" target="_blank" rel="noopener">查看原始文件</a>`:''}${failed&&!retrying?(careFailure?button('重试诊后建议','retry-care-plan',mode,`data-id="${esc(item.care_run_id)}"`):button('重试分析','retry-medical',mode,`data-id="${esc(item.source_id||item.id)}"`)):''}${item.care_status==='completed'?button('查看诊后事项',mode==='mobile'?'medical-tab':'timeline-medical',mode):''}</div></aside>`;
}
export function pendingReviewItems(data){
  return [...(data.records||[]).map(item=>({item,sourceId:item.id,medical:false})),...(data.documents||[]).map(item=>({item,sourceId:item.source_id||item.id,medical:true}))].map(row=>({...row,count:reviewProposals(row.item).length})).filter(row=>row.count>0&&row.item.review_state==='exceptions');
}
export function latestCareRuns(runs){
  const care=Object.values(runs||{}).filter(run=>run.workflow==='care_plan');
  const superseded=new Set(care.map(run=>run.parent_run_id).filter(Boolean));
  const latest=new Map();
  for(const run of care.filter(run=>!superseded.has(run.id)).sort((a,b)=>(a.created_at||'').localeCompare(b.created_at||'')))latest.set(run.document_id||run.source_ids?.[0]||run.id,run);
  return [...latest.values()];
}
export function careProgressMarkup(runs,mode='web',retrying=new Set(),documents=[]){
  return latestCareRuns(runs).map(run=>{
    const active=['queued','running'].includes(run.status)||retrying.has(run.id),failed=['failed','blocked','interrupted'].includes(run.status);
    if(!active&&!failed)return '';
    const doc=documents.find(item=>item.document_id===run.document_id||item.source_id===run.source_ids?.[0]);
    return `<aside class="document-analysis" role="status" ${active?'aria-busy="true"':''}><strong>${active?'<span class="loading-dot" aria-hidden="true"></span>正在整理医嘱解释与诊后建议':'医嘱解释未完成'}</strong>${doc?.name?note(doc.name):''}${note(active?'病历已保存，正在结合相关记录整理医嘱解释与模型建议。完成后会自动显示。':'已核对的原医嘱仍保留。本次解释未生成，可基于原医嘱重试，无需重复上传或确认。')}${!active&&!run.deleted&&!run.result_id&&!run.fact_change_id?button('重试医嘱解释','retry-care-plan',mode,`data-id="${esc(run.id)}"`):''}${!active&&run.source_ids?.[0]?button('查看原医嘱','source',mode,`data-id="${esc(run.source_ids[0])}"`):''}</aside>`;
  }).join('');
}
