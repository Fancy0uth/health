import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sentenceSpans} from '../../services/api/source-validation.mjs';
import {fixturePdf} from './pdf-fixture.mjs';
import {createApp} from '../../services/api/domain-server.mjs';
let DomainClient, MemoryStorage;
try { ({DomainClient,MemoryStorage}=await import('../../packages/client/domain-client.js')); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND') throw e; }

// These are deliberately synthetic model outputs, exercising HTTP/client behaviour only.
const fixtureAgent = {mode:'fixture', async run({run, tools}) {
  const {source} = await tools.healththread_read_source({source_id:run.source_ids[0]});
  const context = await tools.healththread_retrieve_context({});
  const evidence = {source_id:source.id, source_text_version:1, locator:{page:null,start:0,end:source.text.length},quote:source.text};
  if (run.workflow === 'visit') return tools.healththread_stage_result({kind:'visit_preparation',operation_key:'client-fixture-result-key',dependencies:[{source_id:source.id,source_text_version:1}],payload:{speech:source.text,questions:['还需要哪些就诊资料？'],unknowns:['未记录其他资料'],claims:[{text:source.text,evidence:[evidence],fact_refs:[]}]}});
  if (run.workflow === 'care_plan') {
    const {instructions} = await tools.healththread_get_confirmed_instructions({document_id:run.document_id});
    return tools.healththread_stage_result({kind:'care_plan',operation_key:'client-fixture-care-key',dependencies:instructions.map(f=>({fact_id:f.fact_id,revision:f.revision})),payload:{tasks:instructions.map(f=>({text:f.value,schedule:null,instruction_refs:[{fact_id:f.fact_id,revision:f.revision}]})),explanation:'合成测试'}});
  }
  return tools.healththread_stage_candidates({base_profile_revision:context.snapshot_revision,operation_key:'client-fixture-candidates-key',candidates:sentenceSpans(source).map(span=>({field:run.workflow==='document'?'instruction':'reported_text',value:span.quote,assertion:'affirmed',temporal_scope:'unknown',effective_time:{raw:null,precision:'unknown',start:null,end:null,timezone:null,anchor_source_id:source.id},evidence:[span],proposal_kind:'new'}))});
}};
async function setup(t,{agent=fixtureAgent}={}) {
  assert.ok(DomainClient, 'shared authenticated domain client is required');
  const dir=await mkdtemp(join(tmpdir(),'ht-client-'));
  const app=createApp({dbPath:join(dir,'db.sqlite'),demoAccounts:[{username:'alice',password:'alice-password'},{username:'bob',password:'bob-password'}],agent});
  await app.listen(0); const base=`http://127.0.0.1:${app.server.address().port}`;
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const jar={cookie:''};
  const transport=async(path,options={})=>{
    const response=await fetch(base+path,{...options,headers:{...options.headers,Origin:base,Cookie:jar.cookie}});
    const cookie=response.headers.get('set-cookie'); if(cookie) jar.cookie=cookie.split(';')[0];
    return response;
  };
  const make=(fetchImpl=transport)=>new DomainClient({fetchImpl,storage:new MemoryStorage(),channel:null,pollMs:1});
  const a=make(),b=make(); t.after(()=>{a.dispose();b.dispose();});
  await a.initialize(); await a.login('alice','alice-password'); await a.setConsent(true); await b.initialize();
  return {app,a,b,make,transport};
}
test('two independent authenticated clients share sources and review with CAS, never a whole-state writer',async t=>{
  const {app,a,b}=await setup(t); a.setDraft('record','第一条。'); b.setDraft('record','未聚焦也保留的编辑');
  const first=await a.createEntry('第一条。'); await app.jobs.drain(); const run=await a.pollRun(first.run_id);
  assert.equal(run.status,'needs_review'); assert.equal(a.state.profile.facts.length,0);
  await b.refresh(); assert.equal(b.state.timeline.entries[0].source.text,'第一条。'); assert.equal(b.getDraft('record'),'未聚焦也保留的编辑');
  const change=await b.factChange(run.fact_change_id); await b.confirm(change.id,[change.proposals[0].id],change.base_profile_revision);
  await a.refresh(); assert.equal(a.state.profile.facts[0].value,'第一条。');
});
test('lost acceptance response retains original payload/key and explicit retry produces only one source',async t=>{
  const {app,a,make,transport}=await setup(t); let lose=true;
  const client=make(async(path,options)=>{const response=await transport(path,options);if(path==='/api/entries'&&lose){lose=false;throw new TypeError('connection lost after commit');}return response;});t.after(()=>client.dispose());await client.initialize();
  client.setDraft('record','原始输入。'); await assert.rejects(client.createEntry('原始输入。'),e=>e.code==='OUTCOME_UNKNOWN');
  const op=client.pendingOperations()[0];assert.equal(op.state,'unknown');assert.equal(op.body.text,'原始输入。');
  client.setDraft('record','等待期间修改的文字');await assert.rejects(client.createEntry('等待期间修改的文字'),e=>e.code==='UNRESOLVED_OPERATION');
  const accepted=await client.retryOperation(op.id);await app.jobs.drain();assert.equal((await client.source(accepted.source_id)).text,'原始输入。');assert.equal(client.getDraft('record'),'等待期间修改的文字');assert.equal((await a.refresh()).timeline.entries.length,1);
});
test('account changed in another tab cannot resubmit old unknown payload with new CSRF',async t=>{
  const {a,b,make,transport}=await setup(t);let lose=true;
  const old=make(async(path,options)=>{const response=await transport(path,options);if(path==='/api/entries'&&lose){lose=false;throw new TypeError('lost');}return response;});t.after(()=>old.dispose());await old.initialize();
  await assert.rejects(old.createEntry('账号 A 原文。'));const op=old.pendingOperations()[0];
  await b.logout();await b.login('bob','bob-password');await b.setConsent(true);
  await assert.rejects(old.retryOperation(op.id),e=>e.code==='SESSION_CHANGED');assert.equal(old.state.user,null);assert.equal(old.pendingOperations().length,0);
  await b.refresh();assert.equal(b.state.timeline.entries.length,0);await a.refresh().catch(()=>{});
});
test('late GET after session epoch invalidation cannot restore cleared profile or drafts',async t=>{
  const {make,transport}=await setup(t);let resolve,started;const waiting=new Promise(r=>started=r);
  const client=make(async(path,options)=>{const response=await transport(path,options);if(path==='/api/profile'&&resolve===undefined){started();await new Promise(r=>resolve=r);}return response;});t.after(()=>client.dispose());
  // Establish identity without the blocked refresh.
  await client.bootstrapIdentity();client.setDraft('record','草稿');const refresh=client.refresh();await waiting;
  client.invalidate('external-session');resolve();await assert.rejects(refresh,e=>e.code==='SESSION_CHANGED');assert.equal(client.state.user,null);assert.equal(client.getDraft('record'),'');
});
test('stale review keeps selected proposal IDs; reanalyse saved source and reject use current revision',async t=>{
  const {app,a,b}=await setup(t);const one=await a.createEntry('第一条。');const two=await b.createEntry('第二条。');await app.jobs.drain();const r1=await a.pollRun(one.run_id),r2=await b.pollRun(two.run_id);const c1=await a.factChange(r1.fact_change_id),c2=await b.factChange(r2.fact_change_id);
  b.setDraft('selection:'+c2.id,[c2.proposals[0].id]);await a.confirm(c1.id,[c1.proposals[0].id],1);
  await assert.rejects(b.confirm(c2.id,[c2.proposals[0].id],1),e=>e.status===409);assert.deepEqual(b.getDraft('selection:'+c2.id),[c2.proposals[0].id]);
  await b.refresh();const fresh=await b.reanalyse(r2.id,b.state.profile.profile_revision);assert.equal(fresh.source_id,two.source_id);await app.jobs.drain();const r=await b.pollRun(fresh.run_id);await b.reject(r.fact_change_id,b.state.profile.profile_revision);assert.equal((await b.refresh()).timeline.entries.length,2);
});
test('document confirmation queues continuation, multiple versioned care tasks are shared and stale updates fail',async t=>{
  const {app,a,b}=await setup(t);const accepted=await a.createDocument({text:'医嘱：复诊时携带报告。医嘱：记录每天感受。',name:'粘贴原文'});await app.jobs.drain();const run=await a.pollRun(accepted.run_id);const change=await a.factChange(run.fact_change_id);const confirmed=await a.confirm(change.id,change.proposals.map(p=>p.id),change.base_profile_revision);assert.ok(confirmed.continuation_run_id);await app.jobs.drain();const continued=await a.pollRun(confirmed.continuation_run_id);assert.equal(continued.status,'completed');await b.refresh();assert.equal(b.state.tasks.tasks.length,2);const task=b.state.tasks.tasks[0];assert.equal(task.text,'医嘱：复诊时携带报告。');await a.updateTask(task.id,'done',task.version);await assert.rejects(b.updateTask(task.id,'paused',task.version),e=>e.status===409);await b.refresh();assert.equal(b.state.tasks.tasks[0].status,'done');
});
test('blocked run has saved receipt; real deletion is partial and consent revocation invalidates callbacks',async t=>{
  const {app,a,b}=await setup(t,{agent:null});const receipt=await a.createEntry('模型未配置也保存。');await app.jobs.drain();const run=await a.pollRun(receipt.run_id);assert.equal(run.status,'blocked');assert.equal(run.saved_receipt.saved,true);
  const retry=await a.retryRun(run.id);assert.equal(retry.source_id,receipt.source_id);await app.jobs.drain();
  const deletion=await a.deleteData(receipt.source_id);assert.equal(deletion.status,'partial');assert.equal((await a.operation(deletion.deletion_job_id)).layers.sqlite.status,'deleted');await b.refresh();assert.equal(b.state.timeline.entries.length,0);
  await a.setConsent(false);await assert.rejects(a.createEntry('不能偷偷处理。'),e=>e.status===403);assert.equal(a.state.consents.consents[0].granted,false);
});
test('unknown operation survives reload in the same session and file retry requires exact original bytes',async t=>{
  const {make,transport}=await setup(t);const storage=new MemoryStorage();let lose=true;
  const client=new DomainClient({fetchImpl:async(path,options)=>{const result=await transport(path,options);if(path==='/api/entries'&&lose){lose=false;throw new TypeError('lost');}return result;},storage,channel:null});t.after(()=>client.dispose());await client.initialize();await assert.rejects(client.createEntry('刷新后仍用原请求。'));const first=client.pendingOperations()[0];client.dispose();
  const restored=new DomainClient({fetchImpl:transport,storage,channel:null});t.after(()=>restored.dispose());await restored.initialize();const op=restored.pendingOperations()[0];assert.equal(op.key,first.key);assert.equal(op.body.text,first.body.text);await restored.retryOperation(op.id);assert.equal((await restored.refresh()).timeline.entries.length,1);
  const fileA=new File([new Uint8Array([0xff])],'same.pdf',{type:'application/pdf'});const fileB=new File([new Uint8Array([0xfe])],'same.pdf',{type:'application/pdf'});assert.notEqual((await restored.fileMetadata(fileA)).sha256,(await restored.fileMetadata(fileB)).sha256);
});
test('source deletion in another tab invalidates a late read and all-data deletion clears local health drafts',async t=>{
  const {app,a,b,make,transport}=await setup(t);const source=await a.createEntry('删除前。');await app.jobs.drain();let release,started;const waiting=new Promise(r=>started=r);
  const client=make(async(path,options)=>{const response=await transport(path,options);if(path==='/api/sources/'+source.source_id){started();await new Promise(r=>release=r);}return response;});t.after(()=>client.dispose());await client.initialize();const late=client.source(source.source_id);await waiting;client.invalidateScope();release();await assert.rejects(late,e=>e.code==='SESSION_CHANGED');
  b.setDraft('record','尚未发送的资料');await b.deleteData('all');assert.equal(b.getDraft('record'),'');
});
test('consent revocation without broadcast blocks a late poll/read callback, preserving user draft',async t=>{
  const {app,a,b,make,transport}=await setup(t);const accepted=await a.createEntry('授权撤回前。');await app.jobs.drain();let release,started;const waiting=new Promise(r=>started=r);
  const client=make(async(path,options)=>{const response=await transport(path,options);if(path==='/api/runs/'+accepted.run_id){started();await new Promise(r=>release=r);}return response;});t.after(()=>client.dispose());await client.initialize();client.setDraft('record','另一段未聚焦编辑');const late=client.pollRun(accepted.run_id);await waiting;await b.setConsent(false);release();await assert.rejects(late,e=>e.code==='SESSION_CHANGED');assert.equal(client.getDraft('record'),'另一段未聚焦编辑');assert.equal(Object.keys(client.state.runs).length,0);
});
test('lost confirmation response replays the original selected IDs and CAS once, keeping later selection edits',async t=>{
  const {app,a,transport}=await setup(t);let lose=true;const client=new DomainClient({fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path.endsWith('/confirm')&&lose){lose=false;throw new TypeError('lost commit response');}return response;},storage:new MemoryStorage(),channel:null});t.after(()=>client.dispose());await client.initialize();
  const accepted=await client.createEntry('明确核对。');await app.jobs.drain();const run=await client.pollRun(accepted.run_id);const change=await client.factChange(run.fact_change_id);const ids=[change.proposals[0].id];client.setDraft('selection:'+change.id,ids);await assert.rejects(client.confirm(change.id,ids,1),e=>e.code==='OUTCOME_UNKNOWN');const original=client.pendingOperations()[0];client.setDraft('selection:'+change.id,[]);const receipt=await client.retryOperation(original.id);assert.equal(receipt.profile_revision,2);assert.deepEqual(client.getDraft('selection:'+change.id),[]);assert.deepEqual(original.body.accepted_change_ids,ids);await a.refresh();assert.equal(a.state.profile.facts.length,1);
});
test('broadcast logout immediately clears the peer account cache and ignores an old draft callback',async t=>{
  const {transport}=await setup(t);const channels=[];
  function channel() {const listeners=new Set();const entry={addEventListener(_type,fn){listeners.add(fn);},removeEventListener(_type,fn){listeners.delete(fn);},postMessage(data){for(const peer of channels) if(peer!==entry) for(const fn of peer.listeners) fn({data});},listeners,close(){listeners.clear();}};channels.push(entry);return entry;}
  const a=new DomainClient({fetchImpl:transport,storage:new MemoryStorage(),channel:channel()}),b=new DomainClient({fetchImpl:transport,storage:new MemoryStorage(),channel:channel()});t.after(()=>{a.dispose();b.dispose();});await a.initialize();await b.initialize();b.setDraft('record','旧会话编辑');await a.logout();assert.equal(b.state.user,null);assert.equal(b.getDraft('record'),'');assert.equal(b.csrf,null);assert.equal(b.state.profile.facts.length,0);
});
test('browser fetch transport receives Window/globalThis rather than the client as its receiver',async()=>{
  const client=new DomainClient({channel:null,storage:new MemoryStorage(),fetchImpl:function() {assert.equal(this,globalThis,'browser fetch receiver must be bound');return Promise.resolve({ok:true,json:async()=>({user:null})});}});
  await client.bootstrapIdentity();client.dispose();
});
test('actual PDF upload retains page locators and unknown upload retry verifies bytes before replay',async t=>{
  const {app,transport}=await setup(t);let lose=true;const storage=new MemoryStorage();const first=new DomainClient({storage,channel:null,fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path==='/api/documents'&&lose){lose=false;throw new TypeError('lost upload response');}return response;}});t.after(()=>first.dispose());await first.initialize();const file=new File([fixturePdf()],'fixture.pdf',{type:'application/pdf'});
  await assert.rejects(first.createDocument({file}),e=>e.code==='OUTCOME_UNKNOWN');const original=first.pendingOperations()[0];first.dispose();const recovered=new DomainClient({storage,channel:null,fetchImpl:transport,pollMs:1});t.after(()=>recovered.dispose());await recovered.initialize();await assert.rejects(recovered.retryOperation(original.id),e=>e.code==='ORIGINAL_FILE_REQUIRED');await assert.rejects(recovered.retryOperation(original.id,new File([fixturePdf('Different text')],'fixture.pdf',{type:'application/pdf'})),e=>e.code==='ORIGINAL_FILE_MISMATCH');const receipt=await recovered.retryOperation(original.id,file);await app.jobs.drain();const source=await recovered.source(receipt.source_id);assert.equal(source.pages[0].page,1);assert.match(source.text,/Record feelings/);const run=await recovered.pollRun(receipt.run_id);assert.equal(run.change.proposals[0].evidence[0].locator.page,1);assert.equal((await recovered.refresh()).timeline.entries.length,1);
});
test('logout removes persisted active health drafts and resolved journal bodies but retains unresolved original recovery record',async t=>{
  const {transport}=await setup(t);let lose=false;const storage=new MemoryStorage();const client=new DomainClient({storage,channel:null,fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path==='/api/entries'&&lose) throw new TypeError('lost');return response;}});t.after(()=>client.dispose());await client.initialize();client.setDraft('record','本机健康草稿');await client.createEntry('已知保存结果。');const savedKey=client.key('operations');assert.ok(!storage.getItem(savedKey).includes('已知保存结果。'));lose=true;await assert.rejects(client.createEntry('未知结果原文。'));const draftKey=client.key('drafts');await client.logout();assert.equal(storage.getItem(draftKey),null);assert.ok(storage.getItem(savedKey).includes('未知结果原文。'));assert.equal(client.pendingOperations().length,0);
});
test('refresh without broadcast detects deleted sources and clears cached run/evidence views',async t=>{
  const {app,a,b}=await setup(t);const accepted=await a.createEntry('来源随后删除。');await app.jobs.drain();await a.pollRun(accepted.run_id);assert.ok(a.state.runs[accepted.run_id].change.sources[0].text);
  let invalidated=false;a.subscribe(event=>{if(event.type==='scope')invalidated=true;});await b.deleteData(accepted.source_id);await a.refresh();assert.equal(invalidated,true);assert.equal(Object.keys(a.state.runs).length,0);assert.equal(a.state.timeline.entries.length,0);
});
