import {randomUUID,createHash} from 'node:crypto';
import {check,fail} from './domain-errors.mjs';
import {keys} from './source-validation.mjs';
import {reviewable} from './health-profile.mjs';
const id=prefix=>prefix+'_'+randomUUID();
export const RECORD_MISSING_FIELDS=Object.freeze(['症状表现','开始时间','身体部位','频率','持续时间','程度','影响','用药','过敏']);
export const isRecordConfirmation=text=>typeof text==='string'&&/^(确认|确认记录|确认本次记录|确认以上记录)[。！!]?$/u.test(text.trim());

export function acceptRecordTurn(store,uid,input,key,epoch){
  return store.transaction(()=>store.receipt(uid,'accept:record_turn',key,input,()=>{
    keys(input,['text','record_thread_id','expected_version','existing_source_id','record_edit'],[]);
    store.checkExpectedEpoch(uid,epoch);store.requireConsent(uid);
    check(input.record_edit===undefined||input.record_edit===true,'INVALID_INPUT');
    check(!input.record_edit||input.record_thread_id,'INVALID_INPUT');
    let thread=input.record_thread_id?store.get(uid,'record_thread',input.record_thread_id):null;
    if(thread){
      check(input.expected_version===thread.version,'REVISION_CONFLICT',409);

      const previous=thread.latest_run_id&&store.internalRun(thread.latest_run_id);
      check(!previous||!['queued','running'].includes(previous.status),'RUN_BUSY',409);
    }
    check(!input.existing_source_id||!thread,'INVALID_INPUT');
    let source=input.existing_source_id?store.get(uid,'source',input.existing_source_id):null;
    if(source){
      check(source.kind==='self_report','INVALID_INPUT');
      check(!store.all('record_thread',uid).some(t=>t.source_ids.includes(source.id)),'REVISION_CONFLICT',409);
      const primary=store.all('run',uid).filter(r=>r.source_ids[0]===source.id);
      check(primary.some(r=>['visit','entry'].includes(r.workflow)),'INVALID_INPUT');
      check(!store.all('fact_revision',uid).some(f=>f.evidence?.some(e=>e.source_id===source.id)),'RECORD_ALREADY_CONFIRMED',409);
      check(!primary.some(r=>r.workflow==='entry'&&['queued','running'].includes(r.status)),'RUN_BUSY',409);
      // Adopting an old entry into a conversation withdraws its previous candidates atomically.
      for(const previous of primary.filter(r=>r.workflow==='entry')) {
        if(previous.fact_change_id){const old=store.get(uid,'fact_change',previous.fact_change_id);if(old.status==='pending'){old.status='expired';old.terminal_reason='record_updated';store.save('fact_change',old);}}
        previous.status='cancelled';previous.phase='record_updated';previous.scope_epoch++;store.save('run',previous);store.finishDispatch(previous);
      }
    }
    const text=store.text(input.text??source?.text);
    check(!isRecordConfirmation(text),'NO_PENDING_CANDIDATES',409);
    const priorIds=thread?.source_ids||(source&&input.text?[source.id]:[]);
    check(priorIds.length<store.limits.retrievalCount,'PAYLOAD_TOO_LARGE',413);
    check(Buffer.byteLength(text)+priorIds.reduce((n,sid)=>n+Buffer.byteLength(store.get(uid,'source',sid).text),0)<=store.limits.textBytes,'PAYLOAD_TOO_LARGE',413);
    store.checkQueueAdmission(uid);
    if(!source)source=store.insert(uid,'source',{kind:'self_report',text,text_version:1,content_hash:createHash('sha256').update(text).digest('hex'),recorded_at:store.now(),pages:[],input_kind:'self_report'});
    let entry=store.all('entry',uid).find(e=>e.source_id===source.id);
    const originalEntry=entry;
    if(input.existing_source_id&&input.text){source=store.insert(uid,'source',{kind:'self_report',text,text_version:1,content_hash:createHash('sha256').update(text).digest('hex'),recorded_at:store.now(),pages:[],input_kind:'self_report'});entry=null;}
    if(!thread){
      const episodeId=originalEntry?.episode_id||store.insert(uid,'episode',{source_id:source.id,label:null,status:'pending',created_at:store.now()}).id;
      thread=store.insert(uid,'record_thread',{id:id('record_thread'),episode_id:episodeId,source_ids:[],version:0,status:'draft',created_at:store.now(),updated_at:store.now(),latest_run_id:null,latest_change_id:null,latest_summary_id:null});
    }
    if(!entry)entry=store.insert(uid,'entry',{source_id:source.id,input_kind:source.input_kind,received_at:store.now(),raw_time_text:null,episode_id:thread.episode_id});
    if(thread.latest_change_id){
      const old=store.get(uid,'fact_change',thread.latest_change_id);
      if(old.status==='pending'){old.status='expired';old.terminal_reason='record_updated';old.expired_at=store.now();store.save('fact_change',old);const previous=store.internalRun(old.run_id);previous.status='cancelled';previous.phase='record_updated';previous.scope_epoch++;store.save('run',previous);store.finishDispatch(previous);}
    }
    thread.source_ids=[...priorIds,source.id];thread.version++;thread.status='analyzing';thread.updated_at=store.now();thread.latest_summary_id=null;thread.latest_change_id=null;
    const run=store.newRun(uid,'entry',[source.id,...priorIds],{record_thread_id:thread.id,...(input.record_edit?{record_edit:true}:{})});if(input.record_edit)thread.edit_pending=true;thread.latest_run_id=run.id;store.save('record_thread',thread);
    const operation=store.insert(uid,'operation',{kind:'record_turn',status:'committed',record_thread_id:thread.id,source_id:source.id,entry_id:entry.id,run_id:run.id,recorded_at:store.now(),saved:true});
    store.queueRun(run,operation.id);
    return {source_id:source.id,entry_id:entry.id,record_thread_id:thread.id,record_version:thread.version,run_id:run.id,operation_id:operation.id,saved:true};
  }));
}

