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
test('report-only original citations are loaded without requiring a visible document or extracted fact',async t=>{
 const {app,client,bridge}=await setup(t);
 const owner=client.state.user.id;
 const original=app.store.insert(owner,'source',{kind:'medical_document',input_kind:'image_transcript',text:'2025年门诊记录：体温38.1℃。',text_version:1,pages:[]});
 app.store.insert(owner,'health_overview',{format_version:2,status:'current',summary:'已有一份历史门诊资料，近期情况尚未记录。',problems:[],background:[{summary:'2025年门诊记录：体温38.1℃。',source_ids:[original.id]}],uncertainties:[],source_ids:[original.id],source_versions:[{source_id:original.id,source_text_version:1}],profile_revision:client.state.profile.profile_revision,updated_at:app.store.now()});
 await bridge.refresh();
 assert.equal(client.state.timeline.entries.length,0);assert.equal(client.state.documents.documents.length,0);assert.equal(client.state.profile.facts.length,0);
 assert.equal(bridge.sources.get(original.id)?.text,'2025年门诊记录：体温38.1℃。');
 await bridge.refresh();assert.equal(bridge.sources.get(original.id)?.text,'2025年门诊记录：体温38.1℃。');
 await client.deleteData(original.id);await bridge.refresh();assert.equal(bridge.sources.has(original.id),false);
});
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
test('native projection drops cached fact history immediately when the account changes',async t=>{
  const {bridge,client}=await setup(t);const entry=await bridge.createEntry('账号甲的合成记录。');await bridge.wait(entry.run_id);let review=await bridge.review(entry.source_id);await bridge.confirm(entry.source_id,review.proposals.map(p=>p.id));
  const fact=client.state.profile.facts[0];const edit=await bridge.editRecord(entry.source_id,'账号甲的更正内容。',fact.fact_id,fact.revision);review=await bridge.review(edit.source_id);await bridge.confirm(edit.source_id,review.proposals.map(p=>p.id));assert.equal(bridge.snapshot().factHistory.length,1);
  client.invalidate('external-session');assert.equal(bridge.snapshot().factHistory.length,0);assert.equal(bridge.sources.size,0);
});
test('an old refresh cannot repopulate bridge caches after logout',async t=>{
  const {bridge,client}=await setup(t);const original=client.exportData.bind(client);let entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve);
  client.exportData=async()=>{const result=await original();entered();await gate;return result;};bridge.historyRevision=null;
  const pending=bridge.refresh();await started;client.invalidate('external-session');release();await assert.rejects(pending,e=>e.code==='SESSION_CHANGED');assert.equal(bridge.history.length,0);assert.equal(bridge.sources.size,0);
});
test('old-account page data cannot be saved into a different account with the same scope number',async t=>{
  const {bridge,client}=await setup(t);const old=bridge.snapshot();old.sessions=[{id:'old-private-session',messages:[{text:'旧账号合成内容'}]}];
  client.invalidate('external-session');client.state.user={id:'different-owner'};client.sessionEpoch='different-session';client.scopeEpoch=old._domainEpoch;
  assert.throws(()=>bridge.saveOverlay(old),e=>e.code==='LOCAL_DRAFT_EXPIRED');assert.equal(client.getDraft('nativeUi',{}).sessions,undefined);
});

test('confirmed correction provenance does not duplicate current records or hide independent entries',async t=>{
  const recordAgent={...agent,async run(input){
    if(!input.run.record_thread_id)return agent.run(input);
    const {tools,run}=input,{source}=await tools.healththread_read_source({source_id:run.source_ids[0]});
    const context=await tools.healththread_retrieve_context({});
    return tools.healththread_stage_candidates({base_profile_revision:context.snapshot_revision,operation_key:'native-record-dedup-fixture',candidates:sentenceSpans(source).map(e=>({field:'reported_text',value:e.quote,assertion:classifySourceMarkers(e.quote).assertion,temporal_scope:classifySourceMarkers(e.quote).temporal_scope,effective_time:literalSourceTime(e.quote,source.id),evidence:[e],proposal_kind:'new'})),record_dialogue:{questions:[],missing_fields:[]}});
  }};
  const {bridge}=await setup(t,recordAgent);
  const original=await bridge.recordTurn('目前头痛。');await bridge.wait(original.run_id);
  let review=await bridge.review(original.source_id);await bridge.confirm(original.source_id,review.proposals.map(p=>p.id));
  const independent=await bridge.createEntry('更正：目前没有头痛。');await bridge.wait(independent.run_id);
  const document=await bridge.createDocument({text:'医嘱：每日记录症状。',name:'保留病历'});await bridge.wait(document.run_id);
  const correctionIds=[];
  for(const text of ['更正：目前没有头痛。','再次更正：目前偶有头痛。']){
    const fact=bridge.snapshot().records.find(r=>r.id===original.source_id).facts[0];
    const edit=await bridge.editRecord(original.source_id,text,fact.fact_id,fact.revision);correctionIds.push(edit.source_id);
    assert.ok(bridge.snapshot().records.some(r=>r.id===edit.source_id),'pending corrections remain accessible');
    review=await bridge.review(edit.source_id);await bridge.confirm(edit.source_id,review.proposals.map(p=>p.id));
    const state=bridge.snapshot();
    assert.deepEqual(new Set(state.records.map(r=>r.id)),new Set([original.source_id,independent.source_id]));
    assert.equal(state.records.find(r=>r.id===original.source_id).summary,text);
    assert.equal(state.records.find(r=>r.id===original.source_id).text,'目前头痛。');
    assert.ok(state.documents.some(d=>d.source_id===document.source_id));
    assert.equal(state.factHistory.at(-1).newValue,text);
    for(const id of correctionIds)assert.ok(bridge.sources.has(id),'correction source provenance is retained');
  }
});

