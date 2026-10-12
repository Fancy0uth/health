import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../../services/api/domain-server.mjs';
import {DomainClient,MemoryStorage} from '../../packages/client/domain-client.js';
import {sentenceSpans,literalSourceTime,classifySourceMarkers} from '../../services/api/source-validation.mjs';
let NativeBridge;
try {({NativeBridge}=await import('../../packages/client/native-bridge.js'));} catch(error) {if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
const agent={mode:'fixture',async run({run,tools}) {
  const {source}=await tools.healththread_read_source({source_id:run.source_ids[0]});
  const context=await tools.healththread_retrieve_context({});
  const spans=sentenceSpans(source);
  if(run.workflow==='visit')return tools.healththread_stage_result({kind:'visit_preparation',operation_key:'native-visit-fixture',dependencies:[{source_id:source.id,source_text_version:1}],payload:{speech:source.text,questions:[],unknowns:[],claims:[{text:source.text,evidence:spans,fact_refs:[]}]}});
  if(run.workflow==='care_plan') {const {instructions}=await tools.healththread_get_confirmed_instructions({document_id:run.document_id});return tools.healththread_stage_result({kind:'care_plan',operation_key:'native-care-fixture',dependencies:instructions.map(f=>({fact_id:f.fact_id,revision:f.revision})),payload:{tasks:instructions.map(f=>({text:f.value,schedule:f.effective_time.raw,instruction_refs:[{fact_id:f.fact_id,revision:f.revision}]})),explanation:'fixture'}});}
  return tools.healththread_stage_candidates({base_profile_revision:context.snapshot_revision,operation_key:'native-candidate-fixture',candidates:spans.map(e=>({field:run.workflow==='document'?'instruction':'reported_text',value:e.quote,assertion:classifySourceMarkers(e.quote).assertion,temporal_scope:classifySourceMarkers(e.quote).temporal_scope,effective_time:literalSourceTime(e.quote,source.id),evidence:[e],proposal_kind:'new'}))});
}};
async function setup(t,selectedAgent=agent) {
  assert.ok(NativeBridge,'original pages require a native-domain adapter, not a replacement UI');
  const app=createApp({dbPath:':memory:',demoAccounts:[{username:'alice',password:'alice-password'}],agent:selectedAgent});await app.listen(0);const base=`http://127.0.0.1:${app.server.address().port}`;let cookie='';const requests=[];
  const transport=async(path,options={})=>{requests.push({path,method:options.method||'GET'});const r=await fetch(base+path,{...options,headers:{...options.headers,Origin:base,Cookie:cookie}});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  const client=new DomainClient({fetchImpl:transport,storage:new MemoryStorage(),channel:null,pollMs:1});await client.initialize();await client.login('alice','alice-password');await client.setConsent(true);const bridge=new NativeBridge(client);await bridge.refresh();t.after(async()=>{client.dispose();await app.close();});return {app,client,bridge,requests,transport};
}
test('original-page projection cannot promote locally edited candidates into official facts',async t=>{
  const {bridge,client,requests}=await setup(t);const accepted=await bridge.createEntry('目前没有头痛。');await bridge.wait(accepted.run_id);const before=bridge.snapshot();assert.equal(before.records.length,1);assert.equal(before.records[0].status,'pending');assert.equal(client.state.profile.facts.length,0);
  before.records[0].status='confirmed';before.records[0].summary='伪造事实';before.factVersion=999;bridge.saveOverlay(before);
  const actual=bridge.snapshot();assert.equal(actual.records[0].status,'pending');assert.equal(actual.records[0].summary,'目前没有头痛。');assert.equal(client.state.profile.facts.length,0);assert.ok(!requests.some(r=>r.path==='/api/state'&&r.method==='PUT'));
});
test('native review submits exact candidate IDs and another original client reads the confirmed version',async t=>{
  const {bridge,client}=await setup(t);const accepted=await bridge.createEntry('目前没有恶心。');await bridge.wait(accepted.run_id);const item=bridge.snapshot().records[0];const change=await bridge.review(item.id);assert.equal(change.proposals[0].assertion,'negated');await bridge.confirm(item.id,[change.proposals[0].id]);assert.equal(bridge.snapshot().records[0].status,'confirmed');assert.equal(client.state.profile.facts[0].value,'目前没有恶心。');
  const peer=new NativeBridge(client);await peer.refresh();assert.equal(peer.snapshot().records[0].status,'confirmed');
});
test('original medical review preserves multiple instructions and partial confirmation generates only selected tasks',async t=>{
  const {bridge,app}=await setup(t);const receipt=await bridge.createDocument({text:'医嘱：每日记录症状。\n医嘱：三天后复诊。',name:'合成医嘱'});await bridge.wait(receipt.run_id);const m=bridge.snapshot().medical;assert.equal(m.original,'医嘱：每日记录症状。\n医嘱：三天后复诊。');assert.equal(m.proposals.length,2);const selected=m.proposals.find(p=>p.value.includes('每日'));const outcome=await bridge.confirm(m.source_id,[selected.id]);assert.ok(outcome.continuation_run_id);await app.jobs.drain();await bridge.wait(outcome.continuation_run_id);const state=bridge.snapshot();assert.equal(state.tasks.length,1);assert.equal(state.tasks[0].text,selected.value);assert.equal(state.tasks[0].schedule,'每日');
  await bridge.updateTask(state.tasks[0].id,'done');assert.equal(bridge.snapshot().tasks[0].status,'done');
});
test('original visit action uses owned source IDs and shows actual persisted speech without a template fallback',async t=>{
  const {bridge}=await setup(t);const entry=await bridge.createEntry('既往头痛。');await bridge.wait(entry.run_id);const reply=await bridge.requestAgent('/api/visit-preparations',{current_concern:'本次想说明夜间咳嗽。',selected_record_ids:[entry.source_id]});assert.equal(reply.speech,'本次想说明夜间咳嗽。');assert.equal(bridge.snapshot().cardDraft,reply.speech);assert.ok(bridge.snapshot().cardVersion>0);
});
test('failed native analysis leaves accepted original available and explicit retry reuses it',async t=>{
  const bad={mode:'fixture',async run(){throw Object.assign(new Error('transport fixture'),{code:'DEPENDENCY_UNAVAILABLE'});}};const {bridge}=await setup(t,bad);const accepted=await bridge.createEntry('原文失败后仍保留。');await assert.rejects(bridge.wait(accepted.run_id));let state=bridge.snapshot();assert.equal(state.records.length,1);assert.equal(state.records[0].text,'原文失败后仍保留。');const retry=await bridge.retryEntry(state.records[0].id);assert.equal(retry.source_id,accepted.source_id);await assert.rejects(bridge.wait(retry.run_id));state=bridge.snapshot();assert.equal(state.records.length,1);
});
test('a stale original review cannot silently refresh its confirmation revision',async t=>{
  const {bridge,client}=await setup(t);const first=await bridge.createEntry('第一条原文。');await bridge.wait(first.run_id);const old=bridge.snapshot().records.find(r=>r.id===first.source_id);const other=await bridge.createEntry('第二条原文。');await bridge.wait(other.run_id);const second=bridge.snapshot().records.find(r=>r.id===other.source_id);await bridge.confirm(second.id,[second.proposals[0].id],second.base_profile_revision,second.change_id);await assert.rejects(bridge.confirm(old.id,[old.proposals[0].id],old.base_profile_revision,old.change_id),e=>e.code==='REVISION_CONFLICT');assert.equal(client.state.profile.facts.length,1);
});
test('all-data deletion rejects old original-page overlays and does not restore initial demo facts/cards',async t=>{
  const {bridge}=await setup(t);const old=bridge.snapshot();old.sessions=[{id:'draft-session',messages:[{role:'user',text:'旧页面草稿'}]}];const deletion=await bridge.deleteAll();assert.equal(deletion.status,'partial');assert.ok(deletion.recorded_at);assert.throws(()=>bridge.saveOverlay(old),e=>e.code==='LOCAL_DRAFT_EXPIRED');const current=bridge.snapshot();assert.equal(current.records.length,0);assert.equal(current.medical,null);assert.equal(current.cardVersion,0);assert.equal(current.cardDraft,'');assert.equal(current.currentConcern,'');assert.deepEqual(current.questions,[]);assert.equal(current.deleteResult,deletion.recorded_at);
});
test('native request recovery replays the original key rather than duplicating a lost saved source',async t=>{
  const {transport}=await setup(t);let lose=true;const client=new DomainClient({fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path==='/api/entries'&&lose){lose=false;throw new Error('lost receipt');}return response;},storage:new MemoryStorage(),channel:null,pollMs:1});t.after(()=>client.dispose());await client.initialize();const bridge=new NativeBridge(client);await bridge.refresh();await assert.rejects(bridge.createEntry('响应丢失时的原文。'),e=>e.code==='OUTCOME_UNKNOWN');await bridge.recover();assert.equal(bridge.snapshot().records.length,1);assert.equal(bridge.snapshot().records[0].text,'响应丢失时的原文。');
});
test('a peer all-clear cannot resurrect original-page conversation drafts from a bridge fallback',async t=>{
  const {bridge,client}=await setup(t);bridge.saveOverlay({...bridge.snapshot(),sessions:[{id:'old-ui-draft',messages:[{role:'user',text:'删除前的对话草稿'}]}]});const peer=new NativeBridge(client);await peer.deleteAll();assert.deepEqual(bridge.snapshot().sessions,[]);
});