export function stageRecordSummary(store,run,change,dialogue){
  keys(dialogue,['questions','missing_fields','summary'],['questions','missing_fields']);
  check(dialogue.summary===undefined||(typeof dialogue.summary==='string'&&dialogue.summary.trim().length>0&&dialogue.summary.length<=20000),'INVALID_AGENT_OUTPUT',422);
  check(Array.isArray(dialogue.questions)&&dialogue.questions.length<=3,'INVALID_AGENT_OUTPUT',422);
  const invalidQuestion=dialogue.questions.findIndex(q=>{
    if(typeof q!=='string'||q.length>1000||!/[？?]$/.test(q))return true;
    if(/请服|请用|停药|加量|减量|[0-9一二三四五六七八九十]+\s*(?:mg|ml|毫克|毫升|片|粒)/i.test(q))return true;
    // Symptom frequency/duration is an observation, not a prescribed regimen.
    // Keep numeric action/observation-window recommendations out of this flow.
    const hasQuantity=/[0-9一二三四五六七八九十]+\s*(?:次|天|周)/.test(q);
    const asksSymptoms=/发生|出现|发作|不适|不舒服|疼|痛|腹胀|症状|这种情况|持续|频率|开始/.test(q);
    const proposesAction=/观察|等待|等到|服药|服用|用药|吃药|喝药|建议|应该|就诊|医院|检查|复查|治疗|休息|运动/.test(q);
    return hasQuantity&&(!asksSymptoms||proposesAction);
  });
  if(invalidQuestion!==-1)fail(422,'INVALID_AGENT_OUTPUT','请修改记录追问中的不允许表述。',{
    path:'record_dialogue.questions',question_index:invalidQuestion,
    rule:'Ask neutral questions about the reported symptoms, onset, frequency and duration. Do not propose medication doses, treatment, or numeric waiting/observation windows. Repair only this question; keep valid candidates and exact source evidence unchanged.',
  });
  check(Array.isArray(dialogue.missing_fields)&&dialogue.missing_fields.length<=RECORD_MISSING_FIELDS.length&&new Set(dialogue.missing_fields).size===dialogue.missing_fields.length&&dialogue.missing_fields.every(field=>RECORD_MISSING_FIELDS.includes(field)),'INVALID_AGENT_OUTPUT',422);
  const thread=store.get(run.owner,'record_thread',run.record_thread_id);check(thread.latest_run_id===run.id,'REVISION_CONFLICT',409);
  // The patient's whole-record replacement is authoritative prose. A model
  // synthesis belongs in overview and cannot rewrite the explicit correction.
  if(run.record_edit)dialogue={...dialogue,summary:store.get(run.owner,'source',run.source_ids[0]).text};
  thread.version++;thread.latest_change_id=change.id;thread.status=change.proposals.length?'awaiting_confirmation':'needs_details';thread.updated_at=store.now();
  const summary=store.insert(run.owner,'record_summary',{record_thread_id:thread.id,run_id:run.id,fact_change_id:change.id,version:thread.version,source_ids:[...thread.source_ids],turn_source_id:run.source_ids[0],proposals:structuredClone(change.proposals),...(dialogue.summary?{summary:dialogue.summary}:{}),questions:[...dialogue.questions],missing_fields:[...dialogue.missing_fields],profile_revision:run.base_profile_revision,created_at:store.now()});
  thread.latest_summary_id=summary.id;store.save('record_thread',thread);return summary.id;
}