const conversationVisitAgent={...agent,async run(input){
  if(input.run.workflow!=='visit')return agent.run(input);
  const {source}=await input.tools.healththread_read_source({source_id:input.run.source_ids[0]});await input.tools.healththread_retrieve_context({});
  const claims=sentenceSpans(source).map(e=>({text:e.quote,evidence:[e],fact_refs:[]}));
  return input.tools.healththread_stage_result({kind:'visit_preparation',operation_key:input.run.id,dependencies:[{source_id:source.id,source_text_version:1}],payload:{speech:claims.map(c=>c.text).join('\n'),claims,questions:['需要带哪些资料？'],unknowns:['用药情况待补充']}});
}};
test('home conversation generates a card with every turn and regenerates without a local form',async t=>{
  const {bridge,client}=await setup(t,conversationVisitAgent);let last;
  for(const question of ['我准备去看医生。','目前没有头痛。','已经三天了。','饭后更明显。','睡眠不受影响。','没有用药。','没有过敏史。','想问需要带什么资料。'])last=await bridge.requestAgent('/api/health-assistant',{question,messages:last?[{role:'user',source_id:last.source_id}]:[]});
  const session=bridge.snapshot().sessions.find(s=>s.messages.some(m=>m.source_id===last.source_id));
  await bridge.generateVisit(session.id);let state=bridge.snapshot();assert.match(state.cardDraft,/目前没有头痛/);assert.match(state.cardDraft,/没有过敏史/);assert.match(state.cardDraft,/饭后更明显/);assert.equal(state.cardUnknowns[0],'用药情况待补充');assert.equal(state.sessions.length,1,'generated context must not create a duplicate conversation');
  const peer=new NativeBridge(client);await peer.refresh();assert.equal(peer.snapshot().currentConcern,'');await peer.regenerateVisit();state=peer.snapshot();assert.match(state.cardDraft,/目前没有头痛/);assert.match(state.cardDraft,/想问需要带什么资料/);
});
test('saved patient card edits survive a new bridge and conflict instead of silently overwriting',async t=>{
  const {bridge,client}=await setup(t,conversationVisitAgent);await bridge.requestAgent('/api/visit-preparations',{current_concern:'目前没有头痛。'});const before=bridge.snapshot();
  await bridge.saveCardEdit(before.cardResultId,'我想说明：目前没有头痛。',['哪些资料需要带？'],before.cardEditRevision);
  const peer=new NativeBridge(client);await peer.refresh();const state=peer.snapshot();assert.equal(state.cardDraft,'我想说明：目前没有头痛。');assert.deepEqual(state.questions,['哪些资料需要带？']);assert.equal(state.cardEditRevision,1);assert.match(peer.copyText(),/哪些资料需要带/);assert.match(peer.copyText(),/目前没有头痛/);
  await assert.rejects(bridge.saveCardEdit(before.cardResultId,'旧页面覆盖。',[],0),e=>e.code==='REVISION_CONFLICT');assert.equal(peer.snapshot().cardDraft,'我想说明：目前没有头痛。');assert.equal(client.state.profile.facts.length,0);
});
test('no conversation or card produces a useful error without submitting an empty visit',async t=>{
  const {bridge,requests}=await setup(t);await assert.rejects(bridge.generateVisit('missing'),e=>e.code==='NO_VISIT_CONVERSATION');await assert.rejects(bridge.regenerateVisit(),e=>e.code==='NO_CARD');assert.equal(requests.filter(r=>r.path==='/api/visit-preparations'&&r.method==='POST').length,0);
});
test('canonical chat projection keeps the active local session while source cache is catching up',async t=>{
 const {bridge}=await setup(t);let state=bridge.snapshot();state.sessions=[{id:'local-active',title:'就诊对话',messages:[{role:'user',text:'准备就诊。'}],updatedAt:new Date().toISOString()}];state.activeSessionId='local-active';bridge.saveOverlay(state);
 await bridge.requestAgent('/api/health-assistant',{question:'准备就诊。'});bridge.sources.clear();
 state=bridge.snapshot();assert.equal(state.activeSessionId,'local-active');assert.ok(state.sessions.some(s=>s.id==='local-active'&&s.messages.some(m=>m.role==='assistant')));
});
test('direct concern cards do not attach an unrelated local conversation',async t=>{
 const {bridge}=await setup(t,conversationVisitAgent);const state=bridge.snapshot();state.sessions=[{id:'unrelated',messages:[{role:'user',text:'其他记录。'}]}];bridge.saveOverlay(state);
 await bridge.requestAgent('/api/visit-preparations',{current_concern:'准备就诊。'});const card=bridge.snapshot();assert.equal(card.cardConversationId,card.cardSourceId);assert.notEqual(card.cardConversationId,'unrelated');
});
test('a failed unsaved followup cannot be silently omitted from an existing conversation card',async t=>{
 const {bridge,requests}=await setup(t,conversationVisitAgent);await bridge.requestAgent('/api/health-assistant',{question:'准备就诊。'});const state=bridge.snapshot(),session=state.sessions[0];session.messages.push({role:'user',text:'这条信息尚未提交成功。'});state.activeSessionId=session.id;bridge.saveOverlay(state);
 await assert.rejects(bridge.generateVisit(session.id),e=>e.code==='CONVERSATION_NOT_READY');assert.equal(requests.filter(r=>r.path==='/api/visit-preparations'&&r.method==='POST').length,0);
});
test('an existing stale card can be edited and reopened without clearing provenance warnings',async t=>{
 const {bridge,client,app}=await setup(t,conversationVisitAgent);await bridge.requestAgent('/api/visit-preparations',{current_concern:'原来向医生说明的内容。'});
 const before=bridge.snapshot();app.store.invalidate(client.state.user.id,r=>r.id===before.cardResultId,'stale');await bridge.refresh();assert.equal(bridge.snapshot().cardSourceDeleted,true);
 await bridge.saveCardEdit(before.cardResultId,'患者重新修改的表达。',['补充询问的问题？'],0);
 const peer=new NativeBridge(client);await peer.refresh();assert.equal(peer.snapshot().cardDraft,'患者重新修改的表达。');assert.deepEqual(peer.snapshot().questions,['补充询问的问题？']);assert.equal(peer.snapshot().cardSourceDeleted,true);assert.equal(peer.snapshot().cardEditRevision,1);assert.equal(client.state.profile.facts.length,0);assert.match(peer.copyText(),/已过期/);
});

