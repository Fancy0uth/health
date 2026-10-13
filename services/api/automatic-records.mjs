import {check,fail} from './domain-errors.mjs';
import {keys,validateCandidate,validateEvidence,literalSourceTime,materializeSentenceCandidate} from './source-validation.mjs';
import {attachComparisons,reviewable,candidateContent,validateObservations} from './health-profile.mjs';
export const BODY_REGIONS=Object.freeze(['head_neck','chest','abdomen','back','limbs','systemic','other']);
export function validateOverview(input,sourceIds){
 const valid=(ok,path,rule)=>{if(!ok)fail(422,'INVALID_AGENT_OUTPUT','请按身体部位整理概览。',{path,rule});};
 keys(input,['summary','regions']);
 const text=v=>typeof v==='string'&&v.trim().length>0&&v.length<=20000;
 valid(text(input.summary),'overview.summary','Provide a nonempty summary within 20000 characters.');
 valid(Array.isArray(input.regions)&&input.regions.length<=7,'overview.regions','Use at most seven body-region cards, each body ID only once.');
 const seen=new Set();
 input.regions.forEach((r,i)=>{const path=`overview.regions[${i}]`;keys(r,['id','label','summary','status','source_ids']);
  valid(BODY_REGIONS.includes(r.id),path+'.id','Use a declared body region ID.');
  valid(!seen.has(r.id),path+'.id','Use each body region ID only once. Combine all supported details for that region into one summary/card, preserving their distinct qualifiers and source IDs. Choose a supported overall status; do not infer that an entire region is resolved from one absent symptom.');
  valid(text(r.label),path+'.label','Provide a nonempty label within 20000 characters.');valid(text(r.summary),path+'.summary','Provide a nonempty summary within 20000 characters.');
  valid(['reported','documented','improving','resolved','uncertain'].includes(r.status),path+'.status','Use reported, documented, improving, resolved or uncertain.');
  valid(Array.isArray(r.source_ids)&&r.source_ids.length>0&&r.source_ids.every(s=>sourceIds.includes(s)),path+'.source_ids','Cite only source IDs actually returned and authorized in this run.');seen.add(r.id);
 });
 return structuredClone(input);
}
export function queueOverviewRefresh(store,uid,change,operationId){
 const original=change.run_id&&store.internalRun(change.run_id);
 const automatic=original?.result_id&&store.get(uid,'result',original.result_id).payload?.automatic_record;
 if(!original?.automatic_finalized||!(change.overview||automatic?.overview))return null;
 for(const old of store.all('run',uid).filter(r=>r.overview_refresh&&!r.automatic_finalized)){
  old.status='cancelled';old.phase='overview_superseded';old.scope_epoch++;store.save('run',old);store.finishDispatch(old);store.expireCheckpoints(uid,'overview_superseded',old.id);
 }
 const sources=[...new Set([...change.source_ids,...store.profile(uid).facts.flatMap(f=>f.evidence.map(e=>e.source_id)),...store.all('health_overview',uid).at(-1)?.source_ids||[]])];
 for(const sid of sources)store.get(uid,'source',sid);
 const run=store.newRun(uid,'entry',sources,{overview_refresh:true,overview_change_id:change.id,parent_run_id:original.id});store.queueRun(run,operationId);return run.id;
}
export function normalizeOptionalObservations(observations,quote){
 const safe=[];
 for(const inputObservation of observations){
  const o=structuredClone(inputObservation);
  for(const field of ['unit','observed_at'])if(typeof o?.[field]==='string'&&!quote.includes(o[field]))delete o[field];
  try{validateObservations([o],quote);safe.push(o);}catch(error){if(error.code!=='INVALID_AGENT_OUTPUT')throw error;}
 }
 return safe;
}
export function validateAutomaticRecord(store,run,input,read){
 keys(input,['action','reason','summary','candidates','record_source_refs','comparisons','overview'],['action']);
 check(['save','skip'].includes(input.action),'INVALID_AGENT_OUTPUT',422);
 const compact=Object.hasOwn(input,'record_source_refs');
 check(!compact||!Object.hasOwn(input,'candidates'),'INVALID_AGENT_OUTPUT',422);
 if(input.action==='skip'){check(typeof input.reason==='string'&&input.reason.trim().length>0&&!input.candidates?.length&&!input.record_source_refs?.length&&!input.overview,'INVALID_AGENT_OUTPUT',422);return structuredClone(input);}
 const selected=compact?input.record_source_refs:input.candidates;
 check(input.overview&&typeof input.summary==='string'&&input.summary.trim().length>0&&input.summary.length<=20000&&Array.isArray(selected)&&selected.length<=100,'INVALID_AGENT_OUTPUT',422);
 const proposals=[],indexes=new Map();
 const authorized=sid=>{check(run.read_sources?.includes(sid),'INVALID_AGENT_OUTPUT',422);return read(run,sid);};
 const seenRefs=new Set();
 const candidates=compact?selected.map((ref,index)=>{
  const candidate=materializeSentenceCandidate(ref,authorized,`payload.automatic_record.record_source_refs[${index}]`);
  const key=JSON.stringify([ref.source_id,ref.sentence_index]);check(!seenRefs.has(key),'INVALID_AGENT_OUTPUT',422);seenRefs.add(key);return candidate;
 }):selected;
 candidates.forEach((original,index)=>{
  for(const field of ['fact_id','expected_version','episode_id'])if(Object.hasOwn(original,field))fail(422,'INVALID_AGENT_OUTPUT','新增记录标识由服务端分配。',{path:`payload.automatic_record.candidates[${index}].${field}`,rule:'Omit fact_id, expected_version and episode_id entirely, including null placeholders. The server assigns identities and revisions. Keep valid source evidence, summary and overview unchanged; existing facts belong only in comparisons.'});
  if(original.proposal_kind!=='new')fail(422,'INVALID_AGENT_OUTPUT','本轮只提交新增来源候选。',{path:`payload.automatic_record.candidates[${index}].proposal_kind`,rule:'Use proposal_kind=new. Refer to a current retrieved old fact only through comparisons; never invent IDs or revisions.'});
  // Evidence/ownership errors remain fatal. Optional extraction is normalized
  // only against successfully verified immutable source text.
  const refs=validateEvidence(original.evidence,authorized);
  const candidate=structuredClone(original),quote=refs[0].evidence.quote;
  const patientText=refs.every(r=>r.source.kind==='self_report')&&['reported_text','symptom','observation'].includes(candidate.field);
  if(patientText){
   // A rewritten clinical claim is never persisted: use the actual source
   // sentence as reported_text. The narrative synthesis is separate.
   if(!refs.every(r=>r.evidence.quote===quote))return;
   candidate.field='reported_text';candidate.value=quote;
   candidate.effective_time=literalSourceTime(quote,refs[0].source.id);
  }
  if(candidate.health_observations)candidate.health_observations=normalizeOptionalObservations(candidate.health_observations,quote);
  const validated=validateCandidate(candidate,authorized,{semantic:patientText});
  const duplicate=proposals.find(p=>JSON.stringify(p.evidence)===JSON.stringify(validated.evidence)&&p.value===validated.value);
  if(duplicate){
   indexes.set(index,duplicate.candidate_index);
   duplicate.health_observations=[...new Map([...(duplicate.health_observations||[]),...(validated.health_observations||[])].map(o=>[JSON.stringify(o),o])).values()];return;
  }
  indexes.set(index,index);proposals.push({...validated,id:'automatic_'+run.id+'_'+index,candidate_index:index});
 });
 const comparisons=(input.comparisons||[]).filter(c=>indexes.has(c.candidate_index)).map(c=>({...c,candidate_index:indexes.get(c.candidate_index)})).filter((c,i,a)=>a.findIndex(x=>x.candidate_index===c.candidate_index&&x.fact_id===c.fact_id)===i);
 attachComparisons(store,run,proposals,comparisons,{legacyFallback:false});
 return {...structuredClone(input),comparisons,proposals,...(input.overview?{overview:validateOverview(input.overview,run.read_sources||[])}:{})};
}
export function finalizeAutomaticRecords(store,run){
 if(run.automatic_finalized)return;
 const result=run.result_id&&store.get(run.owner,'result',run.result_id);
 const automatic=result?.payload?.automatic_record;
 const staged=run.fact_change_id&&store.get(run.owner,'fact_change',run.fact_change_id);
 if(run.overview_refresh){
  check(staged?.overview&&staged.proposals.length===0,'INVALID_AGENT_OUTPUT',422);
  check(store.all('run',run.owner).filter(r=>r.overview_refresh).at(-1)?.id===run.id,'REVISION_CONFLICT',409);
  check(run.base_profile_revision===store.user(run.owner).revision,'REVISION_CONFLICT',409);
  const now=store.now(),sources=[...new Set([...run.source_ids,...run.read_sources||[]])];for(const sid of sources)store.get(run.owner,'source',sid);
  store.insert(run.owner,'health_overview',{...staged.overview,regions:staged.overview.regions.map(r=>({...r,updated_at:now})),updated_at:now,profile_revision:store.user(run.owner).revision,run_id:run.id,source_ids:sources,status:store.all('fact_change',run.owner).some(c=>c.id!==staged.id&&c.status==='pending'&&c.proposals.some(reviewable))?'uncertain':'current'});
  staged.status='confirmed';staged.review_state='complete';store.save('fact_change',staged);run.status='completed';run.phase='overview_updated';run.automatic_finalized=true;return;
 }
 if((run.record_edit||run.legacy_record_adoption)&&!staged?.overview&&!automatic?.overview)fail(422,'INVALID_AGENT_OUTPUT','自动记录尚缺身体概述，不能完成保存。',{path:'overview',rule:'Provide overview with summary and regions before completing this automatic record. Retry or explicitly reanalyse the saved source; keep the original and existing facts unchanged.'});
 if(!automatic&&!staged?.overview)return;
 // A verified checkpoint must still match the profile it synthesized.
 check(run.base_profile_revision===store.user(run.owner).revision,'REVISION_CONFLICT',409);
 if(automatic?.action==='skip'){run.automatic_finalized=true;run.record_save_status='skipped';return;}
 const uid=run.owner,now=store.now(),storedOverview=store.all('health_overview',run.owner).at(-1);
 // Public masking while an edit is pending does not invalidate independently
 // sourced regions. Internally retain only a still-current stored synthesis.
 const previousOverview=run.record_edit&&storedOverview?.profile_revision===store.user(uid).revision?storedOverview:currentOverview(store,run.owner);
 let thread=run.record_thread_id&&store.get(uid,'record_thread',run.record_thread_id);
 if(!thread&&run.conversation_id)thread=store.all('record_thread',uid).find(t=>t.conversation_id===run.conversation_id);
 if(!thread&&automatic){const episode=store.insert(uid,'episode',{source_id:run.source_ids[0],label:automatic.summary,status:'active',created_at:now});thread=store.insert(uid,'record_thread',{conversation_id:run.conversation_id,episode_id:episode.id,source_ids:[],version:0,status:'saved',created_at:now,updated_at:now});}
 if(thread){run.record_thread_id=thread.id;thread.source_ids=[...new Set([...thread.source_ids,run.source_ids[0]])];thread.version++;thread.updated_at=now;thread.summary=automatic?.summary||store.all('record_summary',uid).find(s=>s.id===thread.latest_summary_id)?.summary||thread.summary;
 if(!store.all('entry',uid).some(e=>e.source_id===run.source_ids[0]))store.insert(uid,'entry',{source_id:run.source_ids[0],input_kind:'self_report',received_at:now,raw_time_text:null,episode_id:thread.episode_id});}
 const change=staged||store.insert(uid,'fact_change',{run_id:run.id,source_ids:run.source_ids,base_profile_revision:run.base_profile_revision,epoch:run.epoch,consent_version:run.consent_version,status:'pending',kind:'new',proposals:automatic.proposals,created_at:now});
 if(run.record_edit&&thread){
  for(const fact of store.profile(uid).facts.filter(f=>f.episode_id===thread.episode_id))store.insert(uid,'fact_revision',{...fact,id:undefined,revision:fact.revision+1,supersedes_revision:fact.revision,review_status:'retracted',retraction_reason:'whole_record_edit',recorded_at:now});
  for(const p of change.proposals)p.comparisons=(p.comparisons||[]).filter(c=>c.old_snapshot?.episode_id!==thread.episode_id);
  thread.edit_pending=false;
 }
 // Refresh comparisons inside this transaction: no stale automatic writes.
 if(!staged)attachComparisons(store,run,change.proposals,automatic.comparisons||[],{legacyFallback:false});
 let writes=run.record_edit?1:0;
 for(const p of change.proposals.filter(reviewable)){
  if(p.comparisons?.some(c=>c.requires_resolution&&!(c.origin==='model'&&c.relation==='update'&&!c.possible_conflict)))continue;
  const update=p.comparisons?.find(c=>c.origin==='model'&&c.relation==='update');
  const duplicate=p.comparisons?.find(c=>c.relation==='duplicate');
  if(duplicate){p.proposal_status='kept_existing';continue;}
  const clean=candidateContent(p),source=store.get(uid,'source',clean.evidence[0].source_id);
  const factId=update?.fact_id||'fact_auto_'+run.id+'_'+p.candidate_index;
  store.insert(uid,'fact_revision',{...clean,episode_id:thread?.episode_id||store.all('entry',uid).find(e=>e.source_id===source.id)?.episode_id||null,fact_id:factId,revision:(update?.revision||0)+1,supersedes_revision:update?.revision||null,review_status:source.kind==='self_report'?'patient_report':'document_report',verification_status:source.kind==='self_report'?'patient_report':'document_report',provenance:{kind:source.kind==='self_report'?'patient_report':'document_report',automatic:true,patient_confirmed:false,run_id:run.id},confirmed_at:null,recorded_at:now,change_id:change.id});
  p.proposal_status='confirmed';p.confirmed_fact_id=factId;p.confirmed_revision=(update?.revision||0)+1;writes++;
 }
 if(writes){store.db.prepare('UPDATE users SET revision=revision+1 WHERE id=?').run(uid);store.invalidateProfileDependents(uid);}
 const pending=change.proposals.filter(reviewable);change.status=pending.length?'pending':'confirmed';change.review_state=pending.length?'exceptions':'complete';change.conflicts=pending.flatMap(p=>(p.comparisons||[]).filter(c=>c.requires_resolution));change.accepted_change_ids=change.proposals.filter(p=>p.proposal_status==='confirmed').map(p=>p.id);store.save('fact_change',change);
 run.fact_change_id=change.id;run.status=pending.length?'needs_review':'completed';run.phase=pending.length?'exceptions':'saved';run.record_save_status=pending.length?'saved_with_exceptions':'saved';run.automatic_finalized=true;
 if(thread&&automatic){const summary=store.insert(uid,'record_summary',{record_thread_id:thread.id,run_id:run.id,fact_change_id:change.id,version:thread.version,source_ids:[...thread.source_ids],turn_source_id:run.source_ids[0],summary:automatic.summary,proposals:structuredClone(change.proposals),questions:[],missing_fields:[],profile_revision:store.user(uid).revision,created_at:now,provenance:'patient_report',automatic:true});thread.latest_summary_id=summary.id;}
 if(thread){thread.status=run.record_save_status;thread.latest_run_id=run.id;thread.latest_change_id=change.id;store.save('record_thread',thread);}
 const proposedOverview=automatic?.overview||change.overview;
 const overview=proposedOverview&&{...proposedOverview,regions:[...proposedOverview.regions,...(['current','uncertain'].includes(previousOverview.status)?previousOverview.regions.filter(old=>!proposedOverview.regions.some(next=>next.id===old.id)&&!(run.record_edit&&old.source_ids.every(sid=>thread?.source_ids.includes(sid)))):[])]};
 if(change.document_id&&!run.continuation_run_id){const doc=store.get(uid,'document',change.document_id);const careSource=store.documentSource(uid,doc.id);const care=store.newRun(uid,'care_plan',[careSource,...run.source_ids.filter(s=>s!==careSource)],{document_id:doc.id,parent_run_id:run.id});store.queueRun(care,run.operation_id);run.continuation_run_id=care.id;}
 const overviewSources=overview&&[...new Set([...run.source_ids,...(run.read_sources||[]),...overview.regions.flatMap(r=>r.source_ids),...store.all('fact_revision',uid).filter(f=>run.read_facts?.some(ref=>ref.fact_id===f.fact_id&&ref.revision===f.revision)).flatMap(f=>f.evidence.map(e=>e.source_id))])];
 if(overviewSources)for(const sid of overviewSources)store.get(uid,'source',sid);
 if(overview)store.insert(uid,'health_overview',{...overview,regions:overview.regions.map(r=>({...r,updated_at:r.updated_at||now})),updated_at:now,profile_revision:store.user(uid).revision,run_id:run.id,source_ids:overviewSources,status:pending.length?'uncertain':'current'});
}
export function currentOverview(store,uid){
 const latest=store.all('health_overview',uid).at(-1),base=latest||{summary:'',updated_at:null,regions:[],status:'not_recorded'};
 const edits=store.all('record_thread',uid).filter(t=>t.edit_pending).map(t=>store.internalRun(t.latest_run_id));
 const refresh=store.all('run',uid).filter(r=>r.overview_refresh).at(-1);
 const pendingRefresh=refresh&&!refresh.automatic_finalized&&(!latest||refresh.created_at>=latest.updated_at)?refresh:null;
 const activeRun=[...edits,...(pendingRefresh?[pendingRefresh]:[])].at(-1);
 const stale=!!activeRun||!!latest&&latest.profile_revision!==store.user(uid).revision;
 if(!stale)return base;
 const pending=activeRun&&!activeRun.execution_error&&['queued','running','needs_review'].includes(activeRun.status);
 const retryable=!!(activeRun&&(['failed','blocked','interrupted'].includes(activeRun.status)||!!activeRun.execution_error||(activeRun.overview_refresh&&activeRun.status==='cancelled')));
 return {...base,status:'stale',regions:[],refresh_state:pending?'pending':activeRun?'failed':'unavailable',...(activeRun?{refresh_run_id:activeRun.id}:{}),refresh_retryable:retryable};
}
