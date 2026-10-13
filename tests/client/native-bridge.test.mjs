import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../services/api/domain-server.mjs';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {DomainClient,MemoryStorage} from '../../packages/client/domain-client.js';
import {sentenceSpans,literalSourceTime,classifySourceMarkers} from '../../services/api/source-validation.mjs';
let NativeBridge;
try {({NativeBridge}=await import('../../packages/client/native-bridge.js'));} catch(error) {if(error.code!=='ERR_MODULE_NOT_FOUND')throw error;}
test('reopening an initial chat result adds conversation metadata without changing its content',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'ht-chat-migration-'));const path=join(directory,'db.sqlite');let store=new DomainStore({dbPath:path,demoAccounts:[{username:'migration',password:'migration-password'}]});
  t.after(async()=>{store.close();await rm(directory,{recursive:true,force:true});});
  const owner=store.login('migration','migration-password').user.id;store.setConsent(owner,{purpose:'analysis',granted:true,expected_version:1});const accepted=store.accept(owner,'chat',{question:'你好。'},'chat-migration-fixture');const run=store.claimRun(accepted.run_id),tools=store.toolsFor(run.id);
  const {source,sentence_spans}=tools.healththread_read_source({source_id:accepted.source_id});tools.healththread_retrieve_context({});const resultReceipt=tools.healththread_stage_result({kind:'assistant_reply',operation_key:'chat-migration-stage',dependencies:[{source_id:source.id,source_text_version:1}],payload:{intent:'greeting',speech:source.text,questions:[],unknowns:[],claims:[{text:source.text,fact_refs:[],evidence:sentence_spans}]}});
  const result=store.get(owner,'result',resultReceipt.result_id),before=structuredClone(result.payload);delete result.conversation_id;store.save('result',result);store.close();store=new DomainStore({dbPath:path});
  const reopened=store.get(owner,'result',result.id);assert.equal(reopened.conversation_id,run.conversation_id);assert.deepEqual(reopened.payload,before);
});
const agent={mode:'fixture',async run({run,tools}) {
  const {source}=await tools.healththread_read_source({source_id:run.source_ids[0]});
  const context=await tools.healththread_retrieve_context({});
  const spans=sentenceSpans(source);
  if(run.workflow==='visit'||run.workflow==='chat')return tools.healththread_stage_result({kind:run.workflow==='chat'?'assistant_reply':'visit_preparation',operation_key:'native-visit-fixture',dependencies:[{source_id:source.id,source_text_version:1}],payload:{...(run.workflow==='chat'?{intent:'prepare'}:{}),speech:source.text,questions:run.workflow==='chat'?['你想先整理哪些就诊资料？']:[],unknowns:[],claims:[{text:source.text,evidence:spans,fact_refs:[]}]}});
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
test('every operation event includes the operation consumed by the original-page sync subscriber',async t=>{
  const {bridge,client}=await setup(t);let seen=0;
  client.subscribe(event=>{if(event.type==='operation'){assert.ok(event.operation,'the page must not throw before the POST');assert.equal(typeof event.operation.state,'string');seen++;}});
  const receipt=await bridge.createEntry('页面事件链的合成记录。');await bridge.wait(receipt.run_id);assert.ok(seen>=2);
});
test('receipt verification waits for runtime finalization after a result has been staged',async t=>{
  let markStaged,release;const staged=new Promise(resolve=>markStaged=resolve),gate=new Promise(resolve=>release=resolve);
  const delayed={mode:'fixture',async run(input){const outcome=await agent.run(input);markStaged();await gate;return outcome;}};
  const {bridge,client}=await setup(t,delayed);const receipt=await bridge.createEntry('核验回执前不宣称闭环。');await staged;
  let resolved=false;const waiting=client.pollRun(receipt.run_id,{requireRuntime:true}).then(run=>{resolved=true;return run;});
  try{await new Promise(resolve=>setTimeout(resolve,15));assert.equal(resolved,false);}finally{release();}
  const run=await waiting;assert.equal(run.runtime.mode,'fixture');
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
test('a selected-history visit cannot replace the original entry analysis or mark its pending candidates as merely saved',async t=>{
  const {bridge}=await setup(t);const entry=await bridge.createEntry('目前夜间咳嗽。');await bridge.wait(entry.run_id);
  await bridge.requestAgent('/api/visit-preparations',{current_concern:'准备说明本次情况。',selected_record_ids:[entry.source_id]});
  const record=bridge.snapshot().records.find(r=>r.id===entry.source_id);assert.equal(record.run_id,entry.run_id);assert.equal(record.analysis,'complete');assert.ok(record.proposals.length);
});
test('a visit-only source is identified as context rather than a pending record with impossible confirmation',async t=>{
  const {bridge}=await setup(t);await bridge.requestAgent('/api/visit-preparations',{current_concern:'今天想向医生说明夜间咳嗽。',selected_record_ids:[]});
  const item=bridge.snapshot().records[0];assert.equal(item.record_kind,'visit_context');assert.equal(item.status,'reference');assert.equal(item.analysis,'not_requested');
});
test('fresh review can confirm an unchanged draft after another independent record was confirmed',async t=>{
  const {bridge,client}=await setup(t);const a=await bridge.createEntry('第一条独立记录。');await bridge.wait(a.run_id);const b=await bridge.createEntry('第二条独立记录。');await bridge.wait(b.run_id);
  const second=await bridge.review(b.source_id);await bridge.confirm(b.source_id,[second.proposals[0].id]);
  const first=await bridge.review(a.source_id);const freshRevision=client.state.profile.profile_revision;
  await bridge.confirm(a.source_id,[first.proposals[0].id],freshRevision,first.id);assert.equal(client.state.profile.facts.length,2);
});
test('assistant questions use a distinct persisted AGH workflow without creating a doctor card or confirmed facts',async t=>{
  const {bridge,client}=await setup(t);const reply=await bridge.requestAgent('/api/health-assistant',{question:'如何准备就诊资料？'});
  assert.equal(client.state.runs[reply.run_id].workflow,'chat');
  assert.match(reply.answer,/你想先整理哪些就诊资料/);assert.notEqual(reply.answer,'如何准备就诊资料？');
  assert.equal(bridge.snapshot().cardVersion,0);assert.equal(client.state.profile.facts.length,0);
  assert.equal(bridge.snapshot().records.length,0);assert.equal(reply.runtime.mode,'fixture');
  const peer=new NativeBridge(client);await peer.refresh();assert.ok(peer.snapshot().sessions.some(s=>s.messages.some(m=>m.role==='assistant'&&m.text===reply.answer)),'another device rebuilds the reply from the backend, without the original browser draft');
  const next=await bridge.requestAgent('/api/health-assistant',{question:'我想先核对原话。',messages:[{role:'user',source_id:reply.source_id}]});
  assert.equal(client.state.runs[reply.run_id].conversation_id,client.state.runs[next.run_id].conversation_id);
  await peer.refresh();assert.equal(peer.snapshot().sessions.filter(s=>s.messages.some(m=>m.source_id===reply.source_id)).length,1);assert.equal(peer.snapshot().sessions.find(s=>s.messages.some(m=>m.source_id===reply.source_id)).messages.length,4);
  client.state.runs={};assert.equal(peer.snapshot().sessions.filter(s=>s.messages.some(m=>m.source_id===reply.source_id)).length,1);assert.equal(peer.snapshot().sessions.find(s=>s.messages.some(m=>m.source_id===reply.source_id)).messages.length,4,'old result grouping does not depend on the latest run page');
});
test('a failed follow-up preserves its user message and retry state while older canonical replies refresh',async t=>{
  const sometimes={mode:'fixture',async run(input){const text=input.tools.healththread_read_source({source_id:input.run.source_ids[0]}).source.text;if(text==='第二轮问题。')throw Object.assign(new Error('fixture failure'),{code:'DEPENDENCY_UNAVAILABLE'});return agent.run(input);}};
  const {bridge}=await setup(t,sometimes);const first=await bridge.requestAgent('/api/health-assistant',{question:'第一轮问题。'});
  let state=bridge.snapshot(),session=state.sessions[0];state.activeSessionId=session.id;session.messages.push({role:'user',text:'第二轮问题。'});bridge.saveOverlay(state);
  await assert.rejects(bridge.requestAgent('/api/health-assistant',{question:'第二轮问题。',messages:[{role:'user',source_id:first.source_id}]}));
  state=bridge.snapshot();session=state.sessions.find(s=>s.id===session.id);assert.equal(session.messages.at(-1).text,'第二轮问题。');assert.ok(session.messages.at(-1).source_id);
  session.failedQuestion='第二轮问题。';session.messages.push({role:'assistant',text:'失败原话保留',error:true});bridge.saveOverlay(state);await bridge.refresh();
  session=bridge.snapshot().sessions.find(s=>s.id===session.id);assert.equal(session.failedQuestion,'第二轮问题。');assert.equal(session.messages.at(-2).text,'第二轮问题。');assert.equal(session.messages.at(-1).error,true);
});
test('chat stage rejects invented patient claims just as the doctor-card stage does',async t=>{
  const inventing={mode:'fixture',async run({run,tools}){const{source,sentence_spans}=await tools.healththread_read_source({source_id:run.source_ids[0]});await tools.healththread_retrieve_context({});return tools.healththread_stage_result({kind:'assistant_reply',operation_key:'invented-chat-output',dependencies:[{source_id:source.id,source_text_version:1}],payload:{intent:'clarify',speech:'已确诊胃病。',questions:[],unknowns:[],claims:[{text:'已确诊胃病。',fact_refs:[],evidence:sentence_spans}]}});}};
  const {bridge,client}=await setup(t,inventing);await assert.rejects(bridge.requestAgent('/api/health-assistant',{question:'想准备就诊资料。'}));assert.equal(client.state.results.length,0);assert.equal(client.state.profile.facts.length,0);
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
test('text correction replaces the chosen fact and keeps original source and other facts',async t=>{
  const {bridge,client}=await setup(t);const receipt=await bridge.createEntry('目前头痛。\n目前恶心。');await bridge.wait(receipt.run_id);let review=await bridge.review(receipt.source_id);await bridge.confirm(receipt.source_id,review.proposals.map(p=>p.id));
  const fact=client.state.profile.facts.find(f=>f.value==='目前恶心。');
  assert.equal(typeof bridge.editRecord,'function');
  const edit=await bridge.editRecord(receipt.source_id,'更正：目前没有恶心。',fact.fact_id,fact.revision);review=await bridge.review(edit.source_id);
  await bridge.confirm(edit.source_id,review.proposals.map(p=>p.id),review.review_revision,review.id);
  assert.equal(client.state.profile.facts.find(f=>f.fact_id===fact.fact_id).value,'更正：目前没有恶心。');assert.ok(client.state.profile.facts.some(f=>f.value==='目前头痛。'));assert.equal((await client.source(receipt.source_id)).text,'目前头痛。\n目前恶心。');
});
test('editing a pending correction withdraws its old candidate atomically and confirms only the new text',async t=>{
  const {bridge,client}=await setup(t);const entry=await bridge.createEntry('目前头痛。');await bridge.wait(entry.run_id);let review=await bridge.review(entry.source_id);await bridge.confirm(entry.source_id,review.proposals.map(p=>p.id));
  const fact=client.state.profile.facts[0];const first=await bridge.editRecord(entry.source_id,'更正：目前没有头痛。',fact.fact_id,fact.revision);
  const second=await bridge.editRecord(first.source_id,'更正：目前偶有头痛。');assert.equal((await client.factChange(first.fact_change_id)).status,'expired');
  review=await bridge.review(second.source_id);await bridge.confirm(second.source_id,review.proposals.map(p=>p.id));assert.equal(client.state.profile.facts[0].value,'更正：目前偶有头痛。');
});