const conversationalCardAgent=(visit)=>({mode:'fixture',async run(input){
  if(input.run.workflow==='visit')return visit(input);
  const {source,sentence_spans}=await input.tools.healththread_read_source({source_id:input.run.source_ids[0]});await input.tools.healththread_retrieve_context({});
  return input.tools.healththread_stage_result({kind:'assistant_reply',operation_key:input.run.id,dependencies:[{source_id:source.id,source_text_version:1}],payload:{intent:source.text==='同意生成。'?'confirm_visit':'offer_visit',speech:source.text,questions:[],unknowns:[],claims:[{text:source.text,evidence:sentence_spans,fact_refs:[]}]}});
}});
test('confirmed chat projects pending and completed cards across a clean client reload without duplicate generation',async t=>{
  let started,release;const running=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  const selected=conversationalCardAgent(async input=>{started();await gate;return conversationVisitAgent.run(input);});
  const {bridge,client,transport,requests}=await setup(t,selected);t.after(()=>release());
  const offer=await bridge.requestAgent('/api/health-assistant',{question:'请整理健康报告。'});assert.match(offer.answer,/确认/);assert.equal(offer.action,null);
  let progress,progressReady;const progressReceived=new Promise(resolve=>progressReady=resolve);const pending=bridge.requestAgent('/api/health-assistant',{question:'同意生成。',messages:[{role:'user',source_id:offer.source_id}]},{onProgress:message=>{progress=message;progressReady();}});
  await running;await progressReceived;await bridge.refresh();assert.match(progress.text,/正在生成/);
  let session=bridge.snapshot().sessions[0];assert.match(session.messages.at(-1).text,/正在生成/);assert.equal(session.messages.at(-1).action,null);
  const peerClient=new DomainClient({fetchImpl:transport,storage:new MemoryStorage(),channel:null,pollMs:1});t.after(()=>peerClient.dispose());await peerClient.initialize();const peer=new NativeBridge(peerClient);await peer.refresh();
  assert.match(peer.snapshot().sessions[0].messages.at(-1).text,/正在生成/);
  release();const reply=await pending;assert.equal(reply.action,'card');assert.ok(reply.visit_result_id);assert.match(reply.answer,/已生成/);
  await peer.refresh();session=peer.snapshot().sessions[0];assert.equal(session.messages.length,4);assert.equal(session.messages.at(-1).visit_result_id,reply.visit_result_id);assert.equal(session.messages.at(-1).action,'card');
  assert.equal(Object.values(client.state.runs).filter(run=>run.workflow==='visit').length,1);assert.equal(requests.filter(request=>request.path==='/api/visit-preparations'&&request.method==='POST').length,0);
  client.state.runs={};await bridge.refresh();assert.equal(bridge.snapshot().sessions[0].messages.at(-1).visit_result_id,reply.visit_result_id);
});
test('child card failure survives reload as a conversation retry prompt without marking the confirmed chat failed',async t=>{
  const selected=conversationalCardAgent(async()=>{throw Object.assign(new Error('provider internal details'),{code:'DEPENDENCY_UNAVAILABLE'});});
  const {bridge,client}=await setup(t,selected);const offer=await bridge.requestAgent('/api/health-assistant',{question:'请整理健康报告。'});
  const reply=await bridge.requestAgent('/api/health-assistant',{question:'同意生成。',messages:[{role:'user',source_id:offer.source_id}]});
  assert.equal(reply.action,null);assert.equal(reply.visit_result_id,undefined);assert.match(reply.answer,/未完成/);assert.match(reply.answer,/重试生成沟通卡/);assert.doesNotMatch(reply.answer,/provider internal/);
  const peer=new NativeBridge(client);await peer.refresh();const last=peer.snapshot().sessions[0].messages.at(-1);assert.match(last.text,/未完成/);assert.equal(last.error,undefined);assert.equal(peer.snapshot().cardVersion,0);
});
test('opening a historical card uses its exact saved content for reading copying and regeneration',async t=>{
  const {bridge}=await setup(t,conversationVisitAgent);
  const first=await bridge.requestAgent('/api/visit-preparations',{current_concern:'第一份就诊说明。'});const firstId=bridge.snapshot().cardResultId;
  await bridge.requestAgent('/api/visit-preparations',{current_concern:'第二份就诊说明。'});assert.notEqual(bridge.snapshot().cardResultId,firstId);
  bridge.saveOverlay({...bridge.snapshot(),selectedCardResultId:firstId});assert.equal(bridge.snapshot().cardDraft,first.speech);assert.match(bridge.copyText(),/第一份/);assert.doesNotMatch(bridge.copyText(),/第二份/);
  await bridge.regenerateVisit();assert.notEqual(bridge.snapshot().cardResultId,firstId);assert.match(bridge.snapshot().cardDraft,/第一份/);
});
test('accepted follow-up stays visible during polling before the source cache catches up',async t=>{
  let release,polled;const gate=new Promise(resolve=>release=resolve),seen=new Promise(resolve=>polled=resolve);
  const delayed={mode:'fixture',async run(input){if(input.tools.healththread_read_source({source_id:input.run.source_ids[0]}).source.text==='第二轮尚在生成。')await gate;return agent.run(input);}};
  const {bridge,client}=await setup(t,delayed);const first=await bridge.requestAgent('/api/health-assistant',{question:'第一轮已完成。'});
  const reloaded=new NativeBridge(client);await reloaded.refresh();const state=reloaded.snapshot(),session=state.sessions[0];state.activeSessionId=session.id;session.messages.push({role:'user',text:'第二轮尚在生成。'});reloaded.saveOverlay(state);
  const unsubscribe=client.subscribe(event=>{if(event.type==='run'&&event.run.id!==first.run_id&&event.run.status==='running')polled(reloaded.snapshot());});
  const pending=reloaded.requestAgent('/api/health-assistant',{question:'第二轮尚在生成。',messages:[{role:'user',source_id:first.source_id}]});
  let during;
  try{during=await seen;}finally{release();await pending;unsubscribe();}
  assert.equal(during.sessions.find(item=>item.id===session.id).messages.at(-1).text,'第二轮尚在生成。');
});
test('reload during historical-card regeneration selects that new result after server completion',async t=>{
  let hold=false,started,release;const running=new Promise(resolve=>started=resolve),gate=new Promise(resolve=>release=resolve);
  const delayed={...conversationVisitAgent,async run(input){if(hold&&input.run.workflow==='visit'){started();await gate;}return conversationVisitAgent.run(input);}};
  const {bridge,client,app}=await setup(t,delayed);
  await bridge.requestAgent('/api/visit-preparations',{current_concern:'历史卡片内容。'});const original=bridge.snapshot().cardResultId;
  await bridge.requestAgent('/api/visit-preparations',{current_concern:'另一个历史卡片。'});const other=bridge.snapshot().cardResultId;
  bridge.saveOverlay({...bridge.snapshot(),selectedCardResultId:original});hold=true;
  const pending=bridge.regenerateVisit();await running;
  // Simulate a closed page: its waiter can no longer update the selected card.
  const peer=new NativeBridge(client);await peer.refresh();const during=peer.snapshot();
  try{assert.equal(during.cardRegenerationPending,true);assert.equal(during.cardResultId,original);}finally{release();await pending;}
  await app.jobs.drain();
  // Restore the accepted pending draft, as a reloaded browser would have it.
  peer.saveOverlay(during);await peer.refresh();const restored=peer.snapshot();
  assert.notEqual(restored.cardResultId,original);assert.equal(restored.cardRegenerationPending,false);
  assert.equal(restored.selectedCardResultId,restored.cardResultId);assert.equal(restored.cardRegeneration,null);
  peer.saveOverlay({...during,selectedCardResultId:other});await peer.refresh();assert.equal(peer.snapshot().cardResultId,other,'completion preserves a historical card intentionally opened after regeneration began');
});