export function checkRecordConfirmation(store,uid,change,body){
  if(body.record_summary_id===undefined&&body.confirmation_message===undefined)return;
  check(isRecordConfirmation(body.confirmation_message),'CONFIRMATION_REQUIRED',400);
  const summary=store.get(uid,'record_summary',body.record_summary_id),thread=store.get(uid,'record_thread',summary.record_thread_id);
  check(summary.fact_change_id===change.id&&thread.latest_summary_id===summary.id&&thread.latest_change_id===change.id,'REVISION_CONFLICT',409);
  const ids=change.proposals.filter(reviewable).map(p=>p.id);check(ids.length>0&&ids.length===body.accepted_change_ids?.length&&ids.every(id=>body.accepted_change_ids.includes(id)),'REVISION_CONFLICT',409);
}

export function finishRecordConfirmation(store,uid,change,body,outcome){
  const run=change.run_id&&store.internalRun(change.run_id);if(!run?.record_thread_id)return;
  const thread=store.get(uid,'record_thread',run.record_thread_id);check(thread.latest_change_id===change.id,'REVISION_CONFLICT',409);
  const selected=change.accepted_change_ids?.length||0;const remaining=change.status==='pending'&&change.proposals.some(reviewable);thread.status=remaining?(selected?'partially_confirmed':'awaiting_confirmation'):change.status==='confirmed'?'confirmed':'rejected';thread.version++;thread.updated_at=store.now();store.save('record_thread',thread);
  store.insert(uid,'record_confirmation',{record_thread_id:thread.id,record_summary_id:thread.latest_summary_id,source_ids:[...thread.source_ids],message:body.confirmation_message?.trim()||null,accepted_change_ids:[...body.accepted_change_ids],outcome:structuredClone(outcome),created_at:store.now()});
}

export function recordThreads(store,uid){
  store.user(uid);return store.all('record_thread',uid).map(thread=>({...thread,...(thread.edit_pending?{edit_recovery:(()=>{const run=store.internalRun(thread.latest_run_id),source=store.get(uid,'source',run.source_ids[0]);return {state:!run.execution_error&&['queued','running','needs_review'].includes(run.status)?'pending':['failed','blocked','interrupted'].includes(run.status)||run.execution_error?'failed':'stopped',run_id:run.id,retryable:['failed','blocked','interrupted'].includes(run.status)||!!run.execution_error,source_id:source.id,text:source.text,...(run.error?.code||run.execution_error?.code?{error_code:run.error?.code||run.execution_error?.code}:{})};})()}:{}),summaries:store.all('record_summary',uid).filter(s=>s.record_thread_id===thread.id).sort((a,b)=>a.created_at.localeCompare(b.created_at)),confirmations:store.all('record_confirmation',uid).filter(c=>c.record_thread_id===thread.id).sort((a,b)=>a.created_at.localeCompare(b.created_at))}));
}

export function checkRecordRetry(store,uid,previous){
  if(!previous.record_thread_id)return null;
  const thread=store.get(uid,'record_thread',previous.record_thread_id);
  check(thread.latest_run_id===previous.id&&!['confirmed','partially_confirmed'].includes(thread.status),'REVISION_CONFLICT',409);
  return thread;
}
export function updateRecordRetry(store,thread,run){
  if(!thread)return;
  thread.version++;thread.status='analyzing';thread.latest_run_id=run.id;thread.latest_change_id=null;thread.latest_summary_id=null;thread.updated_at=store.now();store.save('record_thread',thread);
}
