import {DomainClient} from './domain-client.js';
import {esc,lines,unknown,evidenceHtml,candidateHtml,claimHtml,cardText,runLabel,capabilityText,fieldLabel,assertionLabel,scopeLabel,sourceLabel,reviewLabel,diagnostics} from './presentation.js';

const navigation=[['home','首页','6c88a.svg','home'],['timeline','健康时间线','871e3.svg','timeline'],['card','医生沟通卡','43a76.svg','card'],['settings','设置与数据','5180c.svg','settings']];
const titles={home:'首页',timeline:'健康时间线',card:'医生沟通卡',settings:'设置与数据',visit:'就诊准备',medical:'病历与诊后事项',review:'提取结果核对',source:'用户原文',correct:'更正 / 撤回事实',versions:'事实版本历史',print:'分享与打印'};

// Framework-free shared business views; each entry point supplies its native shell.
export function mountDomainApp({mobile=false,root=document.getElementById('app'),client=new DomainClient()}={}) {
  let page=navigation.some(n=>n[0]===location.hash.slice(1))?location.hash.slice(1):'home';
  let view='',busy=false,error=null,message='',review=null,source=null,fact=null,file=null,selectedResult=null,deletion=null,login={username:'',password:''},menu=false;
  const polling=new Set();let refreshing=false,historyFacts=[];
  const panel=(title,body,extra='')=>`<section class="${mobile?'card':'panel'} ${extra}">${title?`<h2>${esc(title)}</h2>`:''}${body}</section>`;
  const button=(label,action,tone='secondary',extra='')=>`<button type="button" class="${mobile?'button '+tone:'btn btn-'+tone}" data-action="${action}" ${extra} ${busy?'disabled':''}>${esc(label)}</button>`;
  const paragraph=text=>`<p class="hint muted">${esc(text)}</p>`;
  const warning=text=>`<aside class="${mobile?'notice warning':'soft-warning'}"><p>${esc(text)}</p></aside>`;
  const draft=(name,fallback='')=>client.getDraft(name,fallback);
  const textarea=(label,name,placeholder='')=>`<label class="field"><span>${esc(label)}</span><textarea name="${esc(name)}" data-draft="${esc(name)}" rows="4" placeholder="${esc(placeholder)}">${esc(draft(name))}</textarea></label>`;
  const state=()=>client.state;
  const sources=()=>state().timeline.entries.map(e=>e.source);
  const result=()=>state().results.find(r=>r.id===selectedResult)||[...state().results].filter(r=>r.kind==='visit_preparation').sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
  const publicError=err=>({CONSENT_REQUIRED:'尚未授权原文分析，请到设置管理授权。',REVISION_CONFLICT:'资料版本已变化，请刷新后重新核对。',STALE_DEPENDENCY:'这项资料依赖已过期，请先核对当前资料。',AGENT_NOT_CONFIGURED:'运行模型尚未配置；原文仍然保留。',AGH_NOT_READY:'运行模型尚未就绪；原文仍然保留。',AUTH_FAILED:'账号或密码不正确。',SCOPE_EPOCH_CONFLICT:'该请求所属资料范围已变化；旧请求不会改用新范围提交，请刷新并重新核对。',EPOCH_REQUIRED:'尚未取得资料范围，请读取当前账号后重试。',STALE_SCOPE:'收到旧的资料状态，已忽略，请重新读取。',PAYLOAD_TOO_LARGE:'输入或文件超过服务端限额，原文尚未保存。',PDF_NO_TEXT:'PDF 没有可读取的文本层，请粘贴原文。',PDF_CORRUPT:'PDF 文件无法解析，请核对原文件。',UNSUPPORTED_DOCUMENT:'此文件类型不受支持，请选择文本层 PDF。'})[err.code]||(/^[A-Z_]+$/.test(err.message||'')?'请求未完成；输入已保留。':err.message);
  const sourceButton=id=>button('查看原文','source','quiet',`data-id="${esc(id)}"`);
  const runFor=id=>Object.values(state().runs).find(r=>r.result_id===id||r.result_ref===id);
  function navigate(next,secondary='') {page=next;view=secondary;menu=false;error=null;history.replaceState(null,'','#'+next);render();}
  function unknownOperations() {
    return client.pendingOperations().map(op=>panel(op.method==='DELETE'?'删除回执待恢复':op.state==='sending'?'请求处理中 · 尚未取得回执':'前次请求结果未知',`${warning(op.method==='DELETE'?'删除请求结果尚待核对。请用原请求恢复真实回执；不会再次使用新请求键删除资料。':'输入与原请求已保留。先恢复原请求回执；编辑后的内容不会替换原请求，也不会自动提交。')}<details><summary>查看保留的原请求</summary><pre>${esc(JSON.stringify(op.body,null,2))}</pre><p class="small muted">请求键 ${esc(op.key)}</p></details>${op.file_required?`<label class="field"><span>重新选择原文件（会核对内容指纹）</span><input type="file" data-recovery-file="${esc(op.id)}" accept="application/pdf"></label>`:''}${button('查询 / 重试原请求回执','recover','primary',`data-id="${esc(op.id)}"`)}`)).join('');
  }
  function capabilities() {
    return `<div class="domain-unavailable">${['department','triage','audio','ocr'].map(name=>`<p class="small muted">${esc(capabilityText(name))}</p>`).join('')}<div class="button-row">${button('科室推荐未配置','unavailable','secondary','disabled')}${button('观察分级未配置','unavailable','secondary','disabled')}${button('语音输入未支持','unavailable','secondary','disabled')}</div></div>`;
  }
  function runs() {
    const items=Object.values(state().runs).sort((a,b)=>b.created_at.localeCompare(a.created_at));
    return items.map(run=>panel(run.workflow==='care_plan'?'诊后事项续接运行':'原文整理运行',`<p>${esc(runLabel(run))}</p><p class="small muted">${run.workflow==='care_plan'?'已核对医嘱的独立续接':'原文保存 '+(run.saved_receipt?.saved?'已有服务端回执':run.deleted?'已删除':'尚未取得回执')}</p>${diagnostics('运行 '+run.id+' · 阶段 '+run.phase)}${runtimeWarning(run)}${run.error?warning(publicError(run.error))+diagnostics(JSON.stringify(run.error,null,2)):''}<div class="button-row">${run.fact_change_id&&state().profile.pending_changes.some(change=>change.id===run.fact_change_id)?button('核对候选','review','primary',`data-id="${esc(run.fact_change_id)}"`):''}${['failed','blocked','interrupted'].includes(run.status)&&!run.deleted?button('从已保存原文重试','retry-run','secondary',`data-id="${esc(run.id)}"`):''}${['queued','running','needs_review'].includes(run.status)?button('取消该运行','cancel-run','secondary',`data-id="${esc(run.id)}"`):''}${button('读取任务状态','read-run','quiet',`data-id="${esc(run.id)}"`)}${run.source_ids[0]?sourceButton(run.source_ids[0]):''}</div>`)).join('')+(state().runPage.next_cursor?button('读取更早的任务','more-runs','secondary'):'');
  }
  function runtimeWarning(run) {
    if(!run) return paragraph('尚未取得运行来源；产物内容需核对。');
    return `${run.execution_error?warning('执行在保存检查点后异常。检查点已保留；不能据此证明真实模型运行完整成功。'):''}${paragraph(run.runtime?.mode==='fixture'?'合成 fixture 测试运行；非真实模型验证。':run.runtime?.mode==='real'?'服务端提供的真实运行来源：Agnes；仍需核对产物内容。':'运行来源尚未验证 / 配置；不会标记为真实模型完成。')}${run.runtime?.mode==='real'?diagnostics(JSON.stringify(run.runtime.agh,null,2)):''}${run.execution_error?diagnostics(JSON.stringify(run.execution_error,null,2)):''}`;
  }
  function pending() {
    const changes=state().profile.pending_changes;
    return panel('待核对',`<p class="muted">${changes.length} 个检查点 · 用户勾选后才成为正式事实</p>${changes.map(change=>`<div class="domain-list-item"><p>${esc(({new:'新增记录',correction:'更正',retraction:'撤回'})[change.kind]||'候选')} · ${change.proposals.length} 项候选</p>${button('逐项核对','review','primary',`data-id="${esc(change.id)}"`)}</div>`).join('')||paragraph('当前没有待核对候选。')}`);
  }
  function loginBody() {
    return panel('登录 HealthThread',`<p class="muted">使用已由服务端开通的账号。合成演示账号需要在启动时显式配置。</p><form id="domain-login">${['username','password'].map(name=>`<label class="field"><span>${name==='username'?'账号':'密码'}</span><input name="${name}" type="${name==='username'?'text':'password'}" value="${esc(login[name])}" autocomplete="${name==='username'?'username':'current-password'}" required></label>`).join('')}<button class="${mobile?'button primary':'btn btn-primary'}" type="submit" ${busy?'disabled':''}>${busy?'正在登录…':'登录'}</button></form>${button('读取当前已登录账号','bootstrap','secondary')}${paragraph('登录后只显示当前账号服务端资料；本机原型示例不会导入。')}`,'domain-login');
  }
  function home() {
    const isRecord=draft('inputMode','record')==='record';
    const composer=`<form id="domain-record" class="${mobile?'composer':'chat-composer'}"><div class="${mobile?'input-modes':'composer-modes'}"><button type="button" data-action="mode-record" class="${isRecord?'active':''}">记录身体感受</button><button type="button" data-action="mode-ask" class="${isRecord?'':'active'}">向助手提问</button></div>${textarea(isRecord?'记录身体感受':'问题草稿',isRecord?'record':'ask','完整记录你的原话；未提及的内容保持未知。')}<div class="button-row"><button type="submit" class="${mobile?'button primary':'btn btn-primary'}" ${busy?'disabled':''}>${busy?'处理中…':isRecord?'保存原文并整理候选':'查看支持的整理流程'}</button>${button('语音未支持','unavailable','secondary','disabled')}</div></form>`;
    const chat=`<div class="chat-top"><h2>${mobile?'健康信息助手':'AI 健康助手'}</h2></div><div class="${mobile?'domain-home-intro':'chat-empty'}"><h2>今天想记录什么？</h2><p>保存身体感受、整理原文，或准备就诊材料。</p>${isRecord?'':warning('通用医学问答暂未支持。这里不会提供诊断、治疗或用药答案；可保存记录，或将原话整理成就诊材料。')}${button('准备本次就诊','visit','secondary')}</div>${composer}${paragraph('原文先保存；候选仍需你逐项核对。草稿只在本机当前账号会话中保留。')}`;
    return mobile?`<h2>你好，${esc(state().user.username)}</h2>${panel('',chat)}${pending()}${runs()}`:`<h1>你好，${esc(state().user.username)}</h1><div class="home-grid"><section class="chat-panel panel">${chat}</section><div class="home-rail">${pending()}${panel('健康信息，始终连贯',`${paragraph('身体记录与病历分别保存；仅经你核对的内容进入正式事实。')}${button('上传 / 粘贴病历','medical','secondary')}${button('准备就诊','visit','secondary')}`)}</div></div>${runs()}`;
  }
  function timeline() {
    const entries=[...state().timeline.entries].sort((a,b)=>b.received_at.localeCompare(a.received_at));
    return `<div class="${mobile?'segmented':'page-tabs'}">${button('健康记录','timeline','quiet')}${button('病历与诊后事项','medical','quiet')}</div>${panel('正式事实',`<p class="small muted">当前资料版本 v${state().profile.profile_revision} · 未提及保持未知</p>${state().profile.facts.map(f=>`<article class="domain-fact"><strong>${lines(f.value)}</strong><p class="small muted">${esc(fieldLabel(f.field))} · ${esc(assertionLabel(f.assertion))} · ${esc(scopeLabel(f.temporal_scope))} · 时间 ${esc(unknown(f.effective_time?.raw))} · 事实 v${f.revision} · 用户已核对</p>${paragraph('事件关联按原文保留，未自动合并。')}${diagnostics('事实 '+f.fact_id+' · 事件 '+(f.episode_id||'未关联'))}${(f.evidence||[]).map(evidenceHtml).join('')}${button('更正 / 撤回','correct','secondary',`data-id="${esc(f.fact_id)}"`)}${button('查看版本历史','versions','quiet',`data-id="${esc(f.fact_id)}"`)}</article>`).join('')||paragraph('尚无经你核对的正式事实。')}`)}${pending()}${panel('不可变用户原文',entries.map(entry=>`<article class="domain-list-item"><p class="small muted">${esc(entry.received_at)} · ${entry.source.kind==='medical_document'?'病历原文':'用户自述原文'}</p>${diagnostics('事件 '+(entry.episode_id||'未关联'))}<p>${lines(entry.source.text)}</p>${paragraph('原文已保存；原文不是已确认事实。')}${sourceButton(entry.source_id)}${button('删除这条来源','delete-source','danger',`data-id="${esc(entry.source_id)}"`)}</article>`).join('')||paragraph('当前账号还没有原文记录。'))}${runs()}`;
  }
  function visit() {
    const selected=draft('selectedSources',[]);
    return panel('把这次情况理清楚',`${textarea('当前困扰（完整原话）','concern','这段原文会先保存，再生成资料表达稿。')}<h3>选择相关历史来源</h3>${sources().map(s=>`<label class="domain-check"><input type="checkbox" data-history="${esc(s.id)}" ${selected.includes(s.id)?'checked':''}><span>${lines(s.text)}<small class="muted">${s.kind==='medical_document'?'病历原文':'自述原文'} · 是否成为事实以核对状态为准</small></span></label>`).join('')||paragraph('还没有历史来源，可只整理本次描述。')}${button('保存困扰原文并生成沟通卡','generate-card','primary')}${capabilities()}`);
  }
  function card() {
    const current=result();
    const choices=state().results.filter(r=>r.kind==='visit_preparation').sort((a,b)=>b.created_at.localeCompare(a.created_at));
    return `${panel('医生沟通卡',`${choices.map(r=>button(`${r.validity==='stale'?'已过期':'当前'} · ${r.created_at}`,'select-card','quiet',`data-id="${esc(r.id)}"`)).join('')}${current?`${current.validity==='stale'?warning('此沟通卡已过期：依赖事实或来源已变化。复制与打印会保留过期标识。'):paragraph('当前资料表达稿；每条内容都保留来源核对状态。')}${runtimeWarning(runFor(current.id))}<div class="speech">${(current.payload.claims||[]).map(c=>claimHtml(c,sources())).join('')}</div><h3>想问医生</h3><ul>${current.payload.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><h3>未知 / 尚需补充</h3><ul>${current.payload.unknowns.map(q=>`<li>${esc(q)}</li>`).join('')}</ul><div class="button-row">${button('复制（含状态与来源）','copy-card','primary')}${button('分享与打印','print-view','secondary')}${button('重新准备本次就诊','visit','secondary')}</div>`:paragraph('还没有服务端沟通卡。先描述本次困扰并保存原文。')}${button('准备就诊','visit','secondary')}`)}${capabilities()}${runs()}`;
  }
  function medical() {
    const tasks=state().tasks.tasks;
    const pdfReady=state().capabilities?.pdf_text?.status==='enabled';
    const docs=state().documents.documents;
    return `${panel('上传并核对病历',`<label class="field upload-zone"><span>选择有文本层的 PDF</span><input type="file" id="medical-file" accept="application/pdf"></label>${file?paragraph(file.name+' · 文件仍在本机，只有点击上传才提交'):''}${paragraph(`服务端上限 ${state().capabilities?.limits?.upload_bytes||5000000} 字节 · ${state().capabilities?.limits?.pdf_pages||30} 页；扫描件与音频未支持。`)}${!pdfReady?warning('服务器文本层 PDF 提取未配置，请先粘贴病历文字。'):''}${button('上传选中的 PDF','upload-file','primary',file&&pdfReady?'':'disabled')}${textarea('也可以粘贴病历原文','medicalText','粘贴原始文字，逐项核对后才形成事实与诊后事项。')}<label class="field"><span>病历名称（可选）</span><input name="medicalName" data-draft="medicalName" value="${esc(draft('medicalName'))}"></label>${button('保存病历原文并提取候选','paste-document','secondary')}`)}${pending()}${panel('病历来源',docs.map(e=>`<article class="domain-list-item"><h3>${esc(e.name||'未命名病历')}</h3><p class="small muted">${e.media_type==='application/pdf'?'文本层 PDF':'粘贴病历原文'} · ${(e.pages||[]).length?(e.pages||[]).length+' 页':'文字来源'}</p><p>${lines(sources().find(source=>source.id===e.source_id)?.text||'请读取原文')}</p>${sourceButton(e.source_id)}${button('删除该来源','delete-source','danger',`data-id="${esc(e.source_id)}"`)}</article>`).join('')||paragraph('当前没有病历原文。'))}${state().documents.next_cursor?button('读取更早的病历','more-documents','secondary'):''}${panel('诊后事项',`${paragraph('事项只来自用户已确认的医嘱；运行续接完成后出现。事项标为完成只表示执行状态，不代表康复。')}${tasks.map(task=>`<article class="domain-list-item"><h3>${lines(task.text)}</h3><p>${esc(({open:'待完成',done:'已完成（执行状态）',paused:'已暂停'})[task.status])} · v${task.version} · ${task.validity==='current'?'当前依赖':'依赖已过期'}</p><p>时间：${esc(unknown(task.schedule))}</p><p class="small muted">${task.instruction_refs.map(ref=>`已确认医嘱版本 ${ref.revision}`).join(' · ')}</p>${diagnostics(task.instruction_refs.map(ref=>'医嘱 '+ref.fact_id+' v'+ref.revision).join('\n'))}${task.source_ids.map(sourceButton).join('')}${task.validity==='current'?`<div class="button-row">${[['done','标为完成'],['paused','暂停'],['open','重新打开']].map(([status,label])=>button(label,'task-status','secondary',`data-id="${esc(task.id)}" data-status="${status}" data-version="${task.version}"`)).join('')}</div>`:warning('资料已变化；请核对当前医嘱并重新整理，不能更新旧事项。')}</article>`).join('')||paragraph('尚无诊后事项。候选医嘱核对后将创建独立续接运行；未核对时不会创建事项。')}`)}${runs()}${capabilities()}`;
  }
  function reviewView() {
    if(!review) return paragraph('正在读取核对检查点…');
    const selected=draft('selection:'+review.id,[]);const current=state().profile.profile_revision;
    const stale=review.base_profile_revision!==current;
    return `${panel('检查点与原文',`${paragraph(`核对基础版本 v${review.base_profile_revision} · 当前资料版本 v${current} · ${reviewLabel(review.status)}`)}${warning('候选尚未成为正式事实。请逐条检查完整原句、否定 / 不确定 / 时间信息及引用范围，再勾选确认。')}${review.sources.map(s=>`<details open><summary>${esc(s.kind==='medical_document'?'病历原文':'自述原文')} · 版本 ${s.text_version}</summary><blockquote>${lines(s.text)}</blockquote>${diagnostics('来源 '+s.id)}${(s.pages||[]).map(p=>paragraph(`PDF 第 ${p.page} 页`)+diagnostics(`UTF-16 [${p.start},${p.end})`)).join('')}</details>`).join('')}`)}${stale?warning('资料版本已变化；旧候选不能直接确认。选择仍保留，可刷新、从已保存原文重新分析，或明确拒绝本次候选。'):''}${review.proposals.map(p=>candidateHtml({...p,episode_id:p.episode_id||state().timeline.entries.find(entry=>entry.source_id===p.evidence?.[0]?.source_id)?.episode_id},{mobile,selected:selected.includes(p.id),before:review.before||state().profile.facts.find(f=>f.fact_id===p.fact_id)})).join('')}${panel('差异与冲突',`${review.conflicts?.length?warning('存在待核对差异，请结合确认前后的原句判断。'):paragraph('当前未列出冲突。')}${review.conflicts?.length?diagnostics(JSON.stringify(review.conflicts,null,2),'查看冲突记录'):''}${paragraph('无冲突列表不等于医学信息已被自动证明；仍由你逐条核对。')}`)}<div class="button-row">${button('确认勾选候选','confirm','primary',!selected.length||review.status!=='pending'||stale?'disabled':'')}${button('刷新当前资料（保留选择）','refresh','secondary')}${review.run_id?button('从原文重新分析','reanalyse','secondary',review.status==='pending'?'':'disabled'):''}${button('拒绝本次候选','reject','danger',review.status==='pending'?'':'disabled')}${button('返回时间线','timeline','secondary')}</div>`;
  }
  function sourceView() {
    return source?panel('不可变原文',`<p>${esc(sourceLabel(source.kind))} · 原文 v${source.text_version} · ${esc(source.recorded_at)}</p><blockquote>${lines(source.text)}</blockquote>${(source.pages||[]).map(p=>paragraph(`第 ${p.page} 页`)+diagnostics(`UTF-16 [${p.start},${p.end})`)).join('')}${paragraph('原文不会被候选或更正覆盖。')+diagnostics('来源 '+source.id)}${button('返回时间线','timeline','secondary')}${button('删除此来源','delete-source','danger',`data-id="${esc(source.id)}"`)}`):paragraph('正在读取原文…');
  }
  function correction() {
    if(!fact) return paragraph('请先在时间线选择一条正式事实。');
    return panel('更正 / 撤回事实',`<blockquote>${lines(fact.value)}</blockquote>${paragraph(`当前事实 v${fact.revision} · 更正追加用户原文与候选，不直接覆盖历史事实。`)}${textarea('完整更正句或撤回原因','correction:'+fact.fact_id,'写完整原句；提交后还需再次核对。')}<div class="button-row">${button('创建更正候选','change-fact','primary','data-kind="correction"')}${button('创建撤回候选','change-fact','secondary','data-kind="retraction"')}</div>`);
  }
  function settings() {
    const consent=state().consents.consents.find(c=>c.purpose==='analysis');
    return `${panel('当前账号',`<p>${esc(state().user.username)}</p>${button('退出登录','logout','secondary')}${button('刷新当前资料','refresh','quiet')}`)}${panel('分析授权',`<p>${consent?.granted?'已授权原文整理分析':'未授权原文整理分析'} · v${esc(consent?.version)}</p>${paragraph('用于健康原文提取、资料表达与经核对医嘱整理。撤回后旧运行失效；不会继续处理迟到产物。')}${button(consent?.granted?'撤回分析授权':'授权分析','consent','primary',`data-granted="${!consent?.granted}"`)}`)}${panel('导出与删除',`${paragraph('导出只包含当前账号的服务端原文、版本、运行回执及 PDF 原件。本机未发送草稿与服务端资料分别保留。')}${button('下载当前账号导出文件','export','secondary')}${warning('删除会移除当前账号的活动资料与原件，但 AGH 远程痕迹、备份与存储残留无法确认永久擦除，结果会明确显示部分删除。')}<label class="domain-check"><input type="checkbox" data-delete-ack ${draft('deleteAck',false)?'checked':''}><span>我已理解，将删除当前账号全部资料与本机健康草稿。</span></label>${button('删除全部当前账号资料','delete-all','danger',draft('deleteAck',false)?'':'disabled')}`)}${deletion?panel('真实删除回执',`<p>部分删除</p><p>本机活动资料与原件：已删除</p><p>AGH 远程痕迹与外部备份：尚未验证永久擦除</p>${diagnostics(JSON.stringify(deletion.layers,null,2),'查看各层删除回执')}${paragraph('SQLite 活动资料与原件已删除；AGH 痕迹与外部备份仍为未验证，不显示完全删除。')}`):''}${capabilities()}`;
  }
  function versionsView() {
    return panel('服务端事实版本',historyFacts.map(f=>`<article class="domain-fact"><h3>版本 ${f.revision} · ${f.review_status==='retracted'?'用户已撤回':'用户已核对'}</h3><p>${lines(f.value)}</p><p class="small muted">核对时间 ${esc(f.confirmed_at)} </p>${diagnostics('事件 '+(f.episode_id||'未关联'))}${(f.evidence||[]).map(evidenceHtml).join('')}</article>`).join('')||paragraph('尚无版本记录。'));
  }
  function printView() {
    const current=result();return current?`<article class="print-sheet domain-print"><h1>医生沟通卡</h1><pre>${esc(cardText(current,{sources:sources(),run:runFor(current.id)}))}</pre>${button('打印此稿（含来源与过期状态）','print','primary')}</article>`:paragraph('当前没有可打印的卡片。');
  }
  function body() {
    if(!state().user) return loginBody();
    const content=view==='review'?reviewView():view==='source'?sourceView():view==='correct'?correction():view==='versions'?versionsView():view==='print'?printView():view==='visit'?visit():view==='medical'?medical():({home,timeline,card,settings})[page]();
    return `${unknownOperations()}${content}`;
  }
  function shell(content) {
    const title=titles[view]||titles[page];
    const feedback=`${error?`<aside class="domain-error" role="alert"><strong>${esc(publicError(error))}</strong>${diagnostics(JSON.stringify({code:error.code,phase:error.phase,request_id:error.request_id,details:error.details},null,2))}${paragraph(error.code==='OUTCOME_UNKNOWN'?'保存结果尚未知。请使用上方原请求恢复；输入已保留。':'当前输入已保留。来源只有取得保存回执后才会显示已保存。')}</aside>`:''}${message?`<p class="domain-message" role="status">${esc(message)}</p>`:''}`;
    if(mobile) return `<div class="phone with-nav"><div class="status-bar" aria-hidden="true"><span>${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}</span><span>${navigator.onLine?'在线':'离线'} ▰</span></div><header class="app-header">${view?button('返回','back','secondary'):'<div class="brand"><img class="brand-mark" src="./assets/mark.png" width="32" alt=""><img class="wordmark" src="./assets/wordmark.svg" width="140" alt="HealthThread"></div>'}${view?`<h1>${esc(title)}</h1>`:''}</header><main class="screen-body"><div class="content">${feedback}${content}</div></main><nav class="bottom-navigation" aria-label="主导航"><div class="nav-track"><span class="nav-indicator" style="transform:translateX(${navigation.findIndex(n=>n[0]===page)*100}%)"></span>${navigation.map(([id,label,,icon])=>`<button class="nav-item ${page===id?'selected':''}" type="button" data-action="nav" data-page="${id}" ${page===id?'aria-current="page"':''}><span class="icon"><img src="./assets/${icon}.svg" alt=""></span><span>${id==='timeline'?'时间线':id==='card'?'沟通卡':id==='settings'?'设置':label}</span></button>`).join('')}</div><div class="home-indicator"></div></nav></div>`;
    return `<div class="app-shell"><aside class="sidebar ${menu?'is-open':''}"><div class="brand"><img src="./assets/healththread-logo.svg" width="176" height="121" alt="HealthThread"></div><nav>${navigation.map(([id,label,icon])=>`<button class="nav-item ${page===id?'active':''}" type="button" data-action="nav" data-page="${id}" ${page===id?'aria-current="page"':''}><img src="./assets/${icon}" alt=""><span>${label}</span></button>`).join('')}</nav></aside><div class="main-shell"><header class="topbar"><button class="menu-toggle" data-action="menu" type="button" aria-label="打开菜单">☰</button><strong>${esc(title)}</strong><div class="top-tools"><span>${esc(state().user?.username||'未登录')}</span></div></header><main id="main-content"><div class="content ${page==='home'&&!view?'home-content':''}">${feedback}${view?button('返回主页面','back','secondary'):''}${content}</div></main></div>${menu?'<button type="button" class="mobile-scrim" data-action="menu" aria-label="关闭菜单"></button>':''}</div>`;
  }
  function render() {
    const active=document.activeElement;const name=root.contains(active)?active.name:'';const selection=active&&'selectionStart'in active?[active.selectionStart,active.selectionEnd]:null;const scroll=root.querySelector('.screen-body')?.scrollTop||0;
    const disclosures=new Map([...root.querySelectorAll('details')].map(el=>[(el.querySelector('summary')?.textContent||'')+'::'+(el.querySelector('pre,blockquote')?.textContent||''),el.open]));
    root.innerHTML=shell(body());
    for(const el of root.querySelectorAll('details')) {const key=(el.querySelector('summary')?.textContent||'')+'::'+(el.querySelector('pre,blockquote')?.textContent||'');if(disclosures.has(key)) el.open=disclosures.get(key);}document.title=(titles[view]||titles[page])+' · HealthThread'+(mobile?' 手机端':'');
    if(root.querySelector('.screen-body')) root.querySelector('.screen-body').scrollTop=scroll;
    if(name) {const target=[...root.querySelectorAll('[name]')].find(el=>el.name===name);if(target){target.focus({preventScroll:true});if(selection&&target.setSelectionRange&&!['checkbox','file'].includes(target.type)) target.setSelectionRange(...selection);}}
  }
  async function startRun(receipt) {
    if(receipt.deletion_job_id) {deletion=receipt;view='';page='settings';message='已恢复真实删除回执：活动资料与原件已删除，远程痕迹和备份尚未验证，结果为部分删除。';render();return;}
    message=receipt.saved?'原文已保存，已有服务端回执。整理结果仍需核对。':'操作已接收。';
    if(receipt.run_id) watch(receipt.run_id);
    if(receipt.commit_receipt) {
      const commit=await client.operation(receipt.commit_receipt);
      if(['confirm','reject'].includes(commit.kind)) {const change=await client.factChange(commit.fact_change_id);if(change.run_id) watch(change.run_id);review=null;page='timeline';view=change.document_id?'medical':'';message=commit.kind==='confirm'?'已取得用户核对事务回执，所选事实已确认。':'已取得拒绝回执，没有新增正式事实。';}
    }
    if(receipt.fact_change_id) {review=await client.factChange(receipt.fact_change_id);view='review';}
    await client.refresh();render();
  }
  function watch(id,{force=false}={}) {
    if(polling.has(id)) return;polling.add(id);
    client.pollRun(id,{force,refresh:false}).then(async run=>{if(run.status==='needs_review') message='候选已暂存，等待逐项核对；尚未成为正式事实。';else if(run.phase==='confirmed') message='用户核对事务已完成，正式事实已更新。';else if(run.phase==='rejected') message='候选已明确拒绝。';else if(run.status==='completed') message=run.execution_error?'检查点已保存，但后续执行异常。':'产物检查点已保存，请查看来源与核对状态。';await client.refresh();}).catch(err=>{if(err.code!=='SESSION_CHANGED') error=err;}).finally(()=>{polling.delete(id);render();});
  }
  async function act(action,el) {
    if(action==='nav') return navigate(el.dataset.page);
    if(action==='menu') {menu=!menu;return render();}
    if(action==='back') {view='';return render();}
    if(action==='timeline') return navigate('timeline');
    if(action==='medical') return navigate('timeline','medical');
    if(action==='visit') return navigate('home','visit');
    if(action==='mode-record'||action==='mode-ask') {client.setDraft('inputMode',action==='mode-record'?'record':'ask');return render();}
    if(action==='select-card') {selectedResult=el.dataset.id;return render();}
    if(action==='print-view') {view='print';return render();}
    if(action==='print') return window.print();
    if(busy) return;busy=true;error=null;message='';render();
    try {
      switch(action) {
        case 'login': await client.login(login.username,login.password);login.password='';message='已登录当前账号。';page='home';view='';await discoverRuns();break;
        case 'bootstrap': await client.initialize();await discoverRuns();break;
        case 'logout': await client.logout();break;
        case 'refresh': await client.refresh();if(review) review=await client.factChange(review.id);await discoverRuns();break;
        case 'record': {
          if(draft('inputMode','record')!=='record') {message='通用医学问答暂未支持。可把问题和身体感受整理成就诊材料，由医生回答。';if(!draft('concern')) client.setDraft('concern',draft('ask'));view='visit';break;}
          const original=draft('record');if(!original.trim()) throw new Error('先填写身体感受。');const accepted=await client.createEntry(original);client.clearDraftIf('record',original);await startRun(accepted);break;
        }
        case 'review': review=await client.factChange(el.dataset.id);view='review';break;
        case 'confirm': {const ids=draft('selection:'+review.id,[]);const outcome=await client.confirm(review.id,ids,review.base_profile_revision);message='已核对所选事实，资料版本 v'+outcome.profile_revision;if(outcome.continuation_run_id) {message+='；诊后事项续接运行已单独排队。';watch(outcome.continuation_run_id);}await client.refresh();if(review.run_id)await client.pollRun(review.run_id);view='';page=review.document_id?'timeline':'timeline';if(review.document_id)view='medical';review=null;break;}
        case 'reject': await client.reject(review.id,state().profile.profile_revision);await client.refresh();if(review.run_id)await client.pollRun(review.run_id);review=null;view='';message='本次候选已明确拒绝，没有新增正式事实。';break;
        case 'reanalyse': {const receipt=await client.reanalyse(review.run_id,state().profile.profile_revision);review=null;view='';await startRun(receipt);break;}
        case 'source': source=await client.source(el.dataset.id);view='source';break;
        case 'versions': {const data=await client.exportData();historyFacts=data.fact_revisions.filter(f=>f.fact_id===el.dataset.id).sort((a,b)=>b.revision-a.revision);view='versions';break;}
        case 'correct': fact=state().profile.facts.find(f=>f.fact_id===el.dataset.id);view='correct';break;
        case 'change-fact': {const text=draft('correction:'+fact.fact_id);if(!text.trim()) throw new Error('请填写完整更正句或撤回原因。');await startRun(await client.changeFact(fact,el.dataset.kind,text));break;}
        case 'generate-card': {const text=draft('concern');if(!text.trim()) throw new Error('请填写当前困扰。');await startRun(await client.createVisit(text,draft('selectedSources',[])));navigate('card');break;}
        case 'copy-card': await navigator.clipboard.writeText(cardText(result(),{sources:sources(),run:runFor(result().id)}));message='已复制，包含来源、核对状态与过期标识。';break;
        case 'upload-file': if(!file) throw new Error('请先选择 PDF。');await startRun(await client.createDocument({file}));file=null;break;
        case 'paste-document': {const text=draft('medicalText');if(!text.trim()) throw new Error('请粘贴病历原文。');await startRun(await client.createDocument({text,name:draft('medicalName')}));client.clearDraftIf('medicalText',text);break;}
        case 'task-status': await client.updateTask(el.dataset.id,el.dataset.status,Number(el.dataset.version));message='事项执行状态已更新；这不表示康复。';break;
        case 'consent': await client.setConsent(el.dataset.granted==='true');message=el.dataset.granted==='true'?'已授权分析。':'已撤回分析；旧运行失效。';break;
        case 'export': {const payload=await client.exportData();const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='HealthThread-account-export.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);message='当前账号导出文件已生成。';break;}
        case 'delete-all': if(!draft('deleteAck',false)) throw new Error('请先勾选删除确认。');deletion=await client.deleteData('all');review=source=fact=file=null;view='';page='settings';message='活动资料与原件已删除；远程痕迹和备份未验证，结果为部分删除。';break;
        case 'delete-source': {if(!window.confirm('删除这条原文及其相关事实、候选与产物？远程痕迹及备份仍无法确认擦除。')) break;deletion=await client.deleteData(el.dataset.id);review=source=fact=null;view='';page='settings';message='该来源已部分删除，详情见回执。';break;}
        case 'retry-run': await startRun(await client.retryRun(el.dataset.id));break;
        case 'cancel-run': await client.cancelRun(el.dataset.id);await client.refresh();message='运行已取消；已保存的原文仍保留。';break;
        case 'read-run': watch(el.dataset.id,{force:true});break;
        case 'more-runs': await client.loadMoreRuns();await discoverRuns();break;
        case 'more-documents': await client.loadMoreDocuments();break;
        case 'recover': {const receipt=await client.retryOperation(el.dataset.id,recoveryFiles.get(el.dataset.id));await startRun(receipt);if(receipt.continuation_run_id) watch(receipt.continuation_run_id);break;}
      }
    } catch(err) {error=err;if(err.status===409){message='版本或原请求冲突；输入与选择保留，请刷新当前资料后重新核对。';await client.refresh().catch(()=>{});} }
    finally {busy=false;render();}
  }
  const recoveryFiles=new Map();
  root.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el&&!el.disabled) act(el.dataset.action,el);});
  root.addEventListener('submit',event=>{if(['domain-record','domain-login'].includes(event.target.id)){event.preventDefault();act(event.target.id==='domain-login'?'login':'record',event.target);}});
  root.addEventListener('input',event=>{const el=event.target;if(el.dataset.draft) client.setDraft(el.dataset.draft,el.value);if(el.closest('#domain-login')&&el.name in login) login[el.name]=el.value;});
  root.addEventListener('change',event=>{
    const el=event.target;
    if(el.dataset.proposal) {const name='selection:'+review.id;const selected=new Set(draft(name,[]));el.checked?selected.add(el.dataset.proposal):selected.delete(el.dataset.proposal);client.setDraft(name,[...selected]);render();}
    if(el.dataset.history) {const selected=new Set(draft('selectedSources',[]));el.checked?selected.add(el.dataset.history):selected.delete(el.dataset.history);client.setDraft('selectedSources',[...selected]);}
    if(el.hasAttribute('data-delete-ack')) {client.setDraft('deleteAck',el.checked);render();}
    if(el.id==='medical-file') {file=el.files?.[0]||null;render();}
    if(el.dataset.recoveryFile) recoveryFiles.set(el.dataset.recoveryFile,el.files?.[0]);
  });
  async function discoverRuns() {
    if(!state().user) return;
    // The owner catalog already provides terminal status/receipt/provenance. Only active
    // work needs a watcher; reading settled history never loops through whole projections.
    for(const run of Object.values(state().runs)) if(['queued','running'].includes(run.status)&&!polling.has(run.id)) watch(run.id);
  }
  client.subscribe(event=>{
    if(['identity','scope'].includes(event.type)) {review=source=fact=selectedResult=null;file=null;recoveryFiles.clear();historyFacts=[];if(event.type==='identity'){view='';message='登录状态已变化，请登录或读取当前账号。';}}
    if(event.type==='deletion') {deletion=event.receipt;view='';page='settings';message='活动资料与原件已删除；远程痕迹和备份尚未验证，结果为部分删除。';}
    if(event.type==='selection-pruned') message='已从相关历史选择中移除 '+event.count+' 条已删除来源；当前困扰与其他有效选择已保留。';
    if(event.type==='error') error=event.error;
    if(event.type==='storage') message=event.message;
    render();
  });
  const interval=setInterval(async()=>{if(!state().user||refreshing||busy||document.hidden) return;refreshing=true;try{await client.refresh();await discoverRuns();}catch(err){if(!['SESSION_CHANGED','PROFILE_CHANGED','STALE_SCOPE'].includes(err.code)) error=err;}finally{refreshing=false;render();}},5000);
  window.addEventListener('pagehide',()=>{clearInterval(interval);client.dispose();},{once:true});
  window.addEventListener('popstate',()=>{const next=location.hash.slice(1);if(navigation.some(n=>n[0]===next)) navigate(next);});
  render();client.initialize().then(discoverRuns).catch(err=>{error=err;render();});
  return {client,render};
}