test('a pending first chat survives a clean reload without becoming a health record',async t=>{
 let release;const gate=new Promise(resolve=>release=resolve);const delayed={...agent,async run(input){await gate;return agent.run(input);}};
 const {client,bridge}=await setup(t,delayed);t.after(()=>release());
 const accepted=await client.createChat('有点不舒服。');
 try{const peer=new NativeBridge(client);await peer.refresh();const session=peer.snapshot().sessions.find(s=>s.conversation_id===client.state.runs[accepted.run_id]?.conversation_id);
 assert.ok(session);assert.equal(session.messages[0].text,'有点不舒服。');assert.equal(session.messages[0].source_id,accepted.source_id);}
 finally{release();await bridge.wait(accepted.run_id);}
});

test('v2 both action preserves independent completed card and pending record across a clean reload',async t=>{
 let release,started;const gate=new Promise(resolve=>release=resolve),running=new Promise(resolve=>started=resolve);
 const selected={mode:'fixture',async run(input){
  if(input.run.workflow==='visit')return conversationVisitAgent.run(input);
  if(input.run.workflow==='entry'){started();await gate;const stage=input.tools.healththread_stage_candidates;return agent.run({...input,tools:{...input.tools,healththread_stage_candidates:args=>stage({...args,record_dialogue:{summary:'你描述了饭后腹胀。',questions:[],missing_fields:[]}})}});}
  const {source}=await input.tools.healththread_read_source({source_id:input.run.source_ids[0]});const context=await input.tools.healththread_retrieve_context({});
  const confirming=source.text==='两个都帮我准备好。';
  return input.tools.healththread_stage_result({kind:'assistant_reply',operation_key:input.run.id,dependencies:[{source_id:source.id,source_text_version:1}],payload:{format_version:2,speech:'',intent:confirming?'confirm_both':'offer_both',reply:confirming?'好，我来整理。':'饭后腹胀。要保存记录并整理沟通卡吗？',questions:[],unknowns:[],claims:[],...(confirming?{confirmation_offer_id:context.pending_offer.run_id,confirmation_quote:source.text,confirmation_has_new_details:false}:{})}});
 }};
 const {bridge,client,transport,requests}=await setup(t,selected);t.after(()=>release());
 const offer=await bridge.requestAgent('/api/health-assistant',{question:'饭后腹胀。'});assert.equal(offer.answer,'饭后腹胀。要保存记录并整理沟通卡吗？');assert.equal(bridge.snapshot().records.length,0);
 const pending=bridge.requestAgent('/api/health-assistant',{question:'两个都帮我准备好。',messages:[{role:'user',source_id:offer.source_id}]});await running;
 const peerClient=new DomainClient({fetchImpl:transport,storage:new MemoryStorage(),channel:null,pollMs:1});t.after(()=>peerClient.dispose());await peerClient.initialize();const peer=new NativeBridge(peerClient);
 try{
  await bridge.refresh();const parent=Object.values(client.state.runs).find(run=>run.continuation_record_run_id);assert.ok(parent);await bridge.wait(parent.continuation_run_id,{requireRuntime:true});await peer.refresh();
  const session=peer.snapshot().sessions.find(s=>s.conversation_id===parent.conversation_id&&!s.record_thread_id);const message=session.messages.at(-1);
  assert.equal(message.record_status,'saving');assert.equal(message.visit_status,'completed');assert.ok(message.visit_result_id);assert.equal(message.record_source_id,undefined);assert.equal(peerClient.state.profile.facts.length,0);
 }finally{release();await pending;}
 await peer.refresh();const message=peer.snapshot().sessions.find(s=>s.conversation_id&&!s.record_thread_id).messages.at(-1);assert.equal(message.record_status,'needs_review');assert.equal(message.visit_status,'completed');assert.ok(message.visit_result_id);assert.ok(message.record_source_id);assert.ok(peer.snapshot().records.some(record=>record.id===message.record_source_id));
 assert.equal(Object.values(client.state.runs).filter(run=>run.workflow==='entry').length,1);assert.equal(Object.values(client.state.runs).filter(run=>run.workflow==='visit').length,1);assert.equal(requests.filter(r=>['/api/health-record','/api/visit-preparations'].includes(r.path)&&r.method==='POST').length,0);
});

