import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
let DomainStore;
try { ({DomainStore}=await import('../../services/api/domain-store.mjs')); } catch(e) { if(e.code!=='ERR_MODULE_NOT_FOUND') throw e; }
const key=(n)=>`test-operation-${String(n).padStart(4,'0')}`;
function fixture(t) {
 assert.ok(DomainStore,'DomainStore provides authenticated transactional domain persistence');
 const dir=mkdtempSync(join(tmpdir(),'ht-domain-')); const path=join(dir,'db.sqlite');
 let store=new DomainStore({dbPath:path,demoAccounts:[{username:'alice',password:'alice-password'},{username:'bob',password:'bob-password'}]});
 t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});
 const a=store.login('alice','alice-password').user.id,b=store.login('bob','bob-password').user.id;
 for(const u of [a,b]) store.setConsent(u,{purpose:'analysis',granted:true,expected_version:1});
 return {get s(){return store;},a,b,restart(){store.close();store=new DomainStore({dbPath:path});}};
}
function candidate(source,overrides={}) {return {field:'reported_text',value:source.text,assertion:'affirmed',temporal_scope:source.text.startsWith('今天')?'current':'unknown',effective_time:{raw:null,precision:'unknown',start:null,end:null,timezone:null,anchor_source_id:source.id},evidence:[{source_id:source.id,source_text_version:1,locator:{page:null,start:0,end:source.text.length},quote:source.text}],proposal_kind:'new',...overrides};}
function stage(f,text='今天不舒服。',workflow='entry',n=1) {
 const accepted=f.s.accept(f.a,workflow,workflow==='visit'?{current_concern:text,selected_source_ids:[]}:{text},key(n));
 f.s.claimRun(accepted.run_id); const tools=f.s.toolsFor(accepted.run_id); const source=tools.healththread_read_source({source_id:accepted.source_id}).source;
 tools.healththread_retrieve_context({source_ids:[]});
 const staged=tools.healththread_stage_candidates({candidates:[candidate(source)],base_profile_revision:f.s.profile(f.a).profile_revision,operation_key:key(n+100)});
 return {accepted,tools,source,staged};
}
test('immutable sources, review-only candidates, idempotent confirmation and ownership survive restart',t=>{
 const f=fixture(t),x=stage(f); assert.equal(f.s.profile(f.a).facts.length,0);
 assert.equal(f.s.get(f.a,'run',x.accepted.run_id).status,'needs_review');
 for(const type of ['source','run','operation']) assert.throws(()=>f.s.get(f.b,type,x.accepted[`${type}_id`]),{code:'NOT_FOUND'});
 const fc=f.s.get(f.a,'fact_change',x.staged.fact_change_id);
 const body={accepted_change_ids:fc.proposals.map(x=>x.id),expected_profile_revision:1};
 const confirmed=f.s.confirm(f.a,fc.id,body,key(9));
 assert.equal(confirmed.profile_revision,2); assert.deepEqual(f.s.confirm(f.a,fc.id,body,key(9)),confirmed);
 assert.throws(()=>f.s.confirm(f.a,fc.id,{...body,accepted_change_ids:[]},key(9)),{code:'IDEMPOTENCY_CONFLICT'});
 f.restart(); assert.equal(f.s.profile(f.a).facts[0].value,'今天不舒服。'); assert.equal(f.s.get(f.a,'source',x.source.id).text,'今天不舒服。');
});
test('acceptance idempotency rejects changed requests and stale confirmation rolls back all effects',t=>{
 const f=fixture(t); const x=stage(f,'第一条。'); const y=stage(f,'第二条。','entry',2);
 assert.deepEqual(f.s.accept(f.a,'entry',{text:'第一条。'},key(1)),x.accepted);
 assert.throws(()=>f.s.accept(f.a,'entry',{text:'换了。'},key(1)),{code:'IDEMPOTENCY_CONFLICT'});
 const confirm=z=>f.s.confirm(f.a,z.staged.fact_change_id,{accepted_change_ids:[f.s.get(f.a,'fact_change',z.staged.fact_change_id).proposals[0].id],expected_profile_revision:1},key(z===x?8:9));
 confirm(x); assert.throws(()=>confirm(y),{code:'REVISION_CONFLICT'}); assert.equal(f.s.profile(f.a).facts.length,1);
 assert.equal(f.s.get(f.a,'fact_change',y.staged.fact_change_id).status,'pending');
});
test('scope revocation, cancellation and deletion reject late candidate writes',t=>{
 for(const action of ['consent','cancel','delete']) {
 const f=fixture(t),a=f.s.accept(f.a,'entry',{text:'原文。'},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),source=tools.healththread_read_source({source_id:a.source_id}).source;
 if(action==='consent')f.s.setConsent(f.a,{purpose:'analysis',granted:false,expected_version:2});
 if(action==='cancel')f.s.cancel(f.a,a.run_id);
 if(action==='delete')f.s.deleteData(f.a,a.source_id,key(2));
 assert.throws(()=>tools.healththread_stage_candidates({candidates:[candidate(source)],base_profile_revision:1,operation_key:key(3)}),e=>['SCOPE_REVOKED','RUN_CANCELLED'].includes(e.code));
 assert.equal(f.s.profile(f.a).facts.length,0);
 }
});
test('restart marks running interrupted while queued and review checkpoints remain durable',t=>{
 const f=fixture(t); const a=f.s.accept(f.a,'entry',{text:'待处理。'},key(1));const b=f.s.accept(f.a,'entry',{text:'运行中。'},key(2));f.s.claimRun(b.run_id);const c=stage(f,'待核对。','entry',3);
 f.restart();assert.equal(f.s.get(f.a,'run',a.run_id).status,'queued');assert.equal(f.s.get(f.a,'run',b.run_id).status,'interrupted');assert.equal(f.s.get(f.a,'run',c.accepted.run_id).status,'needs_review');
});
test('stage rejects fabricated quote, inference, lost negation, wrong source and temporal certainty',t=>{
 const f=fixture(t);const a=f.s.accept(f.a,'entry',{text:'既往考虑肺炎，否认发热。'},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),s=tools.healththread_read_source({source_id:a.source_id}).source;
 tools.healththread_retrieve_context({source_ids:[]});
 const good=candidate(s,{assertion:'uncertain',temporal_scope:'past'});
 const bads=[candidate(s),{...good,value:'确诊肺炎'}, {...good,evidence:[{...good.evidence[0],quote:'确诊肺炎'}]}, {...good,evidence:[{...good.evidence[0],source_id:'src_fake'}]}, {...good,effective_time:{...good.effective_time,precision:'exact',start:'2026-10-12'}}];
 for(let i=0;i<bads.length;i++)assert.throws(()=>tools.healththread_stage_candidates({candidates:[bads[i]],base_profile_revision:1,operation_key:key(i+2)}),e=>['INVALID_AGENT_OUTPUT','NOT_FOUND'].includes(e.code));
 assert.equal(f.s.profile(f.a).pending_changes.length,0);
});
test('confirmed medical instructions alone create multiple care tasks in a separate continuation',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'document',{text:'请记录体温。请带检查报告。'},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),s=tools.healththread_read_source({source_id:a.source_id}).source;
 const candidates=[['请记录体温。',0,6],['请带检查报告。',6,13]].map(([quote,start,end])=>candidate(s,{field:'instruction',value:quote,evidence:[{source_id:s.id,source_text_version:1,locator:{page:null,start,end},quote}]}));
 tools.healththread_retrieve_context({source_ids:[]});
 const staged=tools.healththread_stage_candidates({candidates,base_profile_revision:1,operation_key:key(2)}),fc=f.s.get(f.a,'fact_change',staged.fact_change_id);
 const c=f.s.confirm(f.a,fc.id,{accepted_change_ids:fc.proposals.map(p=>p.id),expected_profile_revision:1},key(3));assert.ok(c.continuation_run_id);assert.equal(f.s.careTasks(f.a).tasks.length,0);
 f.s.claimRun(c.continuation_run_id);const next=f.s.toolsFor(c.continuation_run_id);const inst=next.healththread_get_confirmed_instructions({document_id:a.document_id}).instructions;assert.equal(inst.length,2);
 const result=next.healththread_stage_result({kind:'care_plan',payload:{tasks:inst.map(i=>({text:i.value,instruction_refs:[{fact_id:i.fact_id,revision:i.revision}],schedule:null}))},dependencies:inst.map(i=>({fact_id:i.fact_id,revision:i.revision})),operation_key:key(4)});
 assert.equal(f.s.careTasks(f.a).tasks.length,2);assert.throws(()=>f.s.get(f.b,'result',result.result_id),{code:'NOT_FOUND'});
 const task=f.s.careTasks(f.a).tasks[0];f.s.updateTask(f.a,task.id,{status:'done',expected_version:1});assert.throws(()=>f.s.updateTask(f.a,task.id,{status:'paused',expected_version:1}),{code:'REVISION_CONFLICT'});
});
test('correction keeps fact revision history and invalidates derived results',t=>{
 const f=fixture(t),x=stage(f);const fc=f.s.get(f.a,'fact_change',x.staged.fact_change_id);f.s.confirm(f.a,fc.id,{accepted_change_ids:[fc.proposals[0].id],expected_profile_revision:1},key(2));const fact=f.s.profile(f.a).facts[0];
 const a=f.s.accept(f.a,'visit',{current_concern:'就诊表达。',selected_source_ids:[x.source.id]},key(3));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id);
 const concern=tools.healththread_read_source({source_id:a.source_id}).source;tools.healththread_retrieve_context({source_ids:[x.source.id]});
 const r=tools.healththread_stage_result({kind:'visit_preparation',payload:{speech:fact.value+'\n'+concern.text,questions:[],unknowns:[],claims:[{text:fact.value,fact_refs:[{fact_id:fact.fact_id,revision:1}],evidence:[]},{text:concern.text,fact_refs:[],evidence:candidate(concern).evidence}]},dependencies:[{fact_id:fact.fact_id,revision:1},{source_id:concern.id,source_text_version:1}],operation_key:key(4)});
 const change=f.s.changeRequest(f.a,fact.fact_id,{kind:'retraction',text:'撤回该记录。',expected_version:1},key(5));
 const pending=f.s.get(f.a,'fact_change',change.fact_change_id);f.s.confirm(f.a,pending.id,{accepted_change_ids:[pending.proposals[0].id],expected_profile_revision:2},key(6));
 assert.equal(f.s.profile(f.a).facts.length,0);assert.equal(f.s.get(f.a,'result',r.result_id).status,'stale');assert.equal(f.s.exportData(f.a).fact_revisions.length,2);
});
test('transaction failure on audit insert rolls back facts, profile, receipt and review together',t=>{
 const f=fixture(t),x=stage(f),fc=f.s.get(f.a,'fact_change',x.staged.fact_change_id);
 f.s.db.exec("CREATE TRIGGER fail_audit BEFORE INSERT ON objects WHEN NEW.type='audit' BEGIN SELECT RAISE(ABORT,'injected'); END");
 assert.throws(()=>f.s.confirm(f.a,fc.id,{accepted_change_ids:[fc.proposals[0].id],expected_profile_revision:1},key(2)));
 assert.equal(f.s.profile(f.a).profile_revision,1);assert.equal(f.s.profile(f.a).facts.length,0);assert.equal(f.s.get(f.a,'fact_change',fc.id).status,'pending');
 f.s.db.exec('DROP TRIGGER fail_audit'); assert.equal(f.s.confirm(f.a,fc.id,{accepted_change_ids:[fc.proposals[0].id],expected_profile_revision:1},key(2)).profile_revision,2);
});

