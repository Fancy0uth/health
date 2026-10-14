import {fail} from './domain-errors.mjs';
export const BODY_REGIONS=Object.freeze(['head_neck','chest','abdomen','back','limbs','systemic','other']);
export const HEALTH_DIMENSIONS=Object.freeze(['body_site_symptom','time_course','self_rating','impact_context','associated','measurements','background_care','evidence_status']);
const invalid=(path,rule,details={})=>fail(422,'INVALID_AGENT_OUTPUT','身体状态文档格式或依据不完整。',{path,rule,...details});
function object(value,allowed,path){
 if(!value||typeof value!=='object'||Array.isArray(value))invalid(path,'Provide a native JSON object, never a JSON string. Preserve valid evidence and all supported problems; do not invent facts.');
 for(const key of Object.keys(value))if(!allowed.includes(key))invalid(`${path}.${key}`,'Omit this undeclared property; preserve the supported document content.');
 for(const key of allowed)if(!Object.hasOwn(value,key))invalid(`${path}.${key}`,'Provide this required property. Use null only for an unknown dimension; never infer normality.');
}
function text(value,max,path){if(typeof value!=='string'||!value.trim()||value.length>max)invalid(path,`Provide nonempty supported text within ${max} characters; preserve dates, units, attribution and uncertainty.`);}
function refs(value,allowed,path){if(!Array.isArray(value)||!value.length||value.some(s=>typeof s!=='string'||!allowed.includes(s)))invalid(path,'Cite nonempty original source IDs actually read in this run, authorized for this owner and not superseded by a whole-record correction. For missing retained evidence, call healththread_retrieve_context with source_ids copied from the previous v2 document problem/background/uncertainty, at most 100 per call, then stage again. Only current authorized original evidence can be fetched; never substitute IDs, invent sources, or cite the model document itself.');}
export function validateHealthState(input,sourceIds,{previous=null,path='overview'}={}){
 object(input,['format_version','summary','problems','background','uncertainties'],path);
 if(input.format_version!==2)invalid(`${path}.format_version`,'Use format_version=2 for the maintained Chapter 4 document.');
 text(input.summary,1200,`${path}.summary`);
 if(!Array.isArray(input.problems)||input.problems.length>30)invalid(`${path}.problems`,'Provide at most 30 supported problem events.');
 const seen=new Set();
 input.problems.forEach((p,i)=>{const at=`${path}.problems[${i}]`;object(p,['key','title','body_region','status','assessment','dimensions','source_ids'],at);text(p.key,80,`${at}.key`);text(p.title,Infinity,`${at}.title`);
  if(seen.has(p.key))invalid(`${at}.key`,'Each problem key must be unique; reuse the previous key for the same event.');seen.add(p.key);
  if(!BODY_REGIONS.includes(p.body_region))invalid(`${at}.body_region`,'Use one of the seven declared body region IDs.');
  if(!['active','improving','resolved','uncertain'].includes(p.status))invalid(`${at}.status`,'Use active, improving, resolved or uncertain; status is follow-up state, never a severity or health score.');
  text(p.assessment,600,`${at}.assessment`);object(p.dimensions,HEALTH_DIMENSIONS,`${at}.dimensions`);
  for(const key of HEALTH_DIMENSIONS)if(p.dimensions[key]!==null)text(p.dimensions[key],800,`${at}.dimensions.${key}`);
  refs(p.source_ids,sourceIds,`${at}.source_ids`);
 });
 for(const section of ['background','uncertainties']){const at=`${path}.${section}`;if(!Array.isArray(input[section])||input[section].length>30)invalid(at,'Provide at most 30 supported entries.');input[section].forEach((item,i)=>{object(item,['summary','source_ids'],`${at}[${i}]`);text(item.summary,800,`${at}[${i}].summary`);refs(item.source_ids,sourceIds,`${at}[${i}].source_ids`);});}
 const missingKeys=(previous?.format_version===2?previous.problems:[]).filter(p=>['active','improving','uncertain'].includes(p.status)&&p.source_ids.some(s=>sourceIds.includes(s))&&!seen.has(p.key)).map(p=>p.key);
 if(missingKeys.length)invalid(`${path}.problems`,'Retain every previously followed problem with a still-valid source using its same key. Return a complete document; omission or labeling another problem resolved cannot retire it. Only truly superseded/deleted evidence permits removal.',{missing_problem_keys:missingKeys});
 input.problems.forEach((problem,index)=>{
  const prior=(previous?.format_version===2?previous.problems:[]).find(p=>p.key===problem.key&&['active','improving','uncertain'].includes(p.status));
  const retained=(prior?.source_ids||[]).filter(id=>sourceIds.includes(id));
  if(!retained.length)return;
  const missing=retained.filter(id=>!problem.source_ids.includes(id)),at=`${path}.problems[${index}]`;
  // Dimension citations belong to the whole problem. Once any old source is
  // removed, a prior value may have lost its sole evidence and can become null.
  const unknown=problem.status!=='resolved'&&retained.length===prior.source_ids.length?HEALTH_DIMENSIONS.filter(d=>typeof prior.dimensions?.[d]==='string'&&prior.dimensions[d].trim()&&problem.dimensions[d]===null):[];
  if(missing.length)invalid(`${at}.source_ids`,'Keep every still-valid original source for this existing problem, and add new supporting sources. A new medical document or follow-up supplements the prior evidence; retaining its key alone is not enough. Read missing authorized sources with healththread_retrieve_context, then regenerate the complete assessment and dimensions from both old and new evidence.',{missing_source_ids:missing,...(unknown.length?{missing_dimensions:unknown}:{})});
  if(unknown.length)invalid(`${at}.dimensions.${unknown[0]}`,'This ongoing problem already has supported information in these dimensions. Re-read its retained original evidence and combine it with the new material, preserving actual dates and attribution. A new source omitting the information does not make it unknown; do not copy unsupported values or infer normality.',{missing_dimensions:unknown});
 });
 return structuredClone(input);
}
export function supersededHealthSources(store,run){
 const threads=store.all('record_thread',run.owner),ids=new Set(threads.flatMap(t=>t.superseded_source_ids||[]));
 for(const t of threads.filter(t=>t.edit_pending&&t.latest_run_id)){const edit=store.internalRun(t.latest_run_id);if(edit.record_edit)for(const id of t.source_ids)if(id!==edit.source_ids[0])ids.add(id);}
 if(run.record_edit&&run.record_thread_id){const t=store.get(run.owner,'record_thread',run.record_thread_id);for(const id of t.source_ids)if(id!==run.source_ids[0])ids.add(id);}
 // Aggregates retain original ancestry even when their generated IDs are absent
 // from the edited record. Never let a derived concern revive replaced text.
 const sources=store.all('source',run.owner);let changed=true;
 while(changed){changed=false;for(const source of sources)if(!ids.has(source.id)&&source.derived_source_ids?.some(id=>ids.has(id))){ids.add(source.id);changed=true;}}
 return ids;
}
// Explicit context expansion is limited to the captured document's actual evidence.
// Snapshot-wide read history alone never grants permission to discover an ID.
export function currentDocumentEvidence(store,run){
 const snapshot=store.all('health_overview',run.owner).at(-1);
 if(!snapshot||snapshot.id!==run.base_health_document_id||snapshot.format_version!==2||!['current','uncertain'].includes(snapshot.status))return new Set();
 const excluded=supersededHealthSources(store,run),sources=new Map(store.all('source',run.owner).map(source=>[source.id,source]));
 const refs=[...snapshot.problems,...snapshot.background,...snapshot.uncertainties].flatMap(item=>item.source_ids);
 return new Set(refs.filter(id=>{const source=sources.get(id),version=snapshot.source_versions?.find(v=>v.source_id===id);return source&&!excluded.has(id)&&snapshot.source_ids?.includes(id)&&version&&version.source_text_version===source.text_version&&['self_report','medical_document'].includes(source.kind)&&typeof source.text==='string'&&!!source.text.trim();}));
}
export function healthStateValidationContext(store,run,path='overview'){
 const excluded=supersededHealthSources(store,run),sourceIds=(run.read_sources||[]).filter(id=>!excluded.has(id));
 for(const id of sourceIds)store.get(run.owner,'source',id);
 const previous=store.all('health_overview',run.owner).at(-1);
 // Retention depends on valid owned evidence, not just what the model chose to read.
 const validIds=(previous?.source_ids||[]).filter(id=>!excluded.has(id)&&store.all('source',run.owner).some(s=>s.id===id));
 return {sourceIds,retentionSourceIds:validIds,options:{path,previous:previous?.format_version===2?{...previous,problems:previous.problems.filter(p=>p.source_ids.some(id=>validIds.includes(id)))}:previous}};
}
export function validateRunHealthState(store,run,input,path='overview'){
 const {sourceIds,retentionSourceIds,options}=healthStateValidationContext(store,run,path);
 if(run.overview_refresh&&input?.format_version===2){const unread=run.source_ids.findIndex(id=>!sourceIds.includes(id));if(unread>=0)invalid(path,`Read all selected refresh sources before staging: call healththread_retrieve_context with source_offset=${Math.floor(unread/store.limits.retrievalCount)*store.limits.retrievalCount}, then follow source_page.next_offset until null and resubmit the complete overview.`);}
 // Unread old evidence does not license dropping an active problem.
 if(input&&typeof input==='object'&&Object.hasOwn(input,'format_version')){validateHealthState(input,[...new Set([...sourceIds,...retentionSourceIds])],options);return validateHealthState(input,sourceIds,{path});}
 return null;
}
export function healthSnapshot(store,run,overview,status){
 const previous=store.all('health_overview',run.owner).at(-1),excluded=supersededHealthSources(store,run),now=store.now();
 const sourceIds=[...new Set([...(run.read_sources||[]),...(overview.format_version===2?[...overview.problems,...overview.background,...overview.uncertainties].flatMap(p=>p.source_ids):overview.regions.flatMap(p=>p.source_ids))])].filter(id=>!excluded.has(id));
 for(const id of sourceIds)store.get(run.owner,'source',id);
 return {...overview,...(overview.format_version===2?{document_version:(previous?.document_version||0)+1,framework:'Project Framework v0.2 Chapter 4',previous_document_id:previous?.id||null}:{regions:overview.regions.map(r=>({...r,updated_at:r.updated_at||now}))}),updated_at:now,profile_revision:store.user(run.owner).revision,run_id:run.id,source_ids:sourceIds,source_versions:sourceIds.map(id=>({source_id:id,source_text_version:store.get(run.owner,'source',id).text_version})),base_profile_revision:run.base_profile_revision,consent_version:run.consent_version,scope_epoch:run.scope_epoch,runtime:structuredClone(run.runtime||null),tool_receipt_ids:[...(run.tool_receipts||[])],status};
}