test('retrying a failed chat reuses its source and keeps the successful reply last after reload',async t=>{
 let attempts=0;const flaky={...agent,async run(input){if(++attempts===1)throw Object.assign(new Error('fixture failure'),{code:'DEPENDENCY_UNAVAILABLE'});return agent.run(input);}};
 const {bridge,client,requests}=await setup(t,flaky);await assert.rejects(bridge.requestAgent('/api/health-assistant',{question:'对，就是这些情况。'}));
 const failed=Object.values(client.state.runs).find(run=>run.workflow==='chat');
 const reply=await bridge.requestAgent('/api/health-assistant',{question:'对，就是这些情况。',retry_source_id:failed.source_ids[0]});
 assert.equal(reply.source_id,failed.source_ids[0]);assert.equal(requests.filter(r=>r.path==='/api/health-assistant'&&r.method==='POST').length,1);assert.equal(requests.filter(r=>r.path.endsWith('/retry')&&r.method==='POST').length,1);
 const peer=new NativeBridge(client);await peer.refresh();const session=peer.snapshot().sessions.find(s=>s.conversation_id===failed.conversation_id);
 assert.equal(session.messages.length,2);assert.equal(session.messages.at(-1).run_id,reply.run_id);assert.equal(session.messages.at(-1).text,reply.answer);
});
test('a historical failed turn appears before a later successful turn on clean reload',async t=>{
 let attempts=0;const flaky={...agent,async run(input){if(++attempts===1)throw Object.assign(new Error('fixture failure'),{code:'DEPENDENCY_UNAVAILABLE'});return agent.run(input);}};
 const {bridge,client}=await setup(t,flaky);await assert.rejects(bridge.requestAgent('/api/health-assistant',{question:'第一次问题。'}));const failed=Object.values(client.state.runs).find(run=>run.workflow==='chat');
 const reply=await bridge.requestAgent('/api/health-assistant',{question:'后来再问一次。',messages:[{role:'user',source_id:failed.source_ids[0]}]});
 const peer=new NativeBridge(client);await peer.refresh();const session=peer.snapshot().sessions.find(s=>s.conversation_id===failed.conversation_id);
 assert.equal(session.messages[0].text,'第一次问题。');assert.equal(session.messages.at(-1).run_id,reply.run_id);assert.equal(session.messages.at(-1).text,reply.answer);
});