test('stage receipts replay at review/completed checkpoints but conflicting payload never replays',t=>{
 const f=fixture(t),x=stage(f,'摘录。');const body={candidates:[candidate(x.source)],base_profile_revision:1,operation_key:key(101)};
 assert.equal(x.tools.healththread_stage_candidates(body).fact_change_id,x.staged.fact_change_id);
 assert.throws(()=>x.tools.healththread_stage_candidates({...body,candidates:[]}),{code:'IDEMPOTENCY_CONFLICT'});
});
test('unsupported negation and mixed temporal clauses cannot become confident facts',t=>{
 const f=fixture(t);for(const [n,text,overrides]of [[1,'未提及过敏。',{field:'allergy',assertion:'negated'}],[2,'曾发热。',{temporal_scope:'current'}],[3,'既往发热，目前咳嗽。',{temporal_scope:'past'}],[4,'无发热。',{assertion:'affirmed'}]]){
 const a=f.s.accept(f.a,'entry',{text},key(n));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),s=tools.healththread_read_source({source_id:a.source_id}).source;
 tools.healththread_retrieve_context({source_ids:[]});
 assert.throws(()=>tools.healththread_stage_candidates({candidates:[candidate(s,overrides)],base_profile_revision:1,operation_key:key(n+20)}),{code:'INVALID_AGENT_OUTPUT'});
 }
});
test('manual retry creates one new authorized run without duplicating original and forbids cancelled/checkpoints',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'entry',{text:'已存原文。'},key(1));f.s.failRun(a.run_id,'AGENT_NOT_CONFIGURED','blocked');
 assert.equal(typeof f.s.retry,'function','manual recovery must create new run from persisted source');
 const retry=f.s.retry(f.a,a.run_id,key(2));assert.notEqual(retry.run_id,a.run_id);assert.equal(f.s.timeline(f.a).entries.length,1);assert.deepEqual(f.s.retry(f.a,a.run_id,key(2)),retry);assert.equal(f.s.get(f.a,'run',a.run_id).status,'blocked');
 f.s.cancel(f.a,retry.run_id);assert.throws(()=>f.s.retry(f.a,retry.run_id,key(3)),{code:'RUN_NOT_RETRYABLE'});assert.throws(()=>f.s.retry(f.b,a.run_id,key(4)),{code:'NOT_FOUND'});
});
test('agent must actually read before staging',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'entry',{text:'原文。'},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),s=f.s.get(f.a,'source',a.source_id);
 assert.throws(()=>tools.healththread_stage_candidates({candidates:[candidate(s)],base_profile_revision:1,operation_key:key(2)}),{code:'TOOL_SEQUENCE_REQUIRED'});
});
test('replayed acceptance after deletion cannot resurrect erased original or claim it remains saved',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'entry',{text:'删除原文。'},key(1));f.s.deleteData(f.a,a.source_id,key(2));assert.throws(()=>f.s.accept(f.a,'entry',{text:'删除原文。'},key(1)),{code:'SOURCE_DELETED'});assert.equal(f.s.timeline(f.a).entries.length,0);
});
test('W2 factual speech cannot outrun exact claims or fabricate dosage through question strings',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'visit',{current_concern:'头痛。',selected_source_ids:[]},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),s=tools.healththread_read_source({source_id:a.source_id}).source;tools.healththread_retrieve_context({});
 const claim={text:'头痛。',fact_refs:[],evidence:[{source_id:s.id,source_text_version:1,locator:{page:null,start:0,end:3},quote:'头痛。'}]};
 for(const payload of [{speech:'确诊肺炎。',questions:[],unknowns:[],claims:[claim]},{speech:'头痛。',questions:['请服用100mg药物？'],unknowns:[],claims:[claim]}])assert.throws(()=>tools.healththread_stage_result({kind:'visit_preparation',payload,dependencies:[{source_id:s.id,source_text_version:1}],operation_key:key(2)}),{code:'INVALID_AGENT_OUTPUT'});
});
test('impossible dates are rejected while raw unclear time stays unresolved',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'entry',{text:'2026-02-31，头痛。'},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),s=tools.healththread_read_source({source_id:a.source_id}).source;tools.healththread_retrieve_context({});
 assert.throws(()=>tools.healththread_stage_candidates({candidates:[candidate(s,{effective_time:{raw:'2026-02-31',precision:'exact',start:'2026-02-31',end:null,timezone:null,anchor_source_id:s.id}})],base_profile_revision:1,operation_key:key(2)}),{code:'INVALID_AGENT_OUTPUT'});
 const result=tools.healththread_stage_candidates({candidates:[candidate(s,{effective_time:{raw:'2026-02-31',precision:'unknown',start:null,end:null,timezone:null,anchor_source_id:s.id}})],base_profile_revision:1,operation_key:key(3)});assert.ok(result.fact_change_id);
});
test('expired sessions, expired scopes, queue limits and overdue dispatch fail closed',t=>{
 assert.ok(DomainStore);let now=0;const s=new DomainStore({clock:()=>now,demoAccounts:[{username:'a',password:'1234567890'}],limits:{sessionTtlMs:10,scopeTtlMs:20,deadlineMs:10,queueTtlMs:10,userQueueDepth:1}});t.after(()=>s.close());const login=s.login('a','1234567890'),u=login.user.id;s.setConsent(u,{purpose:'analysis',granted:true,expected_version:1});const a=s.accept(u,'entry',{text:'保留。'},key(1));assert.throws(()=>s.accept(u,'entry',{text:'第二条。'},key(2)),{code:'QUEUE_BUSY'});now=11;assert.equal(s.session(login.token),null);assert.equal(s.claimRun(a.run_id),null);assert.equal(s.get(u,'run',a.run_id).error.code,'DEADLINE_EXCEEDED');
 const b=s.accept(u,'entry',{text:'源。'},key(3));s.claimRun(b.run_id);const tools=s.toolsFor(b.run_id);now=32;assert.throws(()=>tools.healththread_read_source({source_id:b.source_id}),{code:'SCOPE_REVOKED'});
});
test('separate submissions retain pending episodes rather than silently merging by symptom keyword',t=>{
 const f=fixture(t);f.s.accept(f.a,'entry',{text:'头痛。'},key(1));f.s.accept(f.a,'entry',{text:'头痛。'},key(2));const exp=f.s.exportData(f.a);assert.equal(exp.episodes.length,2);assert.notEqual(exp.entries[0].episode_id,exp.entries[1].episode_id);assert.ok(exp.episodes.every(e=>e.status==='pending'));assert.equal(f.s.exportData(f.b).episodes.length,0);
});
test('SQLite enforces immutability for accepted source, entry, document and pending episode',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'document',{text:'原始病历。'},key(1));for(const [type,id]of [['source',a.source_id],['entry',a.entry_id],['document',a.document_id],['episode',f.s.get(f.a,'entry',a.entry_id).episode_id]]){const original=f.s.get(f.a,type,id);assert.throws(()=>f.s.save(type,{...original,altered:true}));assert.deepEqual(f.s.get(f.a,type,id),original);}
});
test('care plans reject invented task text, non-temporal schedules and omitted confirmed instructions',t=>{
 const f=fixture(t),a=f.s.accept(f.a,'document',{text:'请每日记录体温。'},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),s=tools.healththread_read_source({source_id:a.source_id}).source;tools.healththread_retrieve_context({});const staged=tools.healththread_stage_candidates({candidates:[candidate(s,{field:'instruction',effective_time:{raw:'每日',precision:'relative',start:null,end:null,timezone:null,anchor_source_id:s.id}})],base_profile_revision:1,operation_key:key(2)});const fc=f.s.get(f.a,'fact_change',staged.fact_change_id);const c=f.s.confirm(f.a,fc.id,{accepted_change_ids:[fc.proposals[0].id],expected_profile_revision:1},key(3));f.s.claimRun(c.continuation_run_id);const next=f.s.toolsFor(c.continuation_run_id),i=next.healththread_get_confirmed_instructions({document_id:a.document_id}).instructions[0];const ref={fact_id:i.fact_id,revision:i.revision};const task={text:i.value,instruction_refs:[ref],schedule:null};
 for(const tasks of [[{...task,text:'请每日口服药物。'}],[{...task,schedule:'请'}],[]])assert.throws(()=>next.healththread_stage_result({kind:'care_plan',payload:{tasks},dependencies:[ref],operation_key:key(4)}),{code:'INVALID_AGENT_OUTPUT'});
 const result=next.healththread_stage_result({kind:'care_plan',payload:{tasks:[{...task,schedule:'每日'}]},dependencies:[ref],operation_key:key(5)});assert.equal(f.s.get(f.a,'result',result.result_id).payload.tasks[0].schedule,'每日');
});
test('context honors keyword, selected source and assigned episode filters',t=>{
 const f=fixture(t),x=stage(f,'头痛。');let c=f.s.get(f.a,'fact_change',x.staged.fact_change_id);f.s.confirm(f.a,c.id,{accepted_change_ids:[c.proposals[0].id],expected_profile_revision:1},key(2));const y=stage(f,'咳嗽。','entry',3);c=f.s.get(f.a,'fact_change',y.staged.fact_change_id);f.s.confirm(f.a,c.id,{accepted_change_ids:[c.proposals[0].id],expected_profile_revision:2},key(4));
 const a=f.s.accept(f.a,'visit',{current_concern:'就诊。',selected_source_ids:[x.source.id,y.source.id]},key(5));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id);assert.deepEqual(tools.healththread_retrieve_context({query:'咳嗽'}).facts.map(f=>f.value),['咳嗽。']);assert.deepEqual(tools.healththread_retrieve_context({source_ids:[x.source.id]}).facts.map(f=>f.value),['头痛。']);const e=f.s.get(f.a,'entry',x.accepted.entry_id);assert.deepEqual(tools.healththread_retrieve_context({episode_id:e.episode_id}).facts.map(f=>f.value),['头痛。']);
});
test('visit speech must include its current concern instead of only selected history',t=>{
 const f=fixture(t),x=stage(f,'旧记录。');const a=f.s.accept(f.a,'visit',{current_concern:'新困扰。',selected_source_ids:[x.source.id]},key(2));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id);tools.healththread_read_source({source_id:a.source_id});tools.healththread_retrieve_context({source_ids:[x.source.id]});assert.throws(()=>tools.healththread_stage_result({kind:'visit_preparation',payload:{speech:'旧记录。',questions:[],unknowns:[],claims:[{text:'旧记录。',fact_refs:[],evidence:candidate(x.source).evidence}]},dependencies:[{source_id:x.source.id,source_text_version:1}],operation_key:key(3)}),{code:'INVALID_AGENT_OUTPUT'});
});
test('candidate field, assertion, temporal scope and time cannot borrow unrelated evidence',t=>{
 const f=fixture(t);
 for(const [n,text,value,overrides]of [
  [1,'头痛。诊断肺炎。','头痛。',{field:'diagnosis'}],
  [2,'头痛。否认发热。','头痛。',{assertion:'negated'}],
  [3,'头痛。既往咳嗽。','头痛。',{temporal_scope:'past'}],
  [4,'头痛。2026-10-12咳嗽。','头痛。',{effective_time:{raw:'2026-10-12',precision:'exact',start:'2026-10-12',end:null,timezone:null}}],
 ]){
  const a=f.s.accept(f.a,'entry',{text},key(n));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),source=tools.healththread_read_source({source_id:a.source_id}).source;tools.healththread_retrieve_context({});const evidence=[{source_id:source.id,source_text_version:1,locator:{page:null,start:0,end:value.length},quote:value},{source_id:source.id,source_text_version:1,locator:{page:null,start:value.length,end:text.length},quote:text.slice(value.length)}];const c=candidate(source,{value,evidence,...overrides});if(overrides.effective_time)c.effective_time.anchor_source_id=source.id;
  assert.throws(()=>tools.healththread_stage_candidates({candidates:[c],base_profile_revision:1,operation_key:key(100+n)}),{code:'INVALID_AGENT_OUTPUT'},text);
  assert.equal(f.s.get(f.a,'run',a.run_id).status,'running');assert.equal(f.s.profile(f.a).pending_changes.length,0);
 }
});
test('unused concern evidence cannot launder a history-only visit speech',t=>{
 const f=fixture(t),x=stage(f,'旧记录。');const a=f.s.accept(f.a,'visit',{current_concern:'新困扰。',selected_source_ids:[x.source.id]},key(2));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),concern=tools.healththread_read_source({source_id:a.source_id}).source;tools.healththread_retrieve_context({source_ids:[x.source.id]});const old=candidate(x.source).evidence[0],current=candidate(concern).evidence[0];const dependencies=[{source_id:x.source.id,source_text_version:1},{source_id:concern.id,source_text_version:1}];
 assert.throws(()=>tools.healththread_stage_result({kind:'visit_preparation',payload:{speech:'旧记录。',questions:[],unknowns:[],claims:[{text:'旧记录。',fact_refs:[],evidence:[old,current]}]},dependencies,operation_key:key(3)}),{code:'INVALID_AGENT_OUTPUT'});
 assert.equal(f.s.get(f.a,'run',a.run_id).result_id,null);
 const result=tools.healththread_stage_result({kind:'visit_preparation',payload:{speech:'旧记录。\n新困扰。',questions:[],unknowns:[],claims:[{text:'旧记录。',fact_refs:[],evidence:[old]},{text:'新困扰。',fact_refs:[],evidence:[current]}]},dependencies,operation_key:key(4)});assert.equal(f.s.get(f.a,'result',result.result_id).payload.speech,'旧记录。\n新困扰。');
});
test('care task renders each referenced distinct instruction while identical instructions may share one task',t=>{
 for(const texts of [['请记录体温。','请带检查报告。'],['请记录体温。','请记录体温。']]){
  const f=fixture(t),a=f.s.accept(f.a,'document',{text:texts.join('')},key(1));f.s.claimRun(a.run_id);const tools=f.s.toolsFor(a.run_id),source=tools.healththread_read_source({source_id:a.source_id}).source;tools.healththread_retrieve_context({});let start=0;const candidates=texts.map(value=>{const end=start+value.length;const c=candidate(source,{field:'instruction',value,evidence:[{source_id:source.id,source_text_version:1,locator:{page:null,start,end},quote:value}]});start=end;return c;});const staged=tools.healththread_stage_candidates({candidates,base_profile_revision:1,operation_key:key(2)});const fc=f.s.get(f.a,'fact_change',staged.fact_change_id);const confirmed=f.s.confirm(f.a,fc.id,{accepted_change_ids:fc.proposals.map(p=>p.id),expected_profile_revision:1},key(3));f.s.claimRun(confirmed.continuation_run_id);const next=f.s.toolsFor(confirmed.continuation_run_id);const ins=next.healththread_get_confirmed_instructions({document_id:a.document_id}).instructions;const refs=ins.map(i=>({fact_id:i.fact_id,revision:i.revision}));const merged={kind:'care_plan',payload:{tasks:[{text:texts[0],instruction_refs:refs,schedule:null}]},dependencies:refs,operation_key:key(4)};
  if(texts[0]!==texts[1]){
   assert.throws(()=>next.healththread_stage_result(merged),{code:'INVALID_AGENT_OUTPUT'});assert.equal(f.s.careTasks(f.a).tasks.length,0);
   const result=next.healththread_stage_result({...merged,payload:{tasks:ins.map(i=>({text:i.value,instruction_refs:[{fact_id:i.fact_id,revision:i.revision}],schedule:null}))},operation_key:key(5)});assert.deepEqual(f.s.get(f.a,'result',result.result_id).payload.tasks.map(t=>t.text),texts);
  }else{next.healththread_stage_result(merged);assert.equal(f.s.careTasks(f.a).tasks.length,1);assert.equal(f.s.careTasks(f.a).tasks[0].instruction_refs.length,2);}
 }
});
test('stale review supports current-revision rejection and CAS reanalysis from saved source without confirming stale facts',t=>{
 const f=fixture(t),x=stage(f,'第一条。','entry',1),y=stage(f,'待拒绝。','entry',2),z=stage(f,'待重分析。','entry',3);const change=item=>f.s.get(f.a,'fact_change',item.staged.fact_change_id);const cx=change(x),cy=change(y),cz=change(z);f.s.confirm(f.a,cx.id,{accepted_change_ids:[cx.proposals[0].id],expected_profile_revision:1},key(10));
 for(const revision of [1])assert.throws(()=>f.s.confirm(f.a,cy.id,{accepted_change_ids:[cy.proposals[0].id],expected_profile_revision:revision},key(10+revision)),{code:'REVISION_CONFLICT'});
 const rejected=f.s.reject(f.a,cy.id,{expected_profile_revision:2},key(20));assert.equal(rejected.profile_revision,2);assert.equal(change(y).status,'rejected');assert.equal(f.s.profile(f.a).facts.length,1);
 assert.equal(typeof f.s.reanalyse,'function','needs_review recovery must reuse the saved source');assert.throws(()=>f.s.reanalyse(f.a,z.accepted.run_id,{expected_profile_revision:1},key(21)),{code:'REVISION_CONFLICT'});assert.equal(change(z).status,'pending');assert.throws(()=>f.s.reanalyse(f.b,z.accepted.run_id,{expected_profile_revision:2},key(22)),{code:'NOT_FOUND'});
 const recovery=f.s.reanalyse(f.a,z.accepted.run_id,{expected_profile_revision:2},key(23));assert.equal(recovery.source_id,z.source.id);assert.notEqual(recovery.run_id,z.accepted.run_id);assert.deepEqual(f.s.reanalyse(f.a,z.accepted.run_id,{expected_profile_revision:2},key(23)),recovery);assert.throws(()=>f.s.reanalyse(f.a,z.accepted.run_id,{expected_profile_revision:3},key(23)),{code:'IDEMPOTENCY_CONFLICT'});assert.equal(change(z).status,'expired');assert.equal(f.s.get(f.a,'run',z.accepted.run_id).status,'cancelled');assert.equal(f.s.timeline(f.a).entries.length,3);assert.equal(f.s.profile(f.a).facts.length,1);
 assert.throws(()=>z.tools.healththread_read_source({source_id:z.source.id}),e=>['SCOPE_REVOKED','RUN_CANCELLED'].includes(e.code));assert.throws(()=>f.s.confirm(f.a,cz.id,{accepted_change_ids:[cz.proposals[0].id],expected_profile_revision:2},key(24)),{code:'REVISION_CONFLICT'});
 f.s.claimRun(recovery.run_id);const tools=f.s.toolsFor(recovery.run_id);tools.healththread_read_source({source_id:z.source.id});tools.healththread_retrieve_context({});const fresh=tools.healththread_stage_candidates({candidates:[candidate(z.source)],record_dialogue:{summary:z.source.text,questions:[],missing_fields:[]},overview:{summary:z.source.text,regions:[]},base_profile_revision:2,operation_key:key(25)});const proposed=f.s.get(f.a,'fact_change',fresh.fact_change_id);assert.equal(f.s.confirm(f.a,proposed.id,{accepted_change_ids:[proposed.proposals[0].id],expected_profile_revision:2},key(26)).profile_revision,3);
});
