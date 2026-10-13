import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../services/api/domain-server.mjs';
import {DomainClient,MemoryStorage} from '../../packages/client/domain-client.js';
import {NativeBridge} from '../../packages/client/native-bridge.js';
import {sentenceSpans,literalSourceTime,classifySourceMarkers} from '../../services/api/source-validation.mjs';
const agent={mode:'fixture',async run({run,tools}){
  const current=await tools.healththread_read_source({source_id:run.source_ids[0]});
  const context=await tools.healththread_retrieve_context({source_ids:run.source_ids.slice(1)});
  const sources=[current.source,...context.sources];
  return tools.healththread_stage_candidates({base_profile_revision:context.snapshot_revision,operation_key:'record-dialogue:'+run.id,candidates:sources.flatMap(source=>sentenceSpans(source).map(span=>({field:'reported_text',value:span.quote,assertion:classifySourceMarkers(span.quote).assertion,temporal_scope:classifySourceMarkers(span.quote).temporal_scope,effective_time:literalSourceTime(span.quote,source.id),evidence:[span],proposal_kind:'new'}))),record_dialogue:{questions:['这些身体感受对日常活动有什么影响？'],missing_fields:['影响','用药','过敏']}});
}};
async function setup(t,selected=agent){
  const app=createApp({dbPath:':memory:',demoAccounts:[{username:'record',password:'record-password'},{username:'peer',password:'peer-password'}],agent:selected});await app.listen(0);const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='';
  const transport=async(path,options={})=>{const r=await fetch(base+path,{...options,headers:{...options.headers,Origin:base,Cookie:cookie}});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  const client=new DomainClient({fetchImpl:transport,storage:new MemoryStorage(),channel:null,pollMs:1});await client.initialize();await client.login('record','record-password');await client.setConsent(true);const bridge=new NativeBridge(client);await bridge.refresh();t.after(async()=>{client.dispose();await app.close();});return {bridge,client,app,transport};
}
test('record mode returns a model review summary in a durable conversation before any fact confirmation',async t=>{
  const {bridge,client}=await setup(t);assert.equal(typeof bridge.recordTurn,'function');
  const accepted=await bridge.recordTurn('目前可能夜间咳嗽。');await bridge.wait(accepted.run_id);
  const state=bridge.snapshot(),session=state.sessions.find(s=>s.record_thread_id===accepted.record_thread_id);assert.ok(session);
  assert.equal(client.state.profile.facts.length,0);assert.equal(session.messages.length,2);const summary=session.messages[1];
  assert.match(summary.text,/不确定/);assert.match(summary.text,/这些身体感受/);assert.match(summary.text,/过敏/);assert.match(summary.text,/确认/);assert.ok(summary.record_review);
  const peer=new NativeBridge(client);await peer.refresh();assert.equal(peer.snapshot().sessions.find(s=>s.id===session.id).messages[1].text,summary.text);
});
test('a follow-up replaces the pending summary while preserving both original turns and old-summary rejection',async t=>{
  const {bridge,client}=await setup(t);const a=await bridge.recordTurn('目前夜间咳嗽。');await bridge.wait(a.run_id);let session=bridge.snapshot().sessions.find(s=>s.record_thread_id===a.record_thread_id);const old=session.messages.at(-1).record_review;
  const b=await bridge.recordTurn('大约三天前开始。',a.record_thread_id,session.record_version);await bridge.wait(b.run_id);session=bridge.snapshot().sessions.find(s=>s.record_thread_id===a.record_thread_id);
  assert.equal(session.messages.filter(m=>m.role==='user').length,2);assert.match(session.messages.at(-1).text,/大约三天前/);assert.equal(bridge.snapshot().records.filter(r=>r.record_thread_id===a.record_thread_id).length,1);
  await assert.rejects(bridge.confirmRecord(a.record_thread_id,'确认',old),e=>e.code==='REVISION_CONFLICT');assert.equal(client.state.profile.facts.length,0);
});
test('a literal human confirmation commits only the displayed summary and is persisted across clients',async t=>{
  const {bridge,client}=await setup(t);const a=await bridge.recordTurn('目前没有恶心。');await bridge.wait(a.run_id);let session=bridge.snapshot().sessions.find(s=>s.record_thread_id===a.record_thread_id);const review=session.messages.at(-1).record_review;
  await assert.rejects(bridge.confirmRecord(a.record_thread_id,'好的',review));assert.equal(client.state.profile.facts.length,0);
  const result=await bridge.confirmRecord(a.record_thread_id,'确认',review);assert.ok(result.commit_receipt);assert.equal(client.state.profile.facts[0].assertion,'negated');
  const sourceCount=client.state.timeline.entries.length;await bridge.confirmRecord(a.record_thread_id,'确认',review);assert.equal(client.state.profile.facts.length,1);assert.equal(client.state.timeline.entries.length,sourceCount);
  session=bridge.snapshot().sessions.find(s=>s.record_thread_id===a.record_thread_id);assert.equal(session.messages.at(-2).text,'确认');assert.match(session.messages.at(-1).text,/已确认/);
});
test('timeline confirmation remains available for an unconfirmed record conversation',async t=>{
  const {bridge,client}=await setup(t);const a=await bridge.recordTurn('目前夜间咳嗽。');await bridge.wait(a.run_id);const item=bridge.snapshot().records.find(r=>r.record_thread_id===a.record_thread_id);const review=await bridge.review(item.id);
  await bridge.confirm(item.id,review.proposals.map(p=>p.id),review.review_revision,review.id);assert.equal(client.state.profile.facts.length,1);assert.equal(bridge.snapshot().sessions.find(s=>s.record_thread_id===a.record_thread_id).record_status,'confirmed');
});
test('all-data deletion removes conversation summaries and cannot resurrect them through drafts',async t=>{
  const {bridge,client,app}=await setup(t);const a=await bridge.recordTurn('目前夜间咳嗽。');await bridge.wait(a.run_id);await bridge.deleteAll();assert.equal(bridge.snapshot().sessions.length,0);assert.equal(client.state.profile.facts.length,0);for(const type of ['record_thread','record_summary','record_confirmation'])assert.equal(app.store.all(type).length,0);
});

test('a failed model turn can be retried and reanalysed in the same durable record thread',async t=>{
  let fail=true;const {bridge,client}=await setup(t,{mode:'fixture',async run(input){if(fail)throw new Error('synthetic transport failure');return agent.run(input);}});
  const a=await bridge.recordTurn('目前夜间咳嗽。');await assert.rejects(bridge.wait(a.run_id));assert.equal(client.state.profile.facts.length,0);
  fail=false;const retry=await bridge.retryEntry(a.source_id);await bridge.wait(retry.run_id);let session=bridge.snapshot().sessions.find(s=>s.id===a.record_thread_id);assert.ok(session.messages.at(-1).record_review);
  const old=session.messages.at(-1).record_review;const reanalysis=await bridge.retryEntry(a.source_id);await bridge.wait(reanalysis.run_id);session=bridge.snapshot().sessions.find(s=>s.id===a.record_thread_id);
  assert.notEqual(session.messages.at(-1).record_review.summary_id,old.summary_id);await assert.rejects(bridge.confirmRecord(a.record_thread_id,'确认',old),e=>e.code==='REVISION_CONFLICT');assert.equal(client.state.timeline.entries.length,1);
});
test('record versions reject concurrent follow-ups and foreign owners cannot read or update a thread',async t=>{
  const {bridge,client,app}=await setup(t);const a=await bridge.recordTurn('目前夜间咳嗽。');await bridge.wait(a.run_id);const session=bridge.snapshot().sessions.find(s=>s.id===a.record_thread_id);
  const b=await bridge.recordTurn('大约三天前开始。',a.record_thread_id,session.record_version);await bridge.wait(b.run_id);
  await assert.rejects(bridge.recordTurn('尚未用药。',a.record_thread_id,session.record_version),e=>e.code==='REVISION_CONFLICT');assert.equal(client.state.timeline.entries.length,2);
  const uid=app.store.login('peer','peer-password').user.id;app.store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});assert.equal(app.store.recordThreads(uid).length,0);
  assert.throws(()=>app.store.acceptRecordTurn(uid,{text:'新增。',record_thread_id:a.record_thread_id,expected_version:session.record_version},'foreign-thread-key-001'),e=>e.code==='NOT_FOUND');
});
test('lost acceptance and lost confirmation acknowledgements recover original requests without duplicate sources or facts',async t=>{
  const {bridge,client}=await setup(t);const original=client.fetchImpl;let drop='/api/record-turns';client.fetchImpl=async(path,options)=>{const response=await original(path,options);if(path===drop&&options?.method==='POST'){drop=null;throw new Error('synthetic lost acknowledgement');}return response;};
  await assert.rejects(bridge.recordTurn('目前没有恶心。'),e=>e.code==='OUTCOME_UNKNOWN');const accepted=await bridge.recover();assert.equal(client.state.timeline.entries.length,1);let session=bridge.snapshot().sessions.find(s=>s.id===accepted.record_thread_id);const review=session.messages.at(-1).record_review;
  drop='/api/fact-changes/'+review.fact_change_id+'/confirm';await assert.rejects(bridge.confirmRecord(session.id,'确认',review),e=>e.code==='OUTCOME_UNKNOWN');await bridge.recover();assert.equal(client.state.profile.facts.length,1);session=bridge.snapshot().sessions.find(s=>s.id===session.id);assert.equal(session.messages.filter(m=>m.text==='确认').length,1);
});
test('deleting one source in a record thread withdraws its summaries and expired confirmation cannot be replayed',async t=>{
  const {bridge,client}=await setup(t);const a=await bridge.recordTurn('目前夜间咳嗽。');await bridge.wait(a.run_id);let session=bridge.snapshot().sessions.find(s=>s.id===a.record_thread_id);const b=await bridge.recordTurn('大约三天前开始。',a.record_thread_id,session.record_version);await bridge.wait(b.run_id);session=bridge.snapshot().sessions.find(s=>s.id===a.record_thread_id);const review=session.messages.at(-1).record_review;
  await client.deleteData(a.source_id);await bridge.refresh();assert.equal(client.state.recordThreads.length,0);assert.equal(bridge.snapshot().sessions.some(s=>s.id===session.id),false);await assert.rejects(bridge.confirmRecord(session.id,'确认',review));assert.equal(client.state.profile.facts.length,0);
});
test('analysis consent withdrawal rejects confirmation of the previously displayed summary',async t=>{
  const {bridge,client}=await setup(t);const a=await bridge.recordTurn('目前夜间咳嗽。');await bridge.wait(a.run_id);const session=bridge.snapshot().sessions.find(s=>s.id===a.record_thread_id),review=session.messages.at(-1).record_review;
  await bridge.setConsent(false);await assert.rejects(bridge.confirmRecord(session.id,'确认',review));assert.equal(client.state.profile.facts.length,0);
});