test('direct authorized card retry updates the existing confirmation after reload without a new chat',async t=>{
 let attempts=0;const selected=conversationalCardAgent(async input=>{if(++attempts===1)throw Object.assign(new Error('temporary'),{code:'DEPENDENCY_UNAVAILABLE'});return conversationVisitAgent.run(input);});
 const {bridge,client,requests}=await setup(t,selected);const offer=await bridge.requestAgent('/api/health-assistant',{question:'准备沟通卡。'});const failed=await bridge.requestAgent('/api/health-assistant',{question:'同意生成。',messages:[{role:'user',source_id:offer.source_id}]});assert.ok(failed.visit_retry_run_id);
 const parent=structuredClone(client.state.runs[failed.run_id]);const receipt=await bridge.retryAssistantAction(failed.visit_retry_run_id);assert.ok(receipt.run_id);assert.equal(requests.filter(r=>r.path==='/api/health-assistant'&&r.method==='POST').length,2);
 const refresh=client.refresh.bind(client);client.refresh=async()=>{const state=await refresh();state.runs[parent.id]=parent;return state;};
 const peer=new NativeBridge(client);await peer.refresh();client.refresh=refresh;const message=peer.snapshot().sessions.find(s=>s.conversation_id===parent.conversation_id).messages.at(-1);assert.equal(message.visit_status,'completed');assert.ok(message.visit_result_id);assert.equal(message.visit_retry_run_id,undefined);assert.equal(message.run_id,parent.id);
});

