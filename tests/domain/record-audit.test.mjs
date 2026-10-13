import test from 'node:test';
import assert from 'node:assert/strict';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {classifySourceMarkers,literalSourceTime} from '../../services/api/source-validation.mjs';

function fixture(t){
 const store=new DomainStore({demoAccounts:[{username:'audit',password:'audit-password'}]});
 t.after(()=>store.close());
 const uid=store.login('audit','audit-password').user.id;
 store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
 return {store,uid};
}
function stageRecord(store,uid,empty=false){
 const accepted=store.acceptRecordTurn(uid,{text:'头痛。'},'audit-record-turn-001');
 store.claimRun(accepted.run_id);
 const tools=store.toolsFor(accepted.run_id),source=tools.healththread_read_source({source_id:accepted.source_id}).source;
 const context=tools.healththread_retrieve_context({});
 const markers=classifySourceMarkers(source.text);
 const staged=tools.healththread_stage_candidates({base_profile_revision:context.snapshot_revision,operation_key:'audit-stage-record-001',candidates:empty?[]:[{field:'reported_text',value:source.text,assertion:markers.assertion,temporal_scope:markers.temporal_scope,effective_time:literalSourceTime(source.text,source.id),evidence:[{source_id:source.id,source_text_version:1,locator:{page:null,start:0,end:source.text.length},quote:source.text}],proposal_kind:'new'}],record_dialogue:{questions:[],missing_fields:[]}});
 return {...accepted,...staged};
}
test('rejecting a record review updates its durable thread and rejection history exactly once',t=>{
 const {store,uid}=fixture(t),record=stageRecord(store,uid);
 const before=store.get(uid,'record_thread',record.record_thread_id);
 const body={expected_profile_revision:1};
 const outcome=store.reject(uid,record.fact_change_id,body,'audit-reject-record-001');
 const after=store.recordThreads(uid)[0];
 assert.equal(after.status,'rejected');
 assert.equal(after.version,before.version+1);
 assert.equal(after.confirmations.length,1);
 assert.deepEqual(after.confirmations[0].accepted_change_ids,[]);
 assert.deepEqual(after.confirmations[0].outcome,outcome);
 assert.deepEqual(store.reject(uid,record.fact_change_id,body,'audit-reject-record-001'),outcome);
 assert.equal(store.recordThreads(uid)[0].confirmations.length,1);
 assert.equal(store.profile(uid).facts.length,0);
 assert.throws(()=>store.acceptRecordTurn(uid,{text:'补充。',record_thread_id:record.record_thread_id,expected_version:before.version},'audit-stale-amend-001'),{code:'REVISION_CONFLICT'});
});

test('rejecting an empty record review never locks it as confirmed',t=>{
 const {store,uid}=fixture(t),record=stageRecord(store,uid,true);
 store.reject(uid,record.fact_change_id,{expected_profile_revision:1},'audit-reject-empty-001');
 const thread=store.recordThreads(uid)[0];
 assert.equal(thread.status,'rejected');
 const next=store.acceptRecordTurn(uid,{text:'补充。',record_thread_id:thread.id,expected_version:thread.version},'audit-after-empty-001');
 assert.equal(next.record_thread_id,thread.id);
});
test('retrying a failed chat preserves its durable conversation identity',t=>{
 const {store,uid}=fixture(t);
 const first=store.accept(uid,'chat',{question:'头痛。'},'audit-chat-turn-001');
 store.failRun(first.run_id,'DEPENDENCY_UNAVAILABLE');
 const retry=store.retry(uid,first.run_id,'audit-chat-retry-001');
 assert.equal(store.get(uid,'run',retry.run_id).conversation_id,first.conversation_id);
 assert.equal(store.timeline(uid).entries.length,0);
 assert.equal(store.get(uid,'source',first.source_id).text,'头痛。');
});

test('ordinary symptom frequency questions do not reject a simple record, while treatment instructions remain rejected',t=>{
 const {store,uid}=fixture(t);
 const accepted=store.acceptRecordTurn(uid,{text:'我现在肚子有点不舒服'},'simple-abdomen-record');store.claimRun(accepted.run_id);
 const tools=store.toolsFor(accepted.run_id),read=tools.healththread_read_source({source_id:accepted.source_id});const context=tools.healththread_retrieve_context({source_ids:[]});
 const base={base_profile_revision:context.snapshot_revision,operation_key:'simple-abdomen-stage',candidates:[{field:'symptom',value:read.source.text,assertion:'affirmed',temporal_scope:'current',effective_time:literalSourceTime(read.source.text,read.source.id),evidence:read.sentence_spans,proposal_kind:'new'}]};
 for(const q of ['请服两片药好吗？','可以先观察三天再就诊吗？','建议每天用药一次好吗？'])assert.throws(()=>tools.healththread_stage_candidates({...base,record_dialogue:{questions:[q],missing_fields:['频率']}}),e=>e.code==='INVALID_AGENT_OUTPUT'&&e.details?.path==='record_dialogue.questions');
 const staged=tools.healththread_stage_candidates({...base,record_dialogue:{questions:['这种情况是偶尔一次，还是最近反复出现？','不舒服一天出现几次？','每次不适会持续一天还是几分钟？'],missing_fields:['频率','持续时间']}});
 assert.ok(staged.fact_change_id);assert.equal(store.recordThreads(uid)[0].summaries.at(-1).questions.length,3);assert.equal(store.profile(uid).facts.length,0);
});
