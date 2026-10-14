import schemas from './schemas.json' with {type:'json'};
const kinds=Object.freeze({chat:'assistant_reply',visit:'visit_preparation',care_plan:'care_plan',transcription:'transcription'});
// Workflow is supplied by the store-owned run before the private Host starts.
// Narrow only the advertised/native result shape; domain authorization remains
// authoritative and raw tool arguments are never transformed.
export function schemasForWorkflow(workflow){
 if(workflow!==undefined&&!['entry','document',...Object.keys(kinds)].includes(workflow))throw Object.assign(new Error('AGH_WORKFLOW_INVALID'),{code:'AGH_WORKFLOW_INVALID'});
 const scoped=structuredClone(schemas),kind=kinds[workflow];
 // Public contracts accept old cards; active model tools advertise only native v2.
 const maintained=scoped.healththread_stage_candidates.properties.overview.oneOf[0];
 maintained.description='A native JSON object, never a serialized JSON string. Set overview directly to {format_version:2,summary,problems,background,uncertainties}. Do not call JSON.stringify on overview or its nested objects/arrays.';
 const narrow=value=>{if(!value||typeof value!=='object')return;for(const [key,child] of Object.entries(value)){if(key==='overview'&&child?.oneOf)value[key]=structuredClone(maintained);else narrow(child);}};
 narrow(scoped);
 scoped.healththread_stage_candidates.examples=[{candidates:[],base_profile_revision:1,operation_key:'COPY-INPUT-OPERATION-KEY',overview:{format_version:2,summary:'根据最近记录整理身体近况，尚未记录的信息保持未知。',problems:[],background:[],uncertainties:[]}}];
 if(!kind)return scoped;
 const original=scoped.healththread_stage_result,variant=original.oneOf.find(s=>s.properties.kind.const===kind);
 scoped.healththread_stage_result={...variant,$defs:original.$defs};
 if(workflow==='chat'||workflow==='visit'){
  const payload=original.$defs[workflow==='chat'?'chat_payload':'visit_payload'];
  payload.required=[...new Set([...payload.required,'format_version',...(workflow==='chat'?['reply']:[])])];
  if(workflow==='chat'){
   scoped.healththread_stage_result.examples=[{kind:'assistant_reply',operation_key:'COPY-INPUT-OPERATION-KEY',dependencies:[],payload:{format_version:2,intent:'clarify',reply:'收到这次身体感受。',questions:[],claims:[],automatic_record:{action:'save',summary:'根据本轮患者自述与相关记录综合。',record_source_refs:[{source_id:'COPY-RETURNED-SOURCE-ID',sentence_index:0,field:'reported_text'}],comparisons:[],overview:{format_version:2,summary:'根据最近记录整理身体近况，尚未记录的信息保持未知。',problems:[],background:[],uncertainties:[]}}}}];
   payload.properties.claims={type:'array',items:{type:'object',properties:{},additionalProperties:false},maxItems:0,description:'Use []. Patient evidence is reconstructed from automatic_record.record_source_refs; do not duplicate claims, quotes or offsets.'};
   payload.properties.speech={type:'string',maxLength:0,description:'Omit or use an empty string. Put the natural response in reply.'};
   const automatic=payload.properties.automatic_record;
   delete automatic.properties.candidates;
   automatic.allOf=[
    {if:{properties:{action:{const:'save'}},required:['action']},then:{required:['summary','record_source_refs','overview']}},
    {if:{properties:{action:{const:'skip'}},required:['action']},then:{required:['reason']}},
   ];
  }
 }
 return scoped;
}