test('card edits can correct or clear remaining questions and preserve them when omitted',async t=>{
 const {bridge,client}=await setup(t,conversationVisitAgent);await bridge.requestAgent('/api/visit-preparations',{current_concern:'就诊描述。'});let state=bridge.snapshot();assert.ok(state.cardUnknowns.length);
 await bridge.saveCardEdit(state.cardResultId,'修改后的表达。',[],0,['最近没有做过检查。']);const peer=new NativeBridge(client);await peer.refresh();state=peer.snapshot();assert.deepEqual(state.cardUnknowns,['最近没有做过检查。']);assert.match(peer.copyText(),/最近没有做过检查/);
 await bridge.saveCardEdit(state.cardResultId,'继续修改表达。',[],1);await peer.refresh();assert.deepEqual(peer.snapshot().cardUnknowns,['最近没有做过检查。']);
 await bridge.saveCardEdit(state.cardResultId,'最终表达。',[],2,[]);await peer.refresh();assert.deepEqual(peer.snapshot().cardUnknowns,[]);assert.doesNotMatch(peer.copyText(),/用药情况待补充|最近没有做过检查/);
});
test('native health profile supports old data without inventing structured observations',async t=>{
  const {bridge,client}=await setup(t);delete client.state.profile.health_profile;
  assert.equal(bridge.snapshot().healthProfile,null);
  client.state.profile.health_profile={observations:[{dimension:'symptom',value:'合成感受'}],current_problems:[],events:[],background:[],unknowns:[],conflicts:[]};
  assert.deepEqual(bridge.snapshot().healthProfile,client.state.profile.health_profile);
});
test('native reconciliation forwards explicit choices with exact viewed revisions',async t=>{
  const {bridge,client}=await setup(t);const receipt=await bridge.createEntry('本次合成记录。');await bridge.wait(receipt.run_id);const review=await bridge.review(receipt.source_id);
  let payload;client.confirm=async(id,ids,revision,extra)=>{payload={id,ids,revision,extra};return {};};
  const resolutions=[{candidate_id:review.proposals[0].id,fact_id:'old',revision:2,action:'defer'}];
  await bridge.confirm(receipt.source_id,[review.proposals[0].id],review.review_revision,review.id,resolutions);
  assert.deepEqual(payload.extra,{resolutions});
});
test('care feedback reopens as canonical conversation and never auto-confirms a health fact',async t=>{
 const {bridge,client,app}=await setup(t);const document=await bridge.createDocument({text:'医嘱：明日复诊。',name:'合成随访'});await bridge.wait(document.run_id);const review=await bridge.review(document.source_id);const confirmed=await bridge.confirm(document.source_id,review.proposals.map(p=>p.id));await bridge.wait(confirmed.continuation_run_id);
 const task=bridge.snapshot().tasks[0],before=client.state.profile.facts.length;
 const feedback=await bridge.feedbackTask(task.id,'我已记录今天的感受，还有问题想补充。',task.version);await bridge.wait(feedback.run_id);
 assert.equal(client.state.profile.facts.length,before);assert.equal(bridge.snapshot().tasks[0].text,'医嘱：明日复诊。');
 const peer=new NativeBridge(client);await peer.refresh();const chat=peer.snapshot().sessions.find(s=>s.conversation_id===feedback.conversation_id);assert.ok(chat);assert.equal(chat.messages[0].text,'我已记录今天的感受，还有问题想补充。');assert.equal(chat.messages[0].source_id,feedback.source_id);assert.equal(chat.messages[1].role,'assistant');
 const exported=await client.exportData();assert.ok(exported.care_feedback.some(f=>f.source_id===feedback.source_id&&f.instruction_refs[0].revision===task.instruction_refs[0].revision));assert.equal(client.state.tasks.tasks[0].status,'open');
});
test('native event state updates use captured version and preserve fact history',async t=>{
 const {bridge,client}=await setup(t);const entry=await bridge.createEntry('今天头痛。');await bridge.wait(entry.run_id);const review=await bridge.review(entry.source_id);await bridge.confirm(entry.source_id,review.proposals.map(p=>p.id));const event=bridge.snapshot().healthProfile.events[0],fact=client.state.profile.facts[0];
 await bridge.updateEpisode(event.id,'improved',event.version);assert.equal(bridge.snapshot().healthProfile.events[0].status,'improved');assert.deepEqual(client.state.profile.facts[0],fact);await assert.rejects(bridge.updateEpisode(event.id,'resolved',event.version),e=>e.status===409);
 const correction=await bridge.correctFact(fact.fact_id,fact.revision,'更正：今天没有头痛。');assert.ok(correction.source_id);assert.equal(client.state.profile.facts[0].value,fact.value);const pending=await bridge.review(correction.source_id);assert.ok(pending.proposals.length);
});
test('accepted document remains processing until its actual candidate checkpoint arrives',async t=>{
 let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const delayed={mode:'fixture',async run(input){entered();await gate;return agent.run(input)}};
 const {bridge}=await setup(t,delayed);const receipt=await bridge.createDocument({text:'医嘱：明日复诊。',name:'实际上传.txt'});await started;
 try{await bridge.refresh();const state=bridge.snapshot();assert.equal(state.medical.analysis,'running');assert.equal(state.medical.proposals.length,0);assert.equal(state.uploadState,'processing');}finally{release();}
 await bridge.wait(receipt.run_id);assert.equal(bridge.snapshot().uploadState,'parsed');assert.ok(bridge.snapshot().medical.proposals.length);
});
test('care plan retry preserves its source and rejects non-care or superseded attempts',async t=>{
 let failCare=true;const flaky={mode:'fixture',async run(input){if(input.run.workflow==='care_plan'&&failCare){failCare=false;throw Object.assign(new Error('synthetic failure'),{code:'DEPENDENCY_UNAVAILABLE'});}return agent.run(input)}};
 const {bridge,client,app}=await setup(t,flaky);const doc=await bridge.createDocument({text:'医嘱：明日复诊。',name:'合成医嘱'});await bridge.wait(doc.run_id);const review=await bridge.review(doc.source_id);const confirmation=await bridge.confirm(doc.source_id,review.proposals.map(p=>p.id));await app.jobs.drain();await bridge.refresh();assert.equal(typeof bridge.retryCarePlan,'function');assert.equal(client.state.runs[confirmation.continuation_run_id].status,'failed');
 await assert.rejects(bridge.retryCarePlan(doc.run_id),e=>e.code==='RUN_NOT_RETRYABLE');const receipt=await bridge.retryCarePlan(confirmation.continuation_run_id);assert.equal(receipt.source_id,doc.source_id);await bridge.wait(receipt.run_id);assert.equal(bridge.snapshot().tasks.length,1);await assert.rejects(bridge.retryCarePlan(confirmation.continuation_run_id),e=>e.code==='RUN_NOT_RETRYABLE');assert.equal((await client.exportData()).sources.length,1);
});
test('failed latest chat hydrates a same-source retry but older failure cannot retry after a new turn',async t=>{
 let failNext=true;const flaky={mode:'fixture',async run(input){if(input.run.workflow==='chat'&&failNext){failNext=false;throw Object.assign(new Error('fixture failure'),{code:'DEPENDENCY_UNAVAILABLE'});}return agent.run(input)}};
 const {bridge,client,requests}=await setup(t,flaky);await assert.rejects(bridge.requestAgent('/api/health-assistant',{question:'失败的合成问题。'}));const failed=Object.values(client.state.runs).find(r=>r.workflow==='chat');
 const peer=new NativeBridge(client);await peer.refresh();const restored=peer.snapshot().sessions.find(s=>s.conversation_id===failed.conversation_id);assert.equal(restored.messages.at(-1).chat_retry_run_id,failed.id);
 await peer.retryChatRun(failed.id);assert.equal((await client.exportData()).sources.length,1);assert.equal(requests.filter(r=>r.path==='/api/health-assistant'&&r.method==='POST').length,1);assert.equal(peer.snapshot().sessions.find(s=>s.conversation_id===failed.conversation_id).messages.at(-1).chat_retry_run_id,undefined);
 await assert.rejects(peer.retryChatRun(failed.id),e=>e.code==='RUN_NOT_RETRYABLE');
});
test('canonical failed chat retry is unavailable once a later turn exists or is running',async t=>{
 const {bridge,client}=await setup(t);client.state.runs={old:{id:'old',workflow:'chat',status:'failed',conversation_id:'conversation',source_ids:['first'],created_at:'2026-10-13T01:00:00Z'},next:{id:'next',workflow:'chat',status:'running',conversation_id:'conversation',source_ids:['second'],created_at:'2026-10-13T02:00:00Z'}};bridge.sources.set('first',{id:'first',text:'旧问题'});bridge.sources.set('second',{id:'second',text:'新问题'});
 const session=bridge.snapshot().sessions.find(s=>s.conversation_id==='conversation');assert.ok(session);assert.ok(session.messages.every(m=>!m.chat_retry_run_id));client.state.runs.next.status='completed';assert.ok(bridge.snapshot().sessions.find(s=>s.conversation_id==='conversation').messages.every(m=>!m.chat_retry_run_id));
});
