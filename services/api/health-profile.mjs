import {check,fail} from './domain-errors.mjs';
import {keys,classifySourceMarkers,definiteDrugAllergyDisagreement} from './source-validation.mjs';
export const HEALTH_DIMENSIONS=Object.freeze(['body_site','symptom','onset','course','self_rating','impact','context','associated','measurement','background']);
const invalid=(condition,path,rule)=>{if(!condition)fail(422,'INVALID_AGENT_OUTPUT','健康信息须保留原文支持。',{path,rule});};
const observationAssertion=(value,quote)=>{const clause=quote.split(/[，,。！？!?；;\n]/).find(clause=>clause.includes(value));return classifySourceMarkers(clause||quote).assertion;};
export function validateObservations(observations,quote,path='candidate.health_observations'){
  invalid(Array.isArray(observations)&&observations.length<=50,path,'Use at most 50 supported observations.');
  observations.forEach((o,i)=>{
    const base=`${path}[${i}]`;
    invalid(o&&typeof o==='object'&&!Array.isArray(o),base,'Use an observation object.');
    invalid(Object.keys(o).every(k=>['dimension','value','unit','observed_at'].includes(k)),base,'Only dimension, value, unit and observed_at are allowed.');
    invalid(HEALTH_DIMENSIONS.includes(o.dimension),`${base}.dimension`,'Use a supported health dimension.');
    invalid(typeof o.value==='string'&&o.value.trim().length>0&&o.value.length<=2000&&quote.includes(o.value),`${base}.value`,'Copy an exact nonempty snippet from this patient sentence; never invent a score or measurement.');
    const positions=[...quote.matchAll(new RegExp(o.value.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))].map(m=>m.index);
    invalid(!/[0-9]/.test(o.value)||positions.some(pos=>(!/[0-9.,]/.test(o.value[0])||!/[0-9.,+-]/.test(quote[pos-1]||''))&&(!/[0-9.,]/.test(o.value.at(-1))||!/[0-9.,]/.test(quote[pos+o.value.length]||''))),`${base}.value`,'Preserve complete numeric tokens; do not extract a smaller score from a larger number.');
    if(['symptom','associated','background'].includes(o.dimension))invalid(classifySourceMarkers(o.value).assertion===observationAssertion(o.value,quote),`${base}.value`,'Retain negation and uncertainty in the snippet, such as 没有恶心 rather than 恶心.');
    for(const [field,limit]of [['unit',100],['observed_at',200]])invalid(o[field]===undefined||o[field]===null||(typeof o[field]==='string'&&o[field].trim().length>0&&o[field].length<=limit&&quote.includes(o[field])),`${base}.${field}`,'Copy a literal unit/time snippet from the same sentence, or use null. Never infer dates or units.');
    if(typeof o.unit==='string'&&/[A-Za-z]/.test(o.unit)){const units=[...quote.matchAll(new RegExp(o.unit.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'g'))];invalid(units.some(m=>!/[A-Za-z]/.test(quote[m.index-1]||'')&&!/[A-Za-z]/.test(quote[m.index+o.unit.length]||'')),`${base}.unit`,'Preserve the complete source unit; never extract g from mg.');}
  });
}
// A reviewed manual correction gets only metadata grounded in its new text.
// Reusing an old number by substring could pick up a date or another quantity.
export function correctionObservations(previous,text){
  const observations=[];
  const add=observation=>{
    if(observations.length>=50)return;
    try{validateObservations([observation],text);}catch(error){if(error.code==='INVALID_AGENT_OUTPUT')return;throw error;}
    if(!observations.some(o=>JSON.stringify(o)===JSON.stringify(observation)))observations.push(observation);
  };
  for(const old of previous.health_observations||[]){
    if(old.dimension==='self_rating'||!text.includes(old.value))continue;
    if(/^[+-]?[0-9]+(?:[.,][0-9]+)?$/.test(old.value)&&text!==previous.value)continue;
    const observation=structuredClone(old);
    for(const field of ['unit','observed_at'])if(typeof observation[field]==='string'&&!text.includes(observation[field]))delete observation[field];
    add(observation);
  }
  const number=String.raw`(?:[+-]?[0-9]+(?:\.[0-9]+)?|[一二三四五六七八九十两]+)`;
  const label=String.raw`(?:自评(?:分数|程度)?|(?:疼痛|痛感|症状|不适)(?:自评|评分|程度)?)`;
  const rating=new RegExp(`${label}\\s*(?:更正为|改为|为|是|：|:)?\\s*${number}\\s*分`);
  const priorRating=(previous.health_observations||[]).some(o=>o.dimension==='self_rating');
  const degree=new RegExp(`程度\\s*(?:为|是|：|:)?\\s*${number}\\s*分`);
  for(const clause of text.split(/[，,。！？!?；;\n]/))if(rating.test(clause)||(priorRating&&degree.test(clause))){
    const value=clause.trim();
    if(value&&value.length<=2000)add({dimension:'self_rating',value,unit:'分'});
  }
  return observations;
}
export const reviewable=p=>!p.proposal_status||['pending','deferred'].includes(p.proposal_status);
export function candidateContent(proposal){const out={...proposal};for(const key of ['id','candidate_index','comparisons','proposal_status','resolutions','confirmed_fact_id','confirmed_revision'])delete out[key];return out;}
function sameComparableTopic(a,b){
  const dates=v=>v.value.match(/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/g)||[];
  const ad=dates(a),bd=dates(b);if(ad.length&&bd.length&&!ad.some(d=>bd.includes(d)))return false;
  const aa=a.health_observations||[],ba=b.health_observations||[];
  const symptoms=aa.filter(o=>['symptom','background','measurement'].includes(o.dimension));
  if(symptoms.some(o=>ba.some(old=>old.dimension===o.dimension&&old.value===o.value)))return true;
  // Finite literal normalization detects the same statement with changed polarity
  // or quantities. It never merges different symptom events by a shared field.
  const topic=v=>v.value.toLowerCase().replace(/\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日/g,'').replace(/没有|否认|未见|无|不再|可能|疑似|不确定|目前|现在|今日|今天|当前|既往|曾经|以前|过去|\b(?:no|denies|without|currently|today|possible|suspected)\b/g,'').replace(/[0-9]+(?:[.,][0-9]+)?|[，。！？；：、\s.,!?;:%]/g,'');
  const ak=topic(a),bk=topic(b);
  return ak===bk&&ak.length>=2&&!/^(?:程度|评分|疼痛评分|自评|分|级|度|左右|天|周|月|次)+$/.test(ak);
}
export function attachComparisons(store,run,proposals,inputs=[],{legacyFallback=true}={}){
  invalid(Array.isArray(inputs)&&inputs.length<=100,'comparisons','Use at most 100 comparisons.');
  const facts=store.profile(run.owner).facts;
  const add=(p,f,relation,reason,origin)=>{
    const existing=p.comparisons.find(c=>c.fact_id===f.fact_id);
    if(existing){if(origin==='server'&&relation==='conflict'){existing.requires_resolution=true;existing.possible_conflict=true;}return;}
    p.comparisons.push({candidate_id:p.id,fact_id:f.fact_id,revision:f.revision,relation,reason,origin,requires_resolution:['conflict','update'].includes(relation),old_snapshot:structuredClone(f),new_snapshot:structuredClone(candidateContent(p))});
  };
  for(const p of proposals){p.comparisons=[];p.proposal_status='pending';}
  inputs.forEach((input,i)=>{
    keys(input,['candidate_index','fact_id','revision','relation','reason']);
    const p=proposals.find(p=>p.candidate_index===input.candidate_index),f=facts.find(f=>f.fact_id===input.fact_id&&f.revision===input.revision);
    invalid(Number.isSafeInteger(input.candidate_index)&&p,`comparisons[${i}].candidate_index`,'Reference an original candidate/input sentence index that produced a supported proposal.');
    invalid(f&&run.read_facts?.some(r=>r.fact_id===f.fact_id&&r.revision===f.revision),`comparisons[${i}].fact_id`,'Reference a current confirmed same-owner fact returned by retrieve_context in this run.');
    invalid(['conflict','update','duplicate','related'].includes(input.relation),`comparisons[${i}].relation`,'Use conflict, update, duplicate or related.');
    invalid(typeof input.reason==='string'&&input.reason.trim().length>0&&input.reason.length<=2000,`comparisons[${i}].reason`,'Provide a short explanation for review.');
    invalid(!p.comparisons.some(c=>c.fact_id===f.fact_id),`comparisons[${i}].fact_id`,'Compare each candidate/fact pair only once.');
    add(p,f,input.relation,input.reason,'model');
  });
  if(!legacyFallback)for(const p of proposals)for(const f of facts){
    if(!run.read_facts?.some(r=>r.fact_id===f.fact_id&&r.revision===f.revision)||!definiteDrugAllergyDisagreement(p,f))continue;
    add(p,f,'conflict','一处明确否认药物过敏史，另一处记载药物过敏，时间关系尚未澄清；请核实并保留两处原文。','server');
    const comparison=p.comparisons.find(c=>c.fact_id===f.fact_id);comparison.requires_resolution=true;comparison.possible_conflict=true;
  }
  // Automatic records use the validated model's event/meaning comparison.
  // Shared dimensions and different wording do not establish a contradiction.
  if(legacyFallback)for(const p of proposals)for(const f of facts){
    const overlap=(p.health_observations||[]).filter(o=>(f.health_observations||[]).some(old=>old.dimension===o.dimension));
    const differs=overlap.some(o=>(f.health_observations||[]).some(old=>old.dimension===o.dimension&&(old.value!==o.value||(old.unit||null)!==(o.unit||null))));
    if((differs||p.assertion!==f.assertion)&&sameComparableTopic(p,f))add(p,f,'conflict','相同健康维度有不同原文，可能是变化或不同事件，请核对。','server');
    else if(p.value===f.value)add(p,f,'duplicate','与已有确认原文相同，请核对是否为同一次记录。','server');
    else if(f.field===p.field||overlap.length)add(p,f,'related','同类已有记录，保留供对照；不表示两者属于同一事件。','server');
  }
  return proposals.flatMap(p=>p.comparisons);
}
export function resolveProposals(store,uid,change,body){
  const selected=new Set(body.accepted_change_ids),resolutions=body.resolutions||[];
  check(Array.isArray(resolutions)&&resolutions.length<=100);
  const seen=new Set(),byCandidate=new Map(),current=store.profile(uid).facts;
  for(const r of resolutions){
    keys(r,['candidate_id','fact_id','revision','action']);
    const p=change.proposals.find(p=>p.id===r.candidate_id);
    check(p&&reviewable(p),'REVISION_CONFLICT',409);
    check(['replace','keep_both','keep_existing','defer'].includes(r.action));
    check(selected.has(p.id)||r.action==='defer');
    const comparison=p.comparisons?.find(c=>c.fact_id===r.fact_id&&c.revision===r.revision);
    check(comparison,'INVALID_RESOLUTION',422);
    check(current.some(f=>f.fact_id===r.fact_id&&f.revision===r.revision),'REVISION_CONFLICT',409);
    const pair=p.id+':'+r.fact_id;check(!seen.has(pair));seen.add(pair);
    byCandidate.set(p.id,[...(byCandidate.get(p.id)||[]),r]);
  }
  const writes=[],replaced=new Set();
  for(const p of change.proposals){
    if(selected.has(p.id))check(reviewable(p),'REVISION_CONFLICT',409);
    const decisions=byCandidate.get(p.id)||[];
    if(!selected.has(p.id)){if(decisions.length){p.proposal_status='deferred';p.resolutions=structuredClone(decisions);}continue;}
    const actions=new Set(decisions.map(r=>r.action));
    check(!(actions.has('defer')&&actions.size>1)&&!(actions.has('keep_existing')&&actions.size>1),'INVALID_RESOLUTION',422);
    if(actions.has('defer')){p.proposal_status='deferred';p.resolutions=structuredClone(decisions);continue;}
    for(const c of p.comparisons||[])if(c.requires_resolution)check(decisions.some(r=>r.fact_id===c.fact_id&&r.revision===c.revision),'RESOLUTION_REQUIRED',409);
    p.resolutions=structuredClone(decisions);
    if(actions.has('keep_existing')){p.proposal_status='kept_existing';continue;}
    const replacements=decisions.filter(r=>r.action==='replace');check(replacements.length<=1,'INVALID_RESOLUTION',422);
    const clean=candidateContent(p);
    if(replacements.length){clean.fact_id=replacements[0].fact_id;clean.expected_version=replacements[0].revision;clean.proposal_kind='correction';}
    if(clean.fact_id){check(!replaced.has(clean.fact_id),'REVISION_CONFLICT',409);replaced.add(clean.fact_id);}
    writes.push({proposal:p,clean});
  }
  return writes;
}
export function refreshPendingComparisons(store,uid,change,changedFactIds){
  const current=new Map(store.profile(uid).facts.map(f=>[f.fact_id,f]));
  for(const proposal of change.proposals.filter(reviewable))for(const comparison of proposal.comparisons||[]){
    if(!changedFactIds.has(comparison.fact_id))continue;
    const fact=current.get(comparison.fact_id);
    if(!fact||fact.revision===comparison.revision)continue;
    const previousRevision=comparison.revision;
    comparison.revision=fact.revision;
    comparison.old_snapshot=structuredClone(fact);
    comparison.requires_resolution=true;
    comparison.reason=`已有记录已从 v${previousRevision} 更新为 v${fact.revision}，请对照新版本重新选择处理方式。`;
    // Do not carry an old choice across this new comparison. The confirmation
    // audit retains the prior decision, while the new version needs fresh input.
    proposal.resolutions=(proposal.resolutions||[]).filter(r=>r.fact_id!==fact.fact_id);
  }
  change.comparisons=change.proposals.flatMap(p=>p.comparisons||[]);
  change.conflicts=change.proposals.filter(reviewable).flatMap(p=>(p.comparisons||[]).filter(c=>c.requires_resolution));
}
export function buildHealthProfile(store,uid,facts,pending){
  const states=store.all('episode_state',uid);
  const events=store.all('episode',uid).map(episode=>{const state=states.find(s=>s.episode_id===episode.id);return {...episode,status:state?.status||'active',version:state?.version||1,original_status:episode.status,facts:facts.filter(f=>f.episode_id===episode.id),source_refs:[{source_id:episode.source_id}],updated_at:state?.updated_at||episode.created_at};});
  const rows=(fact,status)=>({...fact,review_status:fact.review_status||status,source_refs:fact.evidence,observations:fact.health_observations||[]});
  const observations=facts.flatMap(f=>(f.health_observations||[]).map(o=>({...o,fact_id:f.fact_id,revision:f.revision,review_status:f.review_status,assertion:observationAssertion(o.value,f.value),temporal_scope:f.temporal_scope,episode_id:f.episode_id,source_refs:f.evidence})));
  for(const change of pending)for(const p of change.proposals.filter(reviewable))for(const o of p.health_observations||[])observations.push({...o,fact_id:null,revision:null,change_id:change.id,candidate_id:p.id,review_status:p.proposal_status||'pending',assertion:observationAssertion(o.value,p.value),temporal_scope:p.temporal_scope,source_refs:p.evidence});
  const unknowns=HEALTH_DIMENSIONS.filter(d=>!observations.some(o=>o.dimension===d)).map(d=>({dimension:d,status:'not_recorded'}));
  for(const source of store.all('source',uid))for(const match of source.text.matchAll(/[^。！？!?；;\n]+(?:[。！？!?；;]|\n|$)/gu))if(classifySourceMarkers(match[0]).unsupported){
    const start=match.index,end=start+match[0].length,page=source.pages?.find(p=>start>=p.start&&end<=p.end)?.page??null;
    unknowns.push({status:'unknown',value:match[0],source_refs:[{source_id:source.id,source_text_version:source.text_version,locator:{page,start,end},quote:match[0]}],review_status:'source_only'});
  }
  const conflicts=pending.flatMap(change=>change.proposals.filter(reviewable).flatMap(p=>(p.comparisons||[]).filter(c=>c.requires_resolution).map(c=>({...c,change_id:change.id,review_status:p.proposal_status||'pending'}))));
  return {observations,current_problems:facts.filter(f=>f.temporal_scope!=='past'&&(f.assertion==='affirmed'||f.health_observations?.some(o=>['symptom','associated','measurement'].includes(o.dimension)&&observationAssertion(o.value,f.value)==='affirmed'))&&!['instruction','allergy'].includes(f.field)&&!f.health_observations?.some(o=>o.dimension==='background')&&events.find(e=>e.id===f.episode_id)?.status!=='resolved').map(f=>rows(f,'confirmed')),events,background:facts.filter(f=>f.temporal_scope==='past'||f.field==='allergy'||f.health_observations?.some(o=>o.dimension==='background')).map(f=>rows(f,'confirmed')),unknowns,conflicts};
}
export function feedbackContext(store,run){
  const feedback=store.all('care_feedback',run.owner).filter(f=>run.source_ids.includes(f.source_id));
  if(!feedback.length)return null;
  const contexts=feedback.map(f=>({feedback_id:f.id,task_id:f.task_id,task_version:f.task_version,task_validity:store.get(run.owner,'care_task',f.task_id).validity,recorded_task_validity:f.task_validity,task_snapshot:f.task_snapshot||null,guidance_source_refs:f.guidance_source_refs||[],guidance_sources:(f.guidance_source_snapshots||[]).filter(source=>run.source_ids.includes(source.id)),instruction_refs:f.instruction_refs,instructions:f.instruction_snapshots,text:store.get(run.owner,'source',f.source_id).text,source_id:f.source_id,source_refs:f.source_ids.map(source_id=>({source_id})),note:'反馈为用户自述；task_snapshot 标明患者正在反馈哪项任务，model_guidance 是助手建议而非医生医嘱。guidance_sources 与原医嘱仅作来源对照；stale 任务保留历史身份，不得声称当前有效或据此调整用药。'}));
  return {...contexts.at(-1),feedback_history:contexts};
}
