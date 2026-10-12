// Isolated process fault fixture. No production failpoint or force flag exists.
import {DomainStore} from '../../services/api/domain-store.mjs';
const [dbPath,phase]=process.argv.slice(2);const store=new DomainStore({dbPath,demoAccounts:[{username:'crash',password:'synthetic-crash-password'}]});const uid=store.login('crash','synthetic-crash-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
const key='crash-accept-key-000001';
if(phase==='before_commit'){
 const insert=store.insert.bind(store);store.insert=(owner,type,data)=>{const value=insert(owner,type,data);if(type==='source'){process.send({phase,uid});Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}return value;};
}
const a=store.accept(uid,'document',{text:'医嘱：记录症状。'},key);
if(phase==='running'||phase==='needs_review'||phase==='continuation'){
 store.claimRun(a.run_id);const tools=store.toolsFor(a.run_id);tools.healththread_read_source({source_id:a.source_id});tools.healththread_retrieve_context({});
 if(phase!=='running'){
  const c={field:'instruction',value:'医嘱：记录症状。',assertion:'affirmed',temporal_scope:'unknown',effective_time:{raw:null,precision:'unknown',start:null,end:null,timezone:null,anchor_source_id:a.source_id},evidence:[{source_id:a.source_id,source_text_version:1,locator:{page:null,start:0,end:8},quote:'医嘱：记录症状。'}],proposal_kind:'new'};
  const staged=tools.healththread_stage_candidates({base_profile_revision:1,candidates:[c],operation_key:'crash-stage-key-000001'});a.fact_change_id=staged.fact_change_id;
  if(phase==='continuation'){const change=store.get(uid,'fact_change',staged.fact_change_id);a.confirmation=store.confirm(uid,change.id,{expected_profile_revision:1,accepted_change_ids:[change.proposals[0].id]},'crash-confirm-key-000001');}
 }
}
process.send({phase,uid,accepted:a});setInterval(()=>{},1000);
