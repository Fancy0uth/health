import schemas from './schemas.json' with {type:'json'};
const kinds=Object.freeze({chat:'assistant_reply',visit:'visit_preparation',care_plan:'care_plan',transcription:'transcription'});
// Workflow is supplied by the store-owned run before the private Host starts.
// Narrow only the advertised/native result shape; domain authorization remains
// authoritative and raw tool arguments are never transformed.
export function schemasForWorkflow(workflow){
 if(workflow!==undefined&&!['entry','document',...Object.keys(kinds)].includes(workflow))throw Object.assign(new Error('AGH_WORKFLOW_INVALID'),{code:'AGH_WORKFLOW_INVALID'});
 const scoped=structuredClone(schemas),kind=kinds[workflow];
 if(!kind)return scoped;
 const original=scoped.healththread_stage_result,variant=original.oneOf.find(s=>s.properties.kind.const===kind);
 scoped.healththread_stage_result={...variant,$defs:original.$defs};
 if(workflow==='chat'||workflow==='visit'){
  const payload=original.$defs[workflow==='chat'?'chat_payload':'visit_payload'];
  payload.required=[...new Set([...payload.required,'format_version',...(workflow==='chat'?['reply']:[])])];
  if(workflow==='chat'){
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
