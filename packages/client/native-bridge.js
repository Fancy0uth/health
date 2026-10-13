import {DomainClient} from './domain-client.js';
import {INITIAL} from './demo-data.js';
import {cardText} from './presentation.js';
import {assistantText} from './chat-result.js';
import {recordSummaryText,recordConfirmationText,isRecordConfirmation} from './record-dialogue.js';

const clone=value=>structuredClone(value);
const hasSource=(value,id)=>value.evidence?.some(e=>e.source_id===id);
const iso=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:null;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const uiFields=['sessions','activeSessionId','selectedHistory','currentConcern','impact','visitSessionId','visitHasRelevantHistory','visitStartDate','hiddenSessions','cardEdit','exportAt','voiceConsent','selectedDocumentId'];
const taskStatus=value=>value==='open'?'pending':value;

// Adapt the domain's canonical objects to the ORIGINAL pages' data shape.
// Saving page drafts never writes facts, proposals, model results or task status.
export class NativeBridge {
  constructor(client=new DomainClient()) {this.client=client;this.sources=new Map();this.ui={};this.lastDeletion=null;this.history=[];this.historyRevision=null;}
  saveOverlay(value) {if(value._domainEpoch!==undefined&&value._domainEpoch!==this.client.scopeEpoch)throw fail('LOCAL_DRAFT_EXPIRED','删除后旧页面草稿不能重新保存，请读取当前资料。');this.ui=Object.fromEntries(uiFields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,clone(value[k])]));this.client.setDraft('nativeUi',this.ui);return true;}
  async refresh() {
    await this.client.refresh();
    const s=this.client.state;
    for(const entry of s.timeline.entries)this.sources.set(entry.source_id,entry.source);
    if(this.historyRevision!==s.profile.profile_revision){this.history=(await this.client.exportData()).fact_revisions||[];this.historyRevision=s.profile.profile_revision;}
    const ids=new Set([...s.documents.documents.map(d=>d.source_id),...s.profile.pending_changes.flatMap(c=>c.source_ids),...s.profile.facts.flatMap(f=>(f.evidence||[]).map(e=>e.source_id))]);
    for(const result of s.results)for(const claim of result.payload?.claims||[])for(const e of claim.evidence||[])ids.add(e.source_id);
    for(const id of ids)if(!this.sources.has(id))this.sources.set(id,await this.client.source(id));
    const allowed=new Set([...ids,...s.timeline.entries.map(e=>e.source_id),...s.results.flatMap(r=>(r.dependencies||[]).map(d=>d.source_id).filter(Boolean))]);
    for(const id of this.sources.keys())if(!allowed.has(id))this.sources.delete(id);
    return this.snapshot();
  }
  snapshot() {
    const s=this.client.state,ui=this.client.getDraft('nativeUi',{})||{};
    const runs=Object.values(s.runs).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const facts=s.profile.facts,changes=s.profile.pending_changes;
    const recordFor=(id,text,created,source='用户自述')=>{
      const run=runs.find(r=>['entry','document'].includes(r.workflow)&&r.source_ids?.[0]===id);
      const change=changes.find(c=>c.source_ids?.includes(id));
      const confirmed=facts.filter(f=>hasSource(f,id));
      const prior=this.history.filter(f=>hasSource(f,id)&&f.review_status==='confirmed');
      const proposals=change?.proposals||[];
      const contextOnly=!run&&!change&&!confirmed.length&&!prior.length&&runs.some(r=>r.workflow==='visit'&&r.source_ids?.[0]===id);
      return {id,text,record_kind:contextOnly?'visit_context':'record',review_revision:s.profile.profile_revision,recorded_at:created,created:created?new Date(created).toLocaleString('zh-CN',{hour12:false}):'未记录',date:iso(confirmed.find(f=>f.effective_time?.start)?.effective_time.start)||iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start),summary:confirmed.map(f=>f.value).join('\n')||proposals.map(p=>p.value).join('\n')||text,source,issue:'身体感受',status:contextOnly?'reference':proposals.length?'pending':confirmed.length||prior.length?'confirmed':'pending',analysis:contextOnly?'not_requested':run&&['failed','blocked','interrupted','cancelled'].includes(run.status)?'failed':proposals.length||run?.status==='needs_review'||confirmed.length||prior.length?'complete':'saved',run_id:run?.id||change?.run_id,change_id:change?.id,base_profile_revision:change?.base_profile_revision,proposals,facts:confirmed,confirmedFields:confirmed.length?['description']:[],candidate:{description:proposals.map(p=>p.value).join('\n'),date:iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start)}};
    };
    const threads=s.recordThreads||[],threadSourceIds=new Set(threads.flatMap(thread=>thread.source_ids));
    const records=s.timeline.entries.filter(e=>!threadSourceIds.has(e.source_id)).filter(e=>e.input_kind==="self_report").map(e=>recordFor(e.source_id,e.source.text,e.source.recorded_at||e.source.created_at)).sort((a,b)=>(b.recorded_at||'').localeCompare(a.recorded_at||''));
    const docIds=new Set(s.documents.documents.map(d=>d.source_id));
    for(const id of new Set([...changes.flatMap(c=>c.source_ids),...facts.flatMap(f=>(f.evidence||[]).map(e=>e.source_id))]))if(!threadSourceIds.has(id)&&!docIds.has(id)&&!records.some(r=>r.id===id)&&this.sources.has(id)){const source=this.sources.get(id);records.unshift(recordFor(id,source.text,source.recorded_at||source.created_at));}
    for(const thread of threads){
      const source=this.sources.get(thread.source_ids[0]);if(!source)continue;
      const item=recordFor(source.id,thread.source_ids.map(id=>this.sources.get(id)?.text).filter(Boolean).join('\n'),source.recorded_at||source.created_at);
      const change=changes.find(c=>c.id===thread.latest_change_id),run=runs.find(r=>r.id===thread.latest_run_id);
      item.proposals=change?.proposals||[];item.change_id=change?.id;item.run_id=run?.id;item.record_thread_id=thread.id;item.record_version=thread.version;
      item.base_profile_revision=change?.base_profile_revision;item.facts=facts.filter(f=>thread.source_ids.some(id=>hasSource(f,id)));
      item.date=iso(item.facts.find(f=>f.effective_time?.start)?.effective_time.start)||iso(item.proposals.find(p=>p.effective_time?.start)?.effective_time.start);
      item.status=item.proposals.length?'pending':['confirmed','partially_confirmed'].includes(thread.status)?'confirmed':'pending';
      item.analysis=run&&['failed','blocked','interrupted','cancelled'].includes(run.status)?'failed':item.proposals.length||item.status==='confirmed'?'complete':'saved';
      item.summary=item.proposals.map(p=>p.value).join('\n')||item.facts.map(f=>f.value).join('\n')||item.text;
      records.push(item);
    }
    records.sort((a,b)=>(b.recorded_at||'').localeCompare(a.recorded_at||''));
    const docs=s.documents.documents.map(d=>{const source=this.sources.get(d.source_id);const item=recordFor(d.source_id,source?.text||'',source?.recorded_at||source?.created_at,'病历记载');return {...item,name:d.name,source_id:d.source_id,document_id:d.id,original:source?.text||'',onset:item.date,task:item.proposals.filter(p=>p.field==='instruction').map(p=>p.value).join('\n'),checkedFields:item.facts.some(f=>f.field==='instruction')?['task']:[],demo:false,pages:source?.pages||[]};}).sort((a,b)=>(b.recorded_at||'').localeCompare(a.recorded_at||''));
    const visits=s.results.filter(r=>r.kind==='visit_preparation').sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const card=visits[0];
    const cardRun=runs.find(r=>r.result_id===card?.id);
    const tasks=s.tasks.tasks.map(t=>({...t,status:taskStatus(t.status)}));
    const hidden=new Set(ui.hiddenSessions||[]);
    const chatResults=s.results.filter(r=>r.kind==='assistant_reply').sort((a,b)=>a.created_at.localeCompare(b.created_at));
    const chatSourceIds=new Set(chatResults.map(r=>r.source_ids[0]));
    const sessions=clone(ui.sessions||[]).filter(session=>!hidden.has(session.id)&&!session.record_thread_id&&!session.messages?.some(m=>chatSourceIds.has(m.source_id)||threadSourceIds.has(m.source_id)));
    const conversations=new Map();
    for(const result of chatResults){
      const run=runs.find(r=>r.id===result.run_id),source=this.sources.get(result.source_ids[0]);if(!source)continue;
      const key=result.conversation_id||run?.conversation_id||result.run_id;
      let conversation=conversations.get(key);
      if(!conversation){conversation={id:key,title:source.text.slice(0,24),updatedAt:result.created_at,messages:[]};conversations.set(key,conversation);}
      conversation.messages.push({role:'user',text:source.text,source_id:source.id},{role:'assistant',text:assistantText(result.payload),run_id:result.run_id,action:result.payload.intent==='prepare'?'visit':result.payload.intent==='records'?'timeline':null,demo:false});
      conversation.updatedAt=result.created_at;
    }
    for(const conversation of conversations.values()){
      const local=(ui.sessions||[]).find(session=>session.messages?.some(m=>conversation.messages.some(c=>c.source_id&&c.source_id===m.source_id)));
      if(local){
        conversation.id=local.id;
        const canonicalSources=new Set(conversation.messages.filter(m=>m.role==='user').map(m=>m.source_id));
        const canonicalRuns=new Set(conversation.messages.filter(m=>m.role==='assistant').map(m=>m.run_id));
        const lastSettled=local.messages.findLastIndex(m=>canonicalSources.has(m.source_id)||canonicalRuns.has(m.run_id));
        const remaining=local.messages.slice(lastSettled+1);
        const firstPending=remaining.findIndex(m=>m.role==='user'&&(!m.source_id||this.sources.has(m.source_id)));
        if(firstPending>=0){conversation.messages.push(...clone(remaining.slice(firstPending)));conversation.updatedAt=local.updatedAt;if(local.failedQuestion)conversation.failedQuestion=local.failedQuestion;}
      }
      if(!hidden.has(conversation.id))sessions.push(conversation);
    }
    for(const thread of threads){
      if(hidden.has(thread.id))continue;
      const events=[];
      for(const id of thread.source_ids){const source=this.sources.get(id);if(source)events.push({at:source.recorded_at||source.created_at,order:0,message:{role:'user',text:source.text,source_id:id,kind:'record',recordId:thread.source_ids[0]}});}
      for(const summary of thread.summaries){
        const latest=summary.id===thread.latest_summary_id&&thread.status==='awaiting_confirmation';
        events.push({at:summary.created_at,order:1,message:{role:'assistant',text:recordSummaryText(summary,[...this.sources.values()]),run_id:summary.run_id,recordId:thread.source_ids[0],action:'review',...(latest?{record_review:{summary_id:summary.id,fact_change_id:summary.fact_change_id,candidate_ids:summary.proposals.map(p=>p.id),expected_profile_revision:s.profile.profile_revision}}:{})}});
      }
      for(const confirmation of thread.confirmations){
        if(confirmation.message)events.push({at:confirmation.created_at,order:2,message:{role:'user',text:confirmation.message}});
        events.push({at:confirmation.created_at,order:3,message:{role:'assistant',text:recordConfirmationText(confirmation)}});
      }
      events.sort((a,b)=>a.at.localeCompare(b.at)||a.order-b.order);
      const run=runs.find(r=>r.id===thread.latest_run_id),pending=run&&['queued','running'].includes(run.status);
      if(pending)events.push({message:{role:'assistant',text:'原文已保存，模型正在整理并生成待确认汇总。',run_id:run.id}});
      else if(run&&['failed','blocked','interrupted','cancelled'].includes(run.status)&&!thread.summaries.some(summary=>summary.run_id===run.id))events.push({message:{role:'assistant',text:'模型整理未完成，原文已保留。可以重新分析这条记录。',run_id:run.id,action:'review',recordId:thread.source_ids[0]}});
      sessions.push({id:thread.id,record_thread_id:thread.id,record_version:thread.version,record_status:thread.status,title:this.sources.get(thread.source_ids[0])?.text.slice(0,24)||'身体感受记录',updatedAt:thread.updated_at,messages:events.map(event=>event.message)});
    }
    for(const item of records)if(!item.record_thread_id&&!hidden.has(item.id)&&!sessions.some(session=>session.messages?.some(m=>m.recordId===item.id)))sessions.push({id:item.id,title:item.text.slice(0,24),updatedAt:this.sources.get(item.id)?.recorded_at||this.sources.get(item.id)?.created_at,messages:[{role:'user',text:item.text,kind:'record',recordId:item.id}]});
    const concernSource=this.sources.get(cardRun?.source_ids?.[0]);
    if(concernSource&&!hidden.has(concernSource.id)&&!sessions.some(session=>session.id===concernSource.id))sessions.push({id:concernSource.id,title:concernSource.text.slice(0,24),updatedAt:card.created_at,messages:[{role:'user',text:concernSource.text},{role:'assistant',text:card.payload.speech,action:'visit'}]});
    const sourceIds=new Set(records.map(r=>r.id));
    const selectedHistory=(ui.selectedHistory||[]).filter(id=>sourceIds.has(id));
    const dates=facts.map(f=>iso(f.effective_time?.start)).filter(Boolean);
    const edited=ui.cardEdit?.result_id===card?.id?ui.cardEdit:null;
    const granted=s.consents.consents.find(c=>c.purpose==='analysis')?.granted===true;
    return {...clone(INITIAL),currentConcern:'',impact:'',exportAt:'',...clone(ui),_domainEpoch:this.client.scopeEpoch,records,sessions,selectedHistory,factVersion:s.profile.profile_revision||0,factHistory:this.history.filter(f=>f.supersedes_revision).map(f=>({recordId:f.evidence?.[0]?.source_id,version:f.revision,oldValue:this.history.find(old=>old.fact_id===f.fact_id&&old.revision===f.supersedes_revision)?.value,newValue:f.value,reason:'用户提交并核对的更正原文',changedAt:f.confirmed_at})),symptomStart:dates[0]||'',recentChange:'',medical:docs.find(doc=>doc.source_id===ui.selectedDocumentId)||docs[0]||null,documents:docs,uploadedName:docs[0]?.name||'',uploadState:docs[0]?(docs[0].status==='confirmed'?'reviewed':docs[0].analysis==='failed'?'failed':'parsed'):'empty',recordReviewed:docs[0]?.status==='confirmed',tasks,taskStatus:tasks[0]?.status||'pending',cardVersion:card?Math.max(1,cardRun?.base_profile_revision||s.profile.profile_revision):0,cardDraft:edited?.speech??card?.payload.speech??'',questions:edited?.questions??card?.payload.questions??[],cardConcern:card?.payload.speech||'',cardStartDate:null,cardGeneratedAt:card?.created_at?.slice(0,10)||'',cardSourceDeleted:card?.status==='stale'||card?.validity==='stale',cardRecords:(card?.dependencies||[]).map(dep=>records.find(r=>r.id===dep.source_id)||this.history.find(f=>f.fact_id===dep.fact_id&&f.revision===dep.revision)).filter(Boolean).map(r=>({id:r.fact_id?r.evidence?.[0]?.source_id:r.id,text:r.text||r.value,date:r.date||null,status:r.review_status==='confirmed'?'confirmed':r.status||'pending',source:r.source||'用户自述'})),cardResultId:card?.id||null,cardConversationId:concernSource?.id||null,cardRun,cardArchive:visits.slice(1).map(r=>({version:r.profile_revision,text:r.payload.speech,stale:true})),consent:{organize:granted,parse:granted,voice:ui.voiceConsent===true},deleteResult:(this.lastDeletion||this.client.getDraft("nativeDeletion"))?.recorded_at||null,deletionReceipt:this.lastDeletion};
  }
  async recordTurn(text,threadId,version,sourceId) {const receipt=await this.client.createRecordTurn(text,threadId,version,sourceId);await this.refresh();return receipt;}
  async confirmRecord(threadId,message,review) {
    if(!isRecordConfirmation(message))throw fail('CONFIRMATION_REQUIRED','请明确回复“确认”或“确认记录”，其他回复不会提交事实。');
    if(!review?.summary_id)throw fail('NO_PENDING_CANDIDATES','请先查看模型生成的待确认汇总。');
    await this.refresh();const thread=this.client.state.recordThreads.find(t=>t.id===threadId);
    if(!thread||thread.latest_summary_id!==review.summary_id||thread.latest_change_id!==review.fact_change_id)throw fail('REVISION_CONFLICT','汇总已更新，请核对最新汇总后再确认。');
    const existing=thread.confirmations.find(c=>c.record_summary_id===review.summary_id&&c.message&&c.accepted_change_ids.length===review.candidate_ids.length&&review.candidate_ids.every(id=>c.accepted_change_ids.includes(id)));
    if(existing)return clone(existing.outcome);
    const receipt=await this.client.confirm(review.fact_change_id,review.candidate_ids,review.expected_profile_revision,{record_summary_id:review.summary_id,confirmation_message:message});await this.refresh();return receipt;
  }
  async createEntry(text) {const receipt=await this.client.createEntry(text);await this.refresh();return receipt;}
  async createDocument(input) {const receipt=await this.client.createDocument(input);this.saveOverlay({...this.snapshot(),selectedDocumentId:receipt.source_id});await this.refresh();return receipt;}
  async wait(id,options={}) {
    const cancel=()=>this.client.cancelRun(id).catch(()=>{});options.signal?.addEventListener('abort',cancel,{once:true});
    try {const run=await this.client.pollRun(id,{requireRuntime:this.client.state.capabilities?.analysis?.mode==='real',...options});await this.refresh();
      if(['failed','blocked','interrupted','cancelled'].includes(run.status))throw fail(run.error?.code||run.status,run.error?.message||'分析未完成；原文已保存，可以读取运行状态后重试。');
      return run;
    }finally{options.signal?.removeEventListener('abort',cancel);}
  }
  async review(sourceId) {
    await this.refresh();const thread=this.client.state.recordThreads?.find(t=>t.source_ids.includes(sourceId));const change=this.client.state.profile.pending_changes.find(c=>thread?c.id===thread.latest_change_id:c.source_ids?.includes(sourceId));
    if(!change)throw fail('NO_PENDING_CANDIDATES','当前没有可确认的候选；原文保留，请先查看分析状态。');
    return this.client.factChange(change.id);
  }
  async confirm(sourceId,ids,expectedRevision,expectedChangeId) {
    const change=await this.review(sourceId);
    if(!ids.length)throw fail('NO_SELECTION','请逐项选择要确认的真实候选。');
    if(ids.some(id=>!change.proposals.some(p=>p.id===id)))throw fail('REVISION_CONFLICT','候选已变化，保留选择并重新读取。');
    const receipt=await this.client.confirm(expectedChangeId||change.id,ids,expectedRevision??change.review_revision);await this.refresh();return receipt;
  }
  async retryEntry(sourceId) {
    await this.refresh();const thread=this.client.state.recordThreads.find(t=>t.source_ids.includes(sourceId));const run=thread?this.client.state.runs[thread.latest_run_id]:Object.values(this.client.state.runs).filter(r=>r.workflow==='entry'&&r.source_ids?.includes(sourceId)||r.workflow==='document'&&r.source_ids?.[0]===sourceId).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
    if(!run)throw fail('NOT_FOUND','没有找到原运行。');
    return run.status==='needs_review'?this.client.reanalyse(run.id,this.client.state.profile.profile_revision):this.client.retryRun(run.id);
  }
  async updateTask(id,status,version) {const task=this.client.state.tasks.tasks.find(t=>t.id===id);if(!task)throw fail('NOT_FOUND','事项不存在。');await this.client.updateTask(id,status==='pending'?'open':status,version??task.version);await this.refresh();}
  async setConsent(granted) {await this.client.setConsent(granted);await this.refresh();}
  async correct(sourceId,date,reason) {
    await this.refresh();const item=this.snapshot().records.find(r=>r.id===sourceId);const prior=this.history.find(f=>hasSource(f,sourceId));const fact=item?.facts[0]||this.client.state.profile.facts.find(f=>f.fact_id===prior?.fact_id);if(!fact)throw fail('NO_CONFIRMED_FACT','请先核对事实，再更正。');
    const text=`${fact.value}\n更正日期为 ${date}。\n修改原因：${reason}`;
    const receipt=await this.client.changeFact(fact,'correction',text);await this.refresh();return receipt;
  }
  async deleteAll() {const receipt=await this.client.deleteData('all');this.sources.clear();this.ui={};const job=await this.client.operation(receipt.deletion_job_id);this.lastDeletion={...receipt,recorded_at:job.recorded_at};this.client.setDraft('nativeDeletion',this.lastDeletion);await this.refresh();return this.lastDeletion;}
  linkChatSource(question,receipt){const ui=clone(this.client.getDraft('nativeUi',{})||{});const candidates=(ui.sessions||[]).filter(s=>[...s.messages].reverse().find(m=>m.role==='user')?.text===question);const session=candidates.find(s=>s.id===ui.activeSessionId)||candidates.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];if(session){[...session.messages].reverse().find(m=>m.role==='user').source_id=receipt.source_id;this.client.setDraft('nativeUi',ui);}}
  async recover(file=null){const op=this.client.pendingOperations()[0];if(!op)throw fail('NO_PENDING_OPERATION','没有结果未知的原请求。');const receipt=await this.client.retryOperation(op.id,file);if(op.path==='/api/health-assistant')this.linkChatSource(op.body.question,receipt);if(op.path==='/api/record-turns'){const ui=clone(this.client.getDraft('nativeUi',{})||{});ui.activeSessionId=receipt.record_thread_id;this.client.setDraft('nativeUi',ui);}await this.refresh();if(receipt.run_id)await this.wait(receipt.run_id);if(receipt.continuation_run_id)await this.wait(receipt.continuation_run_id);return receipt;}
  copyText(){const result=this.client.state.results.filter(r=>r.kind==='visit_preparation').sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''))[0];if(!result)throw fail('NO_CARD','尚无沟通卡。');const current=this.snapshot();return cardText(result,{sources:[...this.sources.values()],run:current.cardRun,localDraft:current.cardEdit?.result_id===result.id?current.cardDraft:null});}
  async requestAgent(path,payload,options={}) {
    let receipt;
    if(path==='/api/health-record')receipt=await this.createEntry(payload.text);
    else if(path==='/api/medical-document')receipt=await this.createDocument(payload instanceof FormData?{file:payload.get('file')}:{text:payload.text,name:payload.name});
    else if(path==='/api/health-assistant')receipt=await this.client.createChat(payload.question,(payload.messages||[]).filter(m=>m.role==='user').map(m=>m.source_id).filter(Boolean));
    else if(path==='/api/visit-preparations')receipt=await this.client.createVisit(payload.current_concern,payload.selected_record_ids||[]);
    else throw fail('UNSUPPORTED_WORKFLOW','该页面操作尚未接入，请使用记录、就诊准备或病历核对。');
    if(path==='/api/health-assistant')this.linkChatSource(payload.question,receipt);
    options.onRun?.(receipt.run_id);
    const run=await this.wait(receipt.run_id,options);
    if(run.result)return {...run.result.payload,answer:run.result.kind==='assistant_reply'?assistantText(run.result.payload):run.result.payload.speech,action:run.result.kind==='assistant_reply'?(run.result.payload.intent==='prepare'?'visit':run.result.payload.intent==='records'?'timeline':null):'visit',run_id:run.id,source_id:receipt.source_id,runtime:run.runtime,execution_error:run.execution_error};
    const source=await this.client.source(receipt.source_id);
    const proposals=run.change?.proposals||[];
    return {source_id:source.id,run_id:run.id,change_id:run.fact_change_id,original:source.text,description:proposals.map(p=>p.value).join('\n'),date:iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start),onset:iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start),task:proposals.filter(p=>p.field==='instruction').map(p=>p.value).join('\n')||null,proposals};
  }
}

let instance;
export function nativeBridge() {return instance??=new NativeBridge();}
