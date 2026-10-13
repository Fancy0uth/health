import {reviewProposals,latestCareRuns} from './health-profile.js';
import {DomainClient} from './domain-client.js';
import {INITIAL} from './demo-data.js';
import {cardText} from './presentation.js';
import {assistantMessage,eligibleChatRetries} from './chat-result.js';
import {recordSummaryText,recordConfirmationText,isRecordConfirmation} from './record-dialogue.js';

const clone=value=>structuredClone(value);
const hasSource=(value,id)=>value.evidence?.some(e=>e.source_id===id);
const iso=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value:null;
const fail=(code,message)=>Object.assign(new Error(message),{code});
const uiFields=['sessions','activeSessionId','selectedHistory','currentConcern','impact','visitSessionId','visitHasRelevantHistory','visitStartDate','hiddenSessions','cardEdit','exportAt','voiceConsent','selectedDocumentId','selectedCardResultId','cardRegeneration'];
const taskStatus=value=>value==='open'?'pending':value;

// Adapt the domain's canonical objects to the ORIGINAL pages' data shape.
// Saving page drafts never writes facts, proposals, model results or task status.
export class NativeBridge {
  constructor(client=new DomainClient()) {this.client=client;this.sources=new Map();this.ui={};this.lastDeletion=null;this.history=[];this.historyRevision=null;this.refreshSequence=0;
    client.subscribe(event=>{if(['identity','scope'].includes(event.type)){this.refreshSequence++;this.sources.clear();this.history=[];this.historyRevision=null;this.ui={};this.lastDeletion=null;}});
  }
  saveOverlay(value) {if((value._domainEpoch!==undefined&&value._domainEpoch!==this.client.scopeEpoch)||(value._domainOwner!==undefined&&value._domainOwner!==(this.client.state.user?.id??null))||(value._domainSession!==undefined&&value._domainSession!==this.client.sessionEpoch))throw fail('LOCAL_DRAFT_EXPIRED','登录或资料范围已变化，请重新打开页面后编辑。');this.ui=Object.fromEntries(uiFields.filter(k=>Object.hasOwn(value,k)).map(k=>[k,clone(value[k])]));this.client.setDraft('nativeUi',this.ui);return true;}
  async refresh() {
    await this.client.refresh();
    const sequence=++this.refreshSequence;
    const ticket=this.client.ticket(),s=this.client.state;
    // A long conversation can outlive the newest run page. Load the linked
    // parent and child explicitly so reopened chats keep their real status.
    for(const result of s.results.filter(result=>result.kind==='assistant_reply'&&(['confirm_visit','confirm_record','confirm_both'].includes(result.payload?.intent)||result.payload?.automatic_record?.action==='save'))){
      const parent=await this.client.read('/api/runs/'+encodeURIComponent(result.run_id));this.client.check(ticket);s.runs[parent.id]=parent;
      for(const id of [parent.continuation_run_id,parent.continuation_record_run_id].filter(Boolean)){
        if(!s.runs[id]||['queued','running'].includes(s.runs[id].status)){const child=await this.client.read('/api/runs/'+encodeURIComponent(id));this.client.check(ticket);s.runs[child.id]=child;}
      }
    }
    for(const doc of s.documents.documents)for(const id of [doc.transcription_run_id,doc.analysis_run_id,doc.care_run_id].filter(Boolean)){
      if(!s.runs[id]||['queued','running'].includes(s.runs[id].status)){const run=await this.client.read('/api/runs/'+encodeURIComponent(id));this.client.check(ticket);s.runs[id]=run;}
    }
    for(const id of [...(s.recordThreads||[]).flatMap(thread=>[thread.latest_run_id,thread.edit_recovery?.run_id]),s.profile.health_profile?.overview?.refresh_run_id].filter(Boolean)){
      if(!s.runs[id]||['queued','running'].includes(s.runs[id].status)){const run=await this.client.read('/api/runs/'+encodeURIComponent(id));this.client.check(ticket);s.runs[id]=run;}
    }
    const pendingCard=this.client.getDraft('nativeUi',{})?.cardRegeneration;
    if(pendingCard){
      let run=s.runs[pendingCard.run_id];
      if(!run){run=await this.client.read('/api/runs/'+encodeURIComponent(pendingCard.run_id));this.client.check(ticket);s.runs[run.id]=run;}
      if(run.status==='completed'&&run.runtime&&!run.execution_error&&s.results.some(result=>result.id===run.result_id)){
        const latestUi=this.client.getDraft('nativeUi',{})||{};
        if(latestUi.cardRegeneration?.run_id===run.id)this.client.setDraft('nativeUi',{...latestUi,...(latestUi.selectedCardResultId===pendingCard.previous_result_id?{selectedCardResultId:run.result_id}:{}),cardRegeneration:null});
      }
    }
    const sources=new Map(this.sources);
    for(const entry of s.timeline.entries)sources.set(entry.source_id,entry.source);
    const history=this.historyRevision!==s.profile.profile_revision?(await this.client.exportData()).fact_revisions||[]:this.history;
    this.client.check(ticket);
    const ids=new Set([...s.documents.documents.flatMap(d=>[d.source_id,d.analysis_source_id].filter(Boolean)),...s.profile.pending_changes.flatMap(c=>c.source_ids),...s.profile.facts.flatMap(f=>(f.evidence||[]).map(e=>e.source_id))]);
    for(const run of Object.values(s.runs))if(run.workflow==='chat')for(const id of run.source_ids||[])ids.add(id);
    for(const result of s.results)for(const id of result.source_ids||[])ids.add(id);
    for(const result of s.results)for(const claim of result.payload?.claims||[])for(const e of claim.evidence||[])ids.add(e.source_id);
    for(const thread of s.recordThreads||[])for(const id of thread.source_ids)ids.add(id);
    for(const id of ids)if(!sources.has(id)){const source=await this.client.source(id);this.client.check(ticket);sources.set(id,source);}
    const allowed=new Set([...ids,...s.timeline.entries.map(e=>e.source_id),...s.results.flatMap(r=>(r.dependencies||[]).map(d=>d.source_id).filter(Boolean))]);
    for(const id of sources.keys())if(!allowed.has(id))sources.delete(id);
    this.client.check(ticket);
    if(sequence===this.refreshSequence){this.sources=sources;this.history=history;this.historyRevision=s.profile.profile_revision;}
    return this.snapshot();
  }
  snapshot() {
    const s=this.client.state,ui=this.client.getDraft('nativeUi',{})||{};
    // Client state is published before async cache enrichment completes.
    const sources=new Map(this.sources);
    for(const entry of s.timeline.entries)sources.set(entry.source_id,entry.source);
    const runs=Object.values(s.runs).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const chatSources=new Set([...s.results.filter(result=>result.kind==='assistant_reply').flatMap(result=>result.source_ids||[]),...runs.filter(run=>run.workflow==='chat').flatMap(run=>run.source_ids||[])]);
    for(const session of ui.sessions||[])for(const message of session.messages||[])if(message.role==='user'&&chatSources.has(message.source_id)&&!sources.has(message.source_id))sources.set(message.source_id,{id:message.source_id,text:message.text});
    const facts=s.profile.facts,changes=s.profile.pending_changes;
    const recordFor=(id,text,created,source='用户自述')=>{
      const run=runs.find(r=>['entry','document'].includes(r.workflow)&&r.source_ids?.[0]===id);
      const change=this.pendingChange(id);
      const lineage=new Set(this.history.filter(f=>hasSource(f,id)).map(f=>f.fact_id));
      const confirmed=facts.filter(f=>hasSource(f,id)||lineage.has(f.fact_id));
      const prior=this.history.filter(f=>hasSource(f,id)&&f.review_status==='confirmed');
      const proposals=reviewProposals(change);
      const contextOnly=!run&&!change&&!confirmed.length&&!prior.length&&runs.some(r=>r.workflow==='visit'&&r.source_ids?.[0]===id);
      return {id,text,record_kind:contextOnly?'visit_context':'record',review_state:change?.review_state||'legacy',review_revision:s.profile.profile_revision,recorded_at:created,created:created?new Date(created).toLocaleString('zh-CN',{hour12:false}):'未记录',date:iso(confirmed.find(f=>f.effective_time?.start)?.effective_time.start)||iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start),summary:confirmed.map(f=>f.value).join('\n')||proposals.map(p=>p.value).join('\n')||text,source,issue:'身体感受',status:contextOnly?'reference':proposals.length?'pending':confirmed.some(f=>f.review_status==='patient_report')?'patient_report':confirmed.some(f=>f.review_status==='document_report')?'document_report':confirmed.length||prior.length?'confirmed':'pending',analysis:contextOnly?'not_requested':run&&['failed','blocked','interrupted','cancelled'].includes(run.status)?'failed':proposals.length||run?.status==='needs_review'||confirmed.length||prior.length?'complete':'saved',run_id:run?.id||change?.run_id,run_status:run?.status||null,change_id:change?.id,base_profile_revision:change?.base_profile_revision,proposals,facts:confirmed,confirmedFields:confirmed.length?['description']:[],candidate:{description:proposals.map(p=>p.value).join('\n'),date:iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start)}};
    };
    const threads=s.recordThreads||[],threadSourceIds=new Set(threads.flatMap(thread=>thread.source_ids));
    const docIds=new Set(s.documents.documents.flatMap(d=>[d.source_id,d.analysis_source_id].filter(Boolean)));
    // Accepted correction sources are provenance of the original record, whose
    // current facts already follow this lineage. Keep pending edits as review rows.
    const originalSources=new Set([...docIds,...s.timeline.entries.filter(e=>e.input_kind==='self_report').map(e=>e.source_id)]);
    const correctionSources=new Set(this.history.filter(f=>f.proposal_kind==='correction'&&f.supersedes_revision&&this.history.some(original=>original.fact_id===f.fact_id&&original.revision===1&&original.evidence?.some(e=>originalSources.has(e.source_id)&&!hasSource(f,e.source_id)))).flatMap(f=>f.evidence.map(e=>e.source_id)));
    for(const id of [...threadSourceIds,...docIds,...changes.map(c=>c.source_ids[0]),...runs.filter(r=>['entry','document'].includes(r.workflow)).map(r=>r.source_ids?.[0])])correctionSources.delete(id);
    const records=s.timeline.entries.filter(e=>!threadSourceIds.has(e.source_id)&&!correctionSources.has(e.source_id)).filter(e=>e.input_kind==="self_report").map(e=>recordFor(e.source_id,e.source.text,e.source.recorded_at||e.source.created_at)).sort((a,b)=>(b.recorded_at||'').localeCompare(a.recorded_at||''));
    for(const id of new Set([...changes.flatMap(c=>c.source_ids),...facts.flatMap(f=>(f.evidence||[]).map(e=>e.source_id))]))if(!threadSourceIds.has(id)&&!docIds.has(id)&&!correctionSources.has(id)&&!records.some(r=>r.id===id)&&sources.has(id)){const source=sources.get(id);records.unshift(recordFor(id,source.text,source.recorded_at||source.created_at));}
    for(const thread of threads){
      const source=sources.get(thread.source_ids[0]);if(!source)continue;
      const item=recordFor(source.id,thread.source_ids.map(id=>sources.get(id)?.text).filter(Boolean).join('\n'),source.recorded_at||source.created_at);
      const change=this.pendingChange(source.id),run=runs.find(r=>r.id===thread.latest_run_id);
      item.proposals=reviewProposals(change);item.review_state=change?.review_state||'legacy';item.change_id=change?.id;item.run_id=run?.id;item.record_thread_id=thread.id;item.record_version=thread.version;item.source_ids=thread.source_ids;item.run_status=run?.status;item.edit_pending=!!thread.edit_pending;item.edit_recovery=thread.edit_recovery?clone(thread.edit_recovery):null;item.automatic=!!thread.conversation_id||['saved','saved_with_exceptions'].includes(thread.status);
      item.base_profile_revision=change?.base_profile_revision;const lineage=new Set(this.history.filter(f=>thread.source_ids.some(id=>hasSource(f,id))).map(f=>f.fact_id));item.facts=facts.filter(f=>lineage.has(f.fact_id)||thread.source_ids.some(id=>hasSource(f,id)));
      item.date=iso(item.facts.find(f=>f.effective_time?.start)?.effective_time.start)||iso(item.proposals.find(p=>p.effective_time?.start)?.effective_time.start);
      item.status=item.proposals.length?'pending':item.automatic?'patient_report':['confirmed','partially_confirmed'].includes(thread.status)?'confirmed':'pending';
      item.analysis=run&&['failed','blocked','interrupted','cancelled'].includes(run.status)?'failed':item.proposals.length||['confirmed','patient_report','document_report'].includes(item.status)?'complete':'saved';
      const currentSummary=thread.summaries.find(summary=>summary.id===thread.latest_summary_id&&summary.run_id===thread.latest_run_id);
      item.summary=item.edit_recovery?.text||((item.automatic||item.status==='pending')?currentSummary?.summary:null)||item.proposals.map(p=>p.value).join('\n')||item.facts.map(f=>f.value).join('\n')||item.text;
      records.push(item);
    }
    records.sort((a,b)=>(b.recorded_at||'').localeCompare(a.recorded_at||''));
    const docs=s.documents.documents.map(d=>{
      const analysisSource=d.analysis_source_id||d.source_id,source=sources.get(analysisSource),original=sources.get(d.source_id);
      const item=recordFor(analysisSource,source?.text||d.transcript?.text||'',original?.recorded_at||original?.created_at,'病历记载');
      const care=runs.find(run=>run.id===d.care_run_id);
      return {...item,...d,id:d.source_id,source_id:d.source_id,analysis_source_id:analysisSource,document_id:d.id,care_status:care?.status||null,analysis:['queued','running'].includes(d.analysis_status||item.run_status)?'running':['failed','blocked','interrupted'].includes(d.analysis_status)?'failed':item.analysis,name:d.name,original:source?.text||d.transcript?.text||'',onset:item.date,task:item.proposals.filter(p=>p.field==='instruction').map(p=>p.value).join('\n'),checkedFields:item.facts.some(f=>f.field==='instruction')?['task']:[],demo:false,pages:source?.pages||[]};
    }).sort((a,b)=>(b.recorded_at||'').localeCompare(a.recorded_at||''));
    const selectedDocument=docs.find(doc=>doc.source_id===ui.selectedDocumentId)||docs[0]||null;
    const documentUploadState=!selectedDocument?'empty':selectedDocument.analysis==='running'?'processing':selectedDocument.analysis==='failed'?'failed':selectedDocument.status==='confirmed'?'reviewed':selectedDocument.proposals.length?'parsed':selectedDocument.analysis==='complete'?'complete':'saved';
    const visits=s.results.filter(r=>r.kind==='visit_preparation').sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''));
    const card=visits.find(result=>result.id===ui.selectedCardResultId)||visits[0];
    const cardRun=card&&runs.find(r=>r.result_id===card.id);
    const regenerationRun=ui.cardRegeneration&&s.runs[ui.cardRegeneration.run_id];
    const cardRegenerationFailed=regenerationRun&&(['failed','blocked','cancelled','interrupted'].includes(regenerationRun.status)||regenerationRun.execution_error);
    const cardRegenerationPending=!!ui.cardRegeneration&&!cardRegenerationFailed;
    const tasks=s.tasks.tasks.map(t=>({...t,status:taskStatus(t.status),source_refs:t.source_refs?.length?t.source_refs:(t.instruction_refs||[]).flatMap(ref=>(facts.find(f=>f.fact_id===ref.fact_id&&f.revision===ref.revision)||this.history.find(f=>f.fact_id===ref.fact_id&&f.revision===ref.revision))?.evidence||[])}));
    const hidden=new Set(ui.hiddenSessions||[]);
    const chatResults=s.results.filter(r=>r.kind==='assistant_reply').sort((a,b)=>a.created_at.localeCompare(b.created_at));
    const chatSourceIds=new Set(chatResults.map(r=>r.source_ids[0]));
    const sessions=clone(ui.sessions||[]).filter(session=>!hidden.has(session.id)&&!session.record_thread_id&&!session.messages?.some(m=>chatSourceIds.has(m.source_id)||threadSourceIds.has(m.source_id)));
    const conversations=new Map();
    for(const result of chatResults){
      const run=runs.find(r=>r.id===result.run_id),source=sources.get(result.source_ids[0]);if(!source)continue;
      const key=result.conversation_id||run?.conversation_id||result.run_id;
      let conversation=conversations.get(key);
      if(!conversation){conversation={id:key,conversation_id:key,title:source.text.slice(0,24),updatedAt:result.created_at,messages:[]};conversations.set(key,conversation);}
      conversation.messages.push({role:'user',text:source.text,source_id:source.id,_turn_at:source.recorded_at||source.created_at||result.created_at},{role:'assistant',...assistantMessage(result.payload,run||{id:result.run_id},runs,s.results),_turn_at:source.recorded_at||source.created_at||result.created_at});
      conversation.updatedAt=result.created_at;
    }
    for(const run of [...runs].reverse().filter(run=>run.workflow==='chat'&&!chatResults.some(result=>result.run_id===run.id))){
      const source=sources.get(run.source_ids?.[0]);if(!source)continue;
      if(chatSourceIds.has(source.id)||runs.find(item=>item.workflow==='chat'&&item.source_ids?.[0]===source.id)?.id!==run.id)continue;
      if((ui.sessions||[]).some(session=>session.messages?.some(message=>message.role==='user'&&message.source_id===source.id)))continue;
      const key=run.conversation_id||run.id;
      let conversation=conversations.get(key);
      if(!conversation){conversation={id:key,conversation_id:key,title:source.text.slice(0,24),updatedAt:run.created_at,messages:[]};conversations.set(key,conversation);}
      const failed=['failed','blocked','interrupted','cancelled'].includes(run.status)||run.execution_error;
      conversation.messages.push({role:'user',text:source.text,source_id:source.id,_turn_at:source.recorded_at||source.created_at||run.created_at},{role:'assistant',run_id:run.id,_turn_at:source.recorded_at||source.created_at||run.created_at,text:failed?'这次回复未完成，你的原话已保留。':run.parent_run_id?'正在重新回复，请稍候…':'正在回复，请稍候…'});
      conversation.updatedAt=run.created_at;
    }
    for(const conversation of conversations.values()){
      conversation.messages.sort((a,b)=>(a._turn_at||'').localeCompare(b._turn_at||''));
      conversation.updatedAt=conversation.messages.at(-1)?._turn_at||conversation.updatedAt;
      for(const message of conversation.messages)delete message._turn_at;
      const local=(ui.sessions||[]).find(session=>session.messages?.some(m=>conversation.messages.some(c=>c.source_id&&c.source_id===m.source_id)));
      if(local){
        conversation.id=local.id;
        const canonicalSources=new Set(conversation.messages.filter(m=>m.role==='user').map(m=>m.source_id));
        const canonicalRuns=new Set(conversation.messages.filter(m=>m.role==='assistant').map(m=>m.run_id));
        const lastSettled=local.messages.findLastIndex(m=>canonicalSources.has(m.source_id)||canonicalRuns.has(m.run_id));
        const remaining=local.messages.slice(lastSettled+1);
        // Polling can publish the accepted chat run before its new source
        // reaches the timeline cache. Keep that owned turn visible meanwhile.
        const acceptedSources=new Set(runs.filter(run=>run.workflow==='chat').flatMap(run=>run.source_ids||[]));
        const firstPending=remaining.findIndex(m=>m.role==='user'&&(!m.source_id||sources.has(m.source_id)||acceptedSources.has(m.source_id)));
        if(firstPending>=0){conversation.messages.push(...clone(remaining.slice(firstPending)));conversation.updatedAt=local.updatedAt;if(local.failedQuestion)conversation.failedQuestion=local.failedQuestion;}
      }
      if(!hidden.has(conversation.id))sessions.push(conversation);
    }
    for(const thread of threads){
      if(hidden.has(thread.id)||thread.conversation_id||['saved','saved_with_exceptions'].includes(thread.status))continue;
      const events=[];
      for(const id of thread.source_ids){const source=sources.get(id);if(source)events.push({at:source.recorded_at||source.created_at,order:0,message:{role:'user',text:source.text,source_id:id,kind:'record',recordId:thread.source_ids[0]}});}
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
      sessions.push({id:thread.id,record_thread_id:thread.id,record_version:thread.version,record_status:thread.status,title:sources.get(thread.source_ids[0])?.text.slice(0,24)||'身体感受记录',updatedAt:thread.updated_at,messages:events.map(event=>event.message)});
    }
    for(const item of records)if(item.record_kind!=='visit_context'&&!item.record_thread_id&&!hidden.has(item.id)&&!sessions.some(session=>session.messages?.some(m=>m.recordId===item.id)))sessions.push({id:item.id,title:item.text.slice(0,24),updatedAt:sources.get(item.id)?.recorded_at||sources.get(item.id)?.created_at,messages:[{role:'user',text:item.text,kind:'record',recordId:item.id}]});
    const concernSource=sources.get(cardRun?.source_ids?.[0]||card?.source_ids?.[0]);
    if(concernSource&&!cardRun?.conversation_id&&!hidden.has(concernSource.id)&&!sessions.some(session=>session.id===concernSource.id))sessions.push({id:concernSource.id,title:concernSource.text.slice(0,24),updatedAt:card.created_at,messages:[{role:'user',text:concernSource.text},{role:'assistant',text:card.payload.speech,...(cardRun?.status==='completed'&&cardRun.runtime?{action:'card',visit_result_id:card.id}:{})}]});
    const retryableChats=new Set(eligibleChatRetries(runs).map(run=>run.id));
    for(const session of sessions){
      let sourceId;
      for(const [index,message] of session.messages.entries()){
        if(message.record_source_id){const record=records.find(item=>item.id===message.record_source_id||item.source_ids?.includes(message.record_source_id));if(record)message.record_source_id=record.id;}
        delete message.chat_retry_run_id;
        if(message.role==='user'){sourceId=message.source_id;continue;}
        let run=runs.find(run=>run.workflow==='chat'&&(message.run_id?run.id===message.run_id:message.error&&sourceId&&run.source_ids?.[0]===sourceId));
        if(!run)continue;
        // A persisted failure belongs to the same saved turn when the server
        // accepts a retry. Follow only its canonical same-source parent chain.
        const originalRunId=run.id,visited=new Set([run.id]);
        while(true){
          const child=runs.find(item=>item.workflow==='chat'&&!item.deleted&&item.parent_run_id===run.id&&item.source_ids?.[0]===run.source_ids?.[0]&&item.conversation_id===run.conversation_id&&!visited.has(item.id));
          if(!child)break;run=child;visited.add(run.id);
        }
        const retried=run.id!==originalRunId;
        if(retried||(run.parent_run_id&&message.error)){
          message.run_id=run.id;
          if(['queued','running'].includes(run.status)&&!run.execution_error){message.text='正在重新回复，请稍候…';delete message.error;}
        }
        if((retried||!message.error)&&(['failed','blocked','interrupted','cancelled'].includes(run.status)||run.execution_error)&&!chatResults.some(result=>result.run_id===run.id)){message.text='原文已保存，本次回复未完成。';message.error=true;}
        message.retry_unavailable=true;
        if(retryableChats.has(run.id)&&!session.messages.slice(index+1).some(item=>item.role==='user')){message.chat_retry_run_id=run.id;message.run_id=run.id;}
      }
    }
    const sourceIds=new Set(records.map(r=>r.id));
    const selectedHistory=(ui.selectedHistory||[]).filter(id=>sourceIds.has(id));
    const dates=facts.map(f=>iso(f.effective_time?.start)).filter(Boolean);
    const edited=card?.user_edit?{...card.user_edit,result_id:card.id}:ui.cardEdit?.result_id===card?.id?ui.cardEdit:null;
    const canonicalConversationId=cardRun?.conversation_id||card?.conversation_id;
    const cardConversation=canonicalConversationId?sessions.find(session=>session.conversation_id===canonicalConversationId||session.id===canonicalConversationId):null;
    const granted=s.consents.consents.find(c=>c.purpose==='analysis')?.granted===true;
    return {...clone(INITIAL),healthProfile:clone(s.profile.health_profile||null),currentConcern:'',impact:'',exportAt:'',...clone(ui),_domainEpoch:this.client.scopeEpoch,_domainOwner:this.client.state.user?.id??null,_domainSession:this.client.sessionEpoch,records,sessions,selectedHistory,cardRegenerationPending,cardRegenerationError:cardRegenerationFailed?'沟通卡重新生成未完成，原卡已保留，请重试。':'',factVersion:s.profile.profile_revision||0,factHistory:this.history.filter(f=>f.supersedes_revision).map(f=>({recordId:f.evidence?.[0]?.source_id,version:f.revision,oldValue:this.history.find(old=>old.fact_id===f.fact_id&&old.revision===f.supersedes_revision)?.value,newValue:f.value,reason:'用户提交并核对的更正原文',changedAt:f.confirmed_at})),symptomStart:dates[0]||'',recentChange:'',medical:selectedDocument,documents:docs,uploadedName:selectedDocument?.name||'',uploadState:documentUploadState,recordReviewed:selectedDocument?.status==='confirmed',tasks,taskStatus:tasks[0]?.status||'pending',cardVersion:card?Math.max(1,cardRun?.base_profile_revision||s.profile.profile_revision):0,cardDraft:edited?.speech??card?.payload.speech??'',questions:edited?.questions??card?.payload.questions??[],cardConcern:card?.payload.speech||'',cardStartDate:null,cardGeneratedAt:card?.created_at?.slice(0,10)||'',cardSourceDeleted:card?.status==='stale'||card?.validity==='stale',cardRecords:(card?.dependencies||[]).map(dep=>records.find(r=>r.id===dep.source_id)||this.history.find(f=>f.fact_id===dep.fact_id&&f.revision===dep.revision)).filter(Boolean).map(r=>({id:r.fact_id?r.evidence?.[0]?.source_id:r.id,text:r.text||r.value,date:r.date||null,status:r.review_status==='confirmed'?'confirmed':r.status||'pending',source:r.source||'用户自述'})),cardResultId:card?.id||null,cardConversationId:cardConversation?.id||canonicalConversationId||concernSource?.id||null,cardSourceId:concernSource?.id||null,cardUnknowns:edited?.unknowns??card?.payload.unknowns??[],cardEditRevision:card?.user_edit?.revision||0,cardUserEdited:!!edited,cardRun,cardArchive:visits.slice(1).map(r=>({version:r.profile_revision,text:r.payload.speech,stale:true})),consent:{organize:granted,parse:granted,voice:ui.voiceConsent===true},deleteResult:(this.lastDeletion||this.client.getDraft("nativeDeletion"))?.recorded_at||null,deletionReceipt:this.lastDeletion};
  }
  async retryRecovery(runId) {
    await this.refresh();
    const state=this.client.state,overview=state.profile.health_profile?.overview;
    const edit=(state.recordThreads||[]).some(thread=>thread.edit_recovery?.run_id===runId&&thread.edit_recovery.retryable===true);
    if(!edit&&!(overview?.status==='stale'&&overview.refresh_run_id===runId&&overview.refresh_retryable===true))throw fail('RUN_NOT_RETRYABLE','任务状态已变化，请查看最新进度。');
    const receipt=await this.client.retryRun(runId);await this.refresh();return receipt;
  }
  async retryChatRun(runId) {
    await this.refresh();
    const run=eligibleChatRetries(this.client.state.runs).find(item=>item.id===runId);
    if(!run)throw fail('RUN_NOT_RETRYABLE','对话已更新，请查看最新回复。');
    const source=this.sources.get(run.source_ids?.[0]);
    return this.requestAgent('/api/health-assistant',{question:source?.text||'',retry_source_id:run.source_ids[0],retry_run_id:runId});
  }
  async retryAssistantAction(runId) {
    await this.refresh();
    const runs=Object.values(this.client.state.runs),child=this.client.state.runs[runId];
    if(!runs.some(run=>run.workflow==='chat'&&[run.continuation_run_id,run.continuation_record_run_id].includes(runId))||!child||!['failed','blocked','interrupted'].includes(child.status)||child.result_id||child.fact_change_id)throw fail('RUN_NOT_RETRYABLE','任务状态已变化，请查看最新进度。');
    const receipt=await this.client.retryRun(runId);
    await this.refresh();
    await this.wait(receipt.run_id,{requireRuntime:true});
    return receipt;
  }
  async generateVisit(sessionId) {
    await this.refresh();
    const session=this.snapshot().sessions.find(s=>s.id===sessionId||s.conversation_id===sessionId);
    const messages=(session?.messages||[]).filter(m=>m.role==='user'&&m.text?.trim());
    if(!session||!messages.length)throw fail('NO_VISIT_CONVERSATION','请先在首页和助手聊聊本次就诊情况，再生成沟通卡。');
    const sourceIds=[...new Set(messages.map(m=>m.source_id||m.recordId).filter(Boolean))];
    const conversationId=session.conversation_id||Object.values(this.client.state.runs).find(r=>r.workflow==='chat'&&sourceIds.includes(r.source_ids?.[0]))?.conversation_id;
    if(messages.some(m=>!m.source_id&&!m.recordId))throw fail('CONVERSATION_NOT_READY','请等待本次对话回复完成，再生成沟通卡。');
    const receipt=await this.client.createVisit(conversationId?'':messages.map(m=>m.text).join('\n'),sourceIds,conversationId?{conversation_id:conversationId}:{});
    await this.wait(receipt.run_id);return receipt;
  }
  async regenerateVisit() {
    const resultId=this.snapshot().cardResultId;
    if(!resultId)throw fail('NO_CARD','还没有沟通卡，请先在首页整理本次就诊情况。');
    if(this.snapshot().cardRegenerationPending)throw fail('CARD_GENERATING','沟通卡正在重新生成，请稍候。');
    const receipt=await this.client.createVisit('',[],{previous_result_id:resultId});
    this.saveOverlay({...this.snapshot(),selectedCardResultId:resultId,cardRegeneration:{run_id:receipt.run_id,previous_result_id:resultId}});
    await this.wait(receipt.run_id,{requireRuntime:true});return receipt;
  }
  async saveCardEdit(resultId,speech,questions,expectedRevision=0,unknowns) {
    if(!speech?.trim())throw fail('EMPTY_CARD','请填写想向医生说明的情况。');
    const receipt=await this.client.editVisit(resultId,speech.trim(),questions,expectedRevision,unknowns);
    await this.refresh();
    const ui=this.client.getDraft('nativeUi',{})||{};
    if(ui.cardEdit?.result_id===resultId){const next={...ui};delete next.cardEdit;this.client.setDraft('nativeUi',next);}
    return receipt;
  }
  async recordTurn(text,threadId,version,sourceId) {const receipt=await this.client.createRecordTurn(sourceId?undefined:text,threadId,version,sourceId);await this.refresh();return receipt;}
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
      if(run.execution_error||['failed','blocked','interrupted','cancelled'].includes(run.status))throw fail(run.execution_error?.code||run.error?.code||run.status,run.execution_error?.message||run.error?.message||'分析未完成；原文已保存，可以读取运行状态后重试。');
      return run;
    }catch(error){if(error&&typeof error==='object'&&!error.run_id)error.run_id=id;throw error;}finally{options.signal?.removeEventListener('abort',cancel);}
  }
  pendingChange(sourceId) {
    const document=this.client.state.documents.documents.find(d=>d.source_id===sourceId);
    sourceId=document?.analysis_source_id||sourceId;
    const thread=this.client.state.recordThreads?.find(t=>t.source_ids.includes(sourceId));
    const ids=thread?.source_ids||[sourceId];
    const lineage=new Set(this.history.filter(f=>ids.some(id=>hasSource(f,id))).map(f=>f.fact_id));
    const changes=this.client.state.profile.pending_changes;
    return changes.find(c=>c.kind==='correction'&&(c.source_ids?.some(id=>ids.includes(id))||c.proposals.some(p=>lineage.has(p.fact_id))))||changes.find(c=>thread?c.id===thread.latest_change_id:c.source_ids?.includes(sourceId));
  }
  async review(sourceId) {
    await this.refresh();const change=this.pendingChange(sourceId);
    if(!change)throw fail('NO_PENDING_CANDIDATES','当前没有可确认的候选；原文保留，请先查看分析状态。');
    return this.client.factChange(change.id);
  }
  async confirm(sourceId,ids,expectedRevision,expectedChangeId,resolutions=[]) {
    const change=await this.review(sourceId);
    if(!ids.length)throw fail('NO_SELECTION','请逐项选择要确认的真实候选。');
    if(ids.some(id=>!change.proposals.some(p=>p.id===id)))throw fail('REVISION_CONFLICT','候选已变化，保留选择并重新读取。');
    const receipt=await this.client.confirm(expectedChangeId||change.id,ids,expectedRevision??change.review_revision,{resolutions});await this.refresh();return receipt;
  }
  async retryEntry(sourceId) {
    await this.refresh();
    const document=this.client.state.documents.documents.find(d=>d.source_id===sourceId||d.analysis_source_id===sourceId);
    const thread=this.client.state.recordThreads.find(t=>t.source_ids.includes(sourceId));
    const preferred=document?(['failed','blocked','interrupted','unreadable'].includes(document.extraction_status)?document.transcription_run_id:document.analysis_run_id||document.transcription_run_id):thread?.latest_run_id;
    const run=preferred?this.client.state.runs[preferred]:Object.values(this.client.state.runs).filter(r=>['entry','document','transcription'].includes(r.workflow)&&r.source_ids?.[0]===sourceId).sort((a,b)=>b.created_at.localeCompare(a.created_at))[0];
    if(!run)throw fail('NOT_FOUND','没有找到原运行。');
    return ['needs_review','completed'].includes(run.status)&&run.workflow!=='transcription'?this.client.reanalyse(run.id,this.client.state.profile.profile_revision):this.client.retryRun(run.id);
  }
  async waitDocument(id,options={}) {
    let next=id,last;const visited=new Set();
    while(next&&!visited.has(next)){visited.add(next);last=await this.wait(next,options);next=last.continuation_run_id;}
    return last;
  }
  async retryCarePlan(runId) {
    await this.refresh();
    const run=this.client.state.runs[runId];
    if(!run||run.workflow!=='care_plan'||!['failed','blocked','interrupted'].includes(run.status)||run.deleted||run.fact_change_id||run.result_id)throw fail('RUN_NOT_RETRYABLE','这次医嘱解释不能重试，请查看最新处理状态。');
    if(!latestCareRuns(this.client.state.runs).some(item=>item.id===runId))throw fail('RUN_NOT_RETRYABLE','医嘱解释任务已更新，请查看最新处理状态。');
    const receipt=await this.client.retryRun(runId);await this.refresh();return receipt;
  }
  async updateEpisode(id,status,version) {await this.client.updateEpisode(id,status,version);await this.refresh();}
  async correctFact(id,revision,text) {
    if(!text?.trim())throw fail('INVALID_INPUT','请填写正确的完整描述。');
    await this.refresh();const fact=this.client.state.profile.facts.find(f=>f.fact_id===id);
    if(!fact||fact.revision!==revision)throw fail('REVISION_CONFLICT','事实版本已变化，请重新查看后修改。');
    const receipt=await this.client.changeFact(fact,'correction',text.trim());await this.refresh();return receipt;
  }
  async feedbackTask(id,text,version) {
    if(!text?.trim())throw fail('INVALID_INPUT','请填写执行情况或新的感受。');
    const receipt=await this.client.feedbackTask(id,text.trim(),version);await this.refresh();return receipt;
  }
  async updateTask(id,status,version) {const task=this.client.state.tasks.tasks.find(t=>t.id===id);if(!task)throw fail('NOT_FOUND','事项不存在。');await this.client.updateTask(id,status==='pending'?'open':status,version??task.version);await this.refresh();}
  async setConsent(granted) {await this.client.setConsent(granted);await this.refresh();}
  async editRecord(sourceId,text,factId='',expectedVersion=null) {
    if(!text?.trim())throw fail('INVALID_INPUT','请填写正确的记录内容。');
    await this.refresh();const item=this.snapshot().records.find(r=>r.id===sourceId);
    if(!item)throw fail('NOT_FOUND','没有找到要修改的记录。');
    if(item.record_thread_id&&!factId){const receipt=await this.client.editRecordThread(item.record_thread_id,text.trim(),expectedVersion??item.record_version);await this.refresh();return receipt;}
    const pending=this.client.state.profile.pending_changes.find(c=>c.kind==='correction'&&c.source_ids[0]===sourceId);
    if(pending){
      const proposal=pending.proposals[0],fact=this.client.state.profile.facts.find(f=>f.fact_id===proposal.fact_id);
      if(!fact||fact.revision!==proposal.expected_version)throw fail('REVISION_CONFLICT','事实已变化，请重新查看后修改。');
      const receipt=await this.client.changeFact(fact,'correction',text.trim(),pending.id);await this.refresh();return receipt;
    }
    if(factId){
      const fact=item.facts.find(f=>f.fact_id===factId);
      if(!fact||fact.revision!==expectedVersion)throw fail('REVISION_CONFLICT','事实已变化，请重新查看后修改。');
      const receipt=await this.client.changeFact(fact,'correction',text.trim());await this.refresh();return receipt;
    }
    if(item.facts.length||item.status==='confirmed')throw fail('REVISION_CONFLICT','这条记录已确认，请选择要更正的事实。');
    const receipt=await this.client.createRecordTurn(text.trim(),item.record_thread_id,item.record_version,item.record_thread_id?undefined:sourceId);
    await this.refresh();return receipt;
  }
  async correct(sourceId,date,reason) {
    await this.refresh();const item=this.snapshot().records.find(r=>r.id===sourceId);const prior=this.history.find(f=>hasSource(f,sourceId));const fact=item?.facts[0]||this.client.state.profile.facts.find(f=>f.fact_id===prior?.fact_id);if(!fact)throw fail('NO_CONFIRMED_FACT','请先核对事实，再更正。');
    const text=`${fact.value}\n更正日期为 ${date}。\n修改原因：${reason}`;
    const receipt=await this.client.changeFact(fact,'correction',text);await this.refresh();return receipt;
  }
  async deleteAll() {const receipt=await this.client.deleteData('all');this.sources.clear();this.ui={};const job=await this.client.operation(receipt.deletion_job_id);this.lastDeletion={...receipt,recorded_at:job.recorded_at};this.client.setDraft('nativeDeletion',this.lastDeletion);await this.refresh();return this.lastDeletion;}
  linkChatSource(question,receipt){const ui=clone(this.client.getDraft('nativeUi',{})||{});const candidates=(ui.sessions||[]).filter(s=>[...s.messages].reverse().find(m=>m.role==='user')?.text===question);const session=candidates.find(s=>s.id===ui.activeSessionId)||candidates.sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))[0];if(session){[...session.messages].reverse().find(m=>m.role==='user').source_id=receipt.source_id;this.client.setDraft('nativeUi',ui);}}
  async recover(file=null){const op=this.client.pendingOperations()[0];if(!op)throw fail('NO_PENDING_OPERATION','没有结果未知的原请求。');const receipt=await this.client.retryOperation(op.id,file);if(op.path==='/api/health-assistant')this.linkChatSource(op.body.question,receipt);if(op.path==='/api/record-turns'){const ui=clone(this.client.getDraft('nativeUi',{})||{});ui.activeSessionId=receipt.record_thread_id;this.client.setDraft('nativeUi',ui);}await this.refresh();if(receipt.run_id){const run=await this.wait(receipt.run_id,{requireRuntime:true,force:true});const outcomes=await Promise.allSettled([run.continuation_run_id,run.continuation_record_run_id].filter(Boolean).map(id=>this.wait(id,{requireRuntime:true})));const stale=outcomes.find(outcome=>outcome.status==='rejected'&&['SESSION_CHANGED','STALE_SCOPE','LOCAL_DRAFT_EXPIRED'].includes(outcome.reason.code));if(stale)throw stale.reason;}if(receipt.continuation_run_id)await this.wait(receipt.continuation_run_id);return receipt;}
  copyText(){const result=this.client.state.results.find(r=>r.id===this.snapshot().cardResultId&&r.kind==='visit_preparation');if(!result)throw fail('NO_CARD','尚无沟通卡。');const current=this.snapshot();return cardText(result,{sources:[...this.sources.values()],run:current.cardRun,localDraft:!result.user_edit&&current.cardEdit?.result_id===result.id?current.cardDraft:null,localQuestions:!result.user_edit&&current.cardEdit?.result_id===result.id?current.questions:null});}
  async requestAgent(path,payload,options={}) {
    let receipt;
    if(path==='/api/health-record')receipt=await this.createEntry(payload.text);
    else if(path==='/api/medical-document')receipt=await this.createDocument(payload instanceof FormData?{file:payload.get('file')}:{text:payload.text,name:payload.name});
    else if(path==='/api/health-assistant'&&payload.retry_source_id){
      await this.refresh();
      const previous=Object.values(this.client.state.runs).filter(run=>run.workflow==='chat'&&run.source_ids?.[0]===payload.retry_source_id).sort((a,b)=>(b.created_at||'').localeCompare(a.created_at||''))[0];
      if(!previous||payload.retry_run_id&&previous.id!==payload.retry_run_id||!eligibleChatRetries(this.client.state.runs).some(run=>run.id===previous.id))throw fail('RUN_NOT_RETRYABLE','对话已更新，请查看最新回复。');
      receipt=await this.client.retryRun(previous.id);
    }
    else if(path==='/api/health-assistant')receipt=await this.client.createChat(payload.question,(payload.messages||[]).filter(m=>m.role==='user').map(m=>m.source_id).filter(Boolean));
    else if(path==='/api/visit-preparations')receipt=await this.client.createVisit(payload.current_concern,payload.selected_record_ids||[]);
    else throw fail('UNSUPPORTED_WORKFLOW','该页面操作尚未接入，请使用记录、就诊准备或病历核对。');
    if(path==='/api/health-assistant')this.linkChatSource(payload.question,receipt);
    options.onRun?.(receipt.run_id);
    const run=await this.wait(receipt.run_id,{...options,...(path==='/api/health-assistant'?{requireRuntime:true,force:true}:{})});
    if(run.result?.kind==='assistant_reply'){
      // Runtime finalization attaches the continuation atomically. A forced read
      // also avoids reusing an earlier staged-result poll cache.
      const children=[run.continuation_run_id,run.continuation_record_run_id].filter(Boolean);
      if(children.length)options.onProgress?.(assistantMessage(run.result.payload,run,Object.values(this.client.state.runs),this.client.state.results));
      await Promise.all(children.map(async id=>{try{await this.wait(id,{...options,requireRuntime:true});}catch(error){if(['SESSION_CHANGED','STALE_SCOPE','LOCAL_DRAFT_EXPIRED'].includes(error.code))throw error;}options.onProgress?.(assistantMessage(run.result.payload,run,Object.values(this.client.state.runs),this.client.state.results));}));
      const message=assistantMessage(run.result.payload,this.client.state.runs[run.id]||run,Object.values(this.client.state.runs),this.client.state.results);
      return {...run.result.payload,answer:message.text,action:message.action,visit_result_id:message.visit_result_id,visit_status:message.visit_status,visit_retry_run_id:message.visit_retry_run_id,record_retry_run_id:message.record_retry_run_id,record_status:message.record_status,record_change_id:message.record_change_id,record_source_id:this.snapshot().records.find(item=>item.id===message.record_source_id||item.source_ids?.includes(message.record_source_id))?.id||message.record_source_id,run_id:run.id,source_id:receipt.source_id,runtime:run.runtime,execution_error:run.execution_error};
    }
    if(run.result)return {...run.result.payload,answer:run.result.payload.speech,action:null,run_id:run.id,source_id:receipt.source_id,runtime:run.runtime,execution_error:run.execution_error};
    const source=await this.client.source(receipt.source_id);
    const proposals=run.change?.proposals||[];
    return {source_id:source.id,run_id:run.id,change_id:run.fact_change_id,original:source.text,description:proposals.map(p=>p.value).join('\n'),date:iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start),onset:iso(proposals.find(p=>p.effective_time?.start)?.effective_time.start),task:proposals.filter(p=>p.field==='instruction').map(p=>p.value).join('\n')||null,proposals};
  }
}

let instance;
export function nativeBridge() {return instance??=new NativeBridge();}
