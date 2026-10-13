import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {sentenceSpans,literalSourceTime} from '../../services/api/source-validation.mjs';
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
    return tools.healththread_stage_result({kind:'care_plan',operation_key:'client-fixture-care-key',dependencies:instructions.map(f=>({fact_id:f.fact_id,revision:f.revision})),payload:{tasks:instructions.map(f=>({text:f.value,schedule:f.effective_time.raw,instruction_refs:[{fact_id:f.fact_id,revision:f.revision}]})),explanation:'合成测试'}});
  }
  return tools.healththread_stage_candidates({base_profile_revision:context.snapshot_revision,operation_key:'client-fixture-candidates-key',...(run.legacy_record_adoption?{record_dialogue:{summary:source.text,questions:[],missing_fields:[]},overview:{summary:source.text,regions:[]}}:{}),candidates:sentenceSpans(source).map(span=>({field:run.workflow==='document'?'instruction':'reported_text',value:span.quote,assertion:'affirmed',temporal_scope:'unknown',effective_time:literalSourceTime(span.quote,source.id),evidence:[span],proposal_kind:'new'}))});
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
  const {app,a,b}=await setup(t);const one=await a.createEntry('第一条。');const two=await b.createEntry('第二条。');const three=await a.createEntry('另一个待拒绝记录。');await app.jobs.drain();const r1=await a.pollRun(one.run_id),r2=await b.pollRun(two.run_id);const c1=await a.factChange(r1.fact_change_id),c2=await b.factChange(r2.fact_change_id);
  b.setDraft('selection:'+c2.id,[c2.proposals[0].id]);await a.confirm(c1.id,[c1.proposals[0].id],1);
  await assert.rejects(b.confirm(c2.id,[c2.proposals[0].id],1),e=>e.status===409);assert.deepEqual(b.getDraft('selection:'+c2.id),[c2.proposals[0].id]);
  const r3=await b.pollRun(three.run_id);await assert.rejects(b.reject(r3.fact_change_id,1),e=>e.status===409);await b.refresh();await b.reject(r3.fact_change_id,b.state.profile.profile_revision);assert.equal((await b.factChange(r3.fact_change_id)).status,'rejected');
  const fresh=await b.reanalyse(r2.id,b.state.profile.profile_revision);assert.equal(fresh.source_id,two.source_id);assert.ok(fresh.record_thread_id);await app.jobs.drain();const r=await b.pollRun(fresh.run_id);assert.equal(r.status,'completed');assert.equal(r.record_save_status,'saved');assert.equal((await b.factChange(c2.id)).status,'expired');assert.equal((await b.refresh()).timeline.entries.length,3);assert.equal((await b.source(two.source_id)).text,'第二条。');
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
test('lost all-data DELETE recovery centrally clears every local session journal/draft and invalidates peer callbacks',async t=>{
  const {app,transport,make}=await setup(t);const storage=new MemoryStorage();let lose=true;
  const a=new DomainClient({storage,channel:null,fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path==='/api/data/all'&&lose){lose=false;throw new TypeError('lost delete receipt');}return response;}});t.after(()=>a.dispose());await a.initialize();const source=await a.createEntry('删除恢复原文。');await app.jobs.drain();await a.pollRun(source.run_id);a.setDraft('record','删除后不应恢复的草稿');const owner=a.state.user.id;storage.setItem('healththread-domain:drafts:'+owner+':old-session','旧会话草稿');storage.setItem('healththread-domain:operations:'+owner+':old-session','旧会话请求');
  let deletionEvent; a.subscribe(event=>{if(event.type==='deletion')deletionEvent=event;});await assert.rejects(a.deleteData('all'),e=>e.code==='OUTCOME_UNKNOWN');const unknown=a.pendingOperations()[0];const generation=a.generation;const receipt=await a.retryOperation(unknown.id);assert.equal(receipt.status,'partial');assert.equal(deletionEvent.receipt.deletion_job_id,receipt.deletion_job_id);assert.ok(a.generation>generation);assert.equal(a.getDraft('record'),'');assert.equal(a.operations.length,0);assert.equal(storage.getItem('healththread-domain:drafts:'+owner+':old-session'),null);assert.equal(storage.getItem('healththread-domain:operations:'+owner+':old-session'),null);assert.equal(Object.keys(a.state.runs).length,0);assert.equal(a.state.timeline.entries.length,0);
});
test('partial source deletion and peer refresh prune invisible selections while preserving concern and valid history',async t=>{
  const {app,a,b}=await setup(t);const one=await a.createEntry('第一份来源。'),two=await b.createEntry('第二份来源。');await app.jobs.drain();await a.refresh();await b.refresh();for(const client of [a,b]){client.setDraft('selectedSources',[one.source_id,two.source_id]);client.setDraft('concern','保留当前困扰草稿。');client.setDraft('record','保留未发送记录。');}
  await a.deleteData(one.source_id);assert.deepEqual(a.getDraft('selectedSources',[]),[two.source_id]);assert.equal(a.getDraft('concern'),'保留当前困扰草稿。');assert.equal(a.getDraft('record'),'保留未发送记录。');await b.refresh();assert.deepEqual(b.getDraft('selectedSources',[]),[two.source_id]);assert.equal(b.getDraft('concern'),'保留当前困扰草稿。');const visit=await b.createVisit(b.getDraft('concern'),b.getDraft('selectedSources',[]));assert.ok(visit.saved);
});
test('fresh authenticated session discovers blocked documents and interrupted runs without local acceptance journal',async t=>{
  const {app,a,make}=await setup(t,{agent:null});const entry=await a.createEntry('历史身体记录。'),document=await a.createDocument({text:'医嘱：携带报告。',name:'历史病历'});await app.jobs.drain();app.store.transaction(()=>{const run=app.store.internalRun(entry.run_id);run.status='interrupted';run.phase='recovery';app.store.save('run',run);});const fresh=make();t.after(()=>fresh.dispose());await fresh.login('alice','alice-password');assert.equal(fresh.operations.length,0);assert.equal(fresh.state.runs[entry.run_id].status,'interrupted');assert.equal(fresh.state.runs[document.run_id].status,'blocked');assert.equal(fresh.state.documents.documents[0].name,'历史病历');const retried=await fresh.retryRun(entry.run_id);assert.equal(retried.source_id,entry.source_id);
});
test('concurrent canonical refresh is coalesced and settled run lookup does not repeat whole projections',async t=>{
  const {app,a,transport}=await setup(t);const created=await a.createEntry('历史任务。');await app.jobs.drain();let profileGets=0,runGets=0;const client=new DomainClient({storage:new MemoryStorage(),channel:null,fetchImpl:async(path,options)=>{if(path==='/api/profile') profileGets++;if(path==='/api/runs/'+created.run_id) runGets++;return transport(path,options);}});t.after(()=>client.dispose());await client.initialize();profileGets=0;await Promise.all([client.refresh(),client.refresh(),client.refresh()]);assert.equal(profileGets,1);await client.pollRun(created.run_id,{refresh:false});const firstCount=runGets;profileGets=0;await client.pollRun(created.run_id,{refresh:false});assert.equal(runGets,firstCount);assert.equal(profileGets,0);
});
test('lost all-delete survives fresh me/all-clear cleanup as an opaque original recovery handle before explicit retry',async t=>{
  const {transport}=await setup(t);let lose=true;const storage=new MemoryStorage();const a=new DomainClient({storage,channel:null,fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path==='/api/data/all'&&lose){lose=false;throw new TypeError('lost');}return response;}});t.after(()=>a.dispose());await a.initialize();a.setDraft('record','必须清理的健康正文');await assert.rejects(a.deleteData('all'));const original=a.pendingOperations()[0];await a.refresh();assert.equal(a.getDraft('record'),'');assert.ok(![...storage.values.values()].some(value=>value.includes('必须清理的健康正文')));const handle=a.pendingOperations().find(op=>op.id===original.id);assert.ok(handle,'opaque delete recovery must survive all-clear observation');assert.equal(handle.key,original.key);assert.equal(handle.scopeEpoch,original.scopeEpoch);const receipt=await a.retryOperation(handle.id);assert.equal(receipt.status,'partial');assert.equal(a.pendingOperations().length,0);
});
test('empty all-delete clears peer drafts without broadcast; partial deletion preserves unrelated draft',async t=>{
  const {a,b}=await setup(t);a.setDraft('concern','空来源列表下仍应清除。');const owner=a.state.user.id;a.storage.setItem('healththread-domain:drafts:'+owner+':old-session','旧健康正文');await b.deleteData('all');await a.refresh();assert.equal(a.getDraft('concern'),'');assert.equal(a.storage.getItem('healththread-domain:drafts:'+owner+':old-session'),null);const clearEpoch=a.allClearEpoch;a.setDraft('concern','清除之后新写的草稿');await a.refresh();assert.equal(a.getDraft('concern'),'清除之后新写的草稿');assert.equal(a.allClearEpoch,clearEpoch);
});
test('delayed older successful me cannot downgrade scope/all-clear watermarks or clear post-deletion new draft',async t=>{
  const {b,transport}=await setup(t);let stale=false;const older=await transport('/api/me');const client=new DomainClient({storage:new MemoryStorage(),channel:null,fetchImpl:async(path,options)=>path==='/api/me'&&stale?(stale=false,older.clone()):transport(path,options)});t.after(()=>client.dispose());await client.initialize();await b.deleteData('all');await client.refresh();const scope=client.scopeEpoch,clear=client.allClearEpoch;client.setDraft('record','删除完成后重新输入。');stale=true;await assert.rejects(client.refresh(),e=>e.code==='STALE_SCOPE');assert.equal(client.scopeEpoch,scope);assert.equal(client.allClearEpoch,clear);assert.equal(client.getDraft('record'),'删除完成后重新输入。');
});
test('paused old POST cannot arrive after all-delete as a fresh source; original header remains frozen',async t=>{
  const {app,b,transport}=await setup(t);let release,started;const waiting=new Promise(r=>started=r);let originalHeader,responseStatus;const client=new DomainClient({storage:new MemoryStorage(),channel:null,fetchImpl:async(path,options)=>{if(path==='/api/entries'){originalHeader=options.headers['X-HealthThread-Epoch'];started();await new Promise(r=>release=r);const response=await transport(path,options);responseStatus=response.status;return response;}return transport(path,options);}});t.after(()=>client.dispose());await client.initialize();const oldEpoch=client.scopeEpoch;const pending=client.createEntry('不能在清除后恢复的旧输入。');await waiting;await b.deleteData('all');release();await assert.rejects(pending,e=>e.code==='SCOPE_EPOCH_CONFLICT');assert.equal(originalHeader,String(oldEpoch));assert.equal(responseStatus,409);assert.ok(client.scopeEpoch>oldEpoch);assert.equal(client.allClearEpoch,1);assert.ok(![...client.storage.values.values()].some(value=>value.includes('不能在清除后恢复的旧输入。')));await app.jobs.drain();await b.refresh();assert.equal(b.state.timeline.entries.length,0);
});
test('bounded owner history pages retain loaded older documents/runs and do not restart an exhausted cursor on refresh',async t=>{
  const {app,a}=await setup(t,{agent:null});for(let i=0;i<101;i++){app.store.accept(a.state.user.id,'document',{text:'合成历史病历。',name:'历史病历 '+i},'client-history-page-'+String(i).padStart(4,'0'));await app.jobs.drain();}
  await a.refresh();assert.equal(Object.keys(a.state.runs).length,100);assert.equal(a.state.documents.documents.length,100);assert.ok(a.state.runPage.next_cursor);assert.ok(a.state.documents.next_cursor);await a.loadMoreRuns();await a.loadMoreDocuments();assert.equal(Object.keys(a.state.runs).length,101);assert.equal(a.state.documents.documents.length,101);assert.equal(a.state.runPage.next_cursor,null);assert.equal(a.state.documents.next_cursor,null);await a.refresh();assert.equal(Object.keys(a.state.runs).length,101);assert.equal(a.state.documents.documents.length,101);assert.equal(a.state.runPage.next_cursor,null);assert.equal(a.state.documents.next_cursor,null);
});
test('shared-storage peer watermark does not suppress clearing the other tab memory or let it reinsert erased drafts without broadcast',async t=>{
  const {transport}=await setup(t);const storage=new MemoryStorage();const a=new DomainClient({storage,channel:null,fetchImpl:transport}),b=new DomainClient({storage,channel:null,fetchImpl:transport});t.after(()=>{a.dispose();b.dispose();});await a.initialize();await b.initialize();a.setDraft('record','另一标签仍在内存的已删除健康正文');await b.deleteData('all');await a.refresh();assert.equal(a.getDraft('record'),'');a.setDraft('selectedSources',[]);assert.ok(![...storage.values.values()].some(value=>value.includes('另一标签仍在内存的已删除健康正文')));
});
test('recovered all-delete broadcasts scope cleanup and late peer source read cannot restore cleared views',async t=>{
  const {app,transport}=await setup(t);const channels=[];function channel(){const listeners=new Set();const value={listeners,addEventListener(_type,fn){listeners.add(fn);},removeEventListener(_type,fn){listeners.delete(fn);},close(){listeners.clear();},postMessage(data){for(const peer of channels)if(peer!==value)for(const fn of peer.listeners)fn({data});}};channels.push(value);return value;}
  let lose=true,release,started;const waiting=new Promise(r=>started=r);const a=new DomainClient({storage:new MemoryStorage(),channel:channel(),fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path==='/api/data/all'&&lose){lose=false;throw new TypeError('lost');}return response;}}),b=new DomainClient({storage:new MemoryStorage(),channel:channel(),fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path.startsWith('/api/sources/')){started();await new Promise(r=>release=r);}return response;}});t.after(()=>{a.dispose();b.dispose();});await a.initialize();await b.initialize();const saved=await a.createEntry('迟到读取不应恢复。');await app.jobs.drain();await b.refresh();b.setDraft('record','删除之前的标签草稿');const late=b.source(saved.source_id);const rejected=assert.rejects(late,e=>e.code==='SESSION_CHANGED');await waiting;await assert.rejects(a.deleteData('all'));const op=a.pendingOperations()[0];await a.retryOperation(op.id);assert.equal(b.getDraft('record'),'');release();await rejected;await b.refresh();assert.equal(b.state.timeline.entries.length,0);assert.equal(Object.keys(b.state.runs).length,0);
});
test('fresh client reload after committed lost DELETE preserves only owner/session-bound opaque handle and recovers original receipt',async t=>{
  const {app,transport}=await setup(t);const storage=new MemoryStorage();let committedReceipt,lose=true;
  const first=new DomainClient({storage,channel:null,fetchImpl:async(path,options)=>{const response=await transport(path,options);if(path==='/api/data/all'&&lose){lose=false;committedReceipt=await response.clone().json();throw new TypeError('lost committed delete response');}return response;}});t.after(()=>first.dispose());await first.initialize();await first.createEntry('刷新后必须擦除的服务器原文。');await app.jobs.drain();first.setDraft('record','刷新后必须擦除的本机正文');const owner=first.state.user.id,session=first.sessionEpoch;storage.setItem('healththread-domain:operations:'+owner+':other-session','其他会话健康正文');await assert.rejects(first.deleteData('all'),e=>e.code==='OUTCOME_UNKNOWN');const original=first.pendingOperations()[0],recoveryKey=first.deletionRecoveryKey();assert.ok(storage.getItem(recoveryKey));first.dispose();
  let replayHeader,leakedDraft=false;const reloaded=new DomainClient({storage,channel:null,fetchImpl:async(path,options)=>{if(path==='/api/data/all')replayHeader=options.headers['X-HealthThread-Epoch'];return transport(path,options);}});t.after(()=>reloaded.dispose());reloaded.subscribe(()=>{if(reloaded.getDraft('record'))leakedDraft=true;});await reloaded.initialize();assert.equal(leakedDraft,false);assert.equal(reloaded.state.user.id,owner);assert.equal(reloaded.sessionEpoch,session);assert.equal(reloaded.getDraft('record'),'');assert.equal(storage.getItem('healththread-domain:operations:'+owner+':other-session'),null);const handle=reloaded.pendingOperations().find(op=>op.id===original.id);assert.ok(handle,'reload must preserve the original opaque recovery handle before all-clear cleanup');assert.equal(handle.key,original.key);assert.equal(handle.scopeEpoch,original.scopeEpoch);assert.ok(reloaded.scopeEpoch>handle.scopeEpoch);assert.deepEqual(handle.body,{});assert.ok(![...storage.values.values()].some(value=>value.includes('必须擦除的本机正文')));const receipt=await reloaded.retryOperation(handle.id);assert.deepEqual(receipt,committedReceipt);assert.equal(replayHeader,String(original.scopeEpoch));assert.equal(reloaded.allClearEpoch,1);assert.equal(reloaded.pendingOperations().length,0);assert.equal(storage.getItem(recoveryKey),null);
});
test('peer polling and export tolerate indirect result withdrawal after fact-source deletion',async t=>{
 const agent={...fixtureAgent,async run(input){
  const {run,tools}=input;if(run.workflow!=='visit')return fixtureAgent.run(input);
  const {source}=tools.healththread_read_source({source_id:run.source_ids[0]});const {facts}=tools.healththread_retrieve_context({});const fact=facts[0],ref={fact_id:fact.fact_id,revision:fact.revision};
  return tools.healththread_stage_result({kind:'visit_preparation',payload:{speech:source.text+'\n'+fact.value,questions:[],unknowns:[],claims:[{text:source.text,evidence:sentenceSpans(source),fact_refs:[]},{text:fact.value,evidence:[],fact_refs:[ref]}]},dependencies:[{source_id:source.id,source_text_version:1},ref],operation_key:'client-indirect-result-key'});
 }};
 const {app,a,b}=await setup(t,{agent});const first=await a.createEntry('独立旧事实。');await app.jobs.drain();const staged=await a.pollRun(first.run_id),review=await a.factChange(staged.fact_change_id);await a.confirm(review.id,review.proposals.map(p=>p.id),review.base_profile_revision);await a.refresh();
 const visit=await a.createVisit('保留这条困扰。',[]);await app.jobs.drain();const completed=await b.pollRun(visit.run_id);const removedResult=completed.result_id;assert.ok(removedResult);
 await a.deleteData(first.source_id);await b.refresh();const withdrawn=await b.pollRun(visit.run_id,{force:true});assert.equal(withdrawn.result_id,null);assert.equal(withdrawn.phase,'result_withdrawn');assert.equal((await b.source(visit.source_id)).text,'保留这条困扰。');assert.ok(!b.state.results.some(r=>r.id===removedResult));const exported=await b.exportData();assert.ok(!JSON.stringify(exported.runs).includes(removedResult));assert.ok(Object.values(b.state.runs).some(r=>r.id===visit.run_id));
});

test('visit regeneration and patient edits persist through the public client API',async t=>{
 const {a,b}=await setup(t);
 const created=await a.createVisit('本次患者描述。');await a.pollRun(created.run_id);await a.refresh();
 const card=a.state.results.find(r=>r.kind==='visit_preparation');
 const edited=await a.editVisit(card.id,'患者修改表达。',['我自己的问题'],0);
 assert.equal(edited.user_edit.revision,1);await a.refresh();assert.equal(a.state.results.find(r=>r.id===card.id).user_edit.speech,'患者修改表达。');
 await b.refresh();assert.equal(b.state.results.find(r=>r.id===card.id).user_edit.revision,1);
 await assert.rejects(b.editVisit(card.id,'另一窗口旧稿。',[],0),{code:'REVISION_CONFLICT'});
 assert.equal(b.state.results.find(r=>r.id===card.id).payload.speech,'本次患者描述。');
 const regenerated=await a.createVisit('',[],{previous_result_id:card.id});assert.equal((await a.source(regenerated.source_id)).text,'本次患者描述。');
});
