import test from 'node:test';
import assert from 'node:assert/strict';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const key=()=>crypto.randomUUID();
function fixture(t){const s=new DomainStore({demoAccounts:[{username:'a',password:'password-123'}]});t.after(()=>s.close());const uid=s.login('a','password-123').user.id;s.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});return {s,uid};}
function begin(f,text,workflow='document'){const a=f.s.accept(f.uid,workflow,{text},key()),run=f.s.claimRun(a.run_id),tools=f.s.toolsFor(run.id),read=tools.healththread_read_source({source_id:a.source_id});tools.healththread_retrieve_context({});return {a,run,tools,read};}
function args(x,refs){return {candidates:[],document_source_refs:refs,base_profile_revision:x.run.base_profile_revision,operation_key:key(),overview:{summary:x.read.source.text,regions:[]}};}
test('compact document refs reconstruct immutable evidence, preserve model classification and source order',t=>{
 const f=fixture(t),x=begin(f,'目前没有头痛。\n医嘱：三天后复诊。'),original=structuredClone(x.read.source);
 const result=x.tools.healththread_stage_candidates(args(x,[{source_id:x.a.source_id,sentence_index:1,field:'instruction'},{source_id:x.a.source_id,sentence_index:0,field:'symptom'}]));
 const p=f.s.get(f.uid,'fact_change',result.fact_change_id).proposals;
 assert.equal(p[0].field,'instruction');assert.deepEqual(p[0].evidence,[x.read.sentence_spans[1]]);assert.equal(p[0].candidate_index,0);
 assert.equal(p[1].assertion,'negated');assert.equal(p[1].value,'目前没有头痛。');assert.deepEqual(p[1].evidence,[x.read.sentence_spans[0]]);assert.equal(p[1].candidate_index,1);
 assert.deepEqual(f.s.get(f.uid,'source',x.a.source_id),original);assert.equal(f.s.profile(f.uid).facts.length,0);
});
test('compact document refs reject laundering, unread sources, bad indexes, duplicate and mixed inputs atomically',t=>{
 const f=fixture(t),other=f.s.accept(f.uid,'document',{text:'另一份资料。'},key()),x=begin(f,'目前没有头痛。'),ref={source_id:x.a.source_id,sentence_index:0,field:'symptom'};
 for(const refs of [[{...ref,field:'diagnosis'}],[{...ref,source_id:other.source_id}],[{...ref,sentence_index:1}],[{...ref,sentence_index:-1}],[{...ref,sentence_index:0.5}],[ref,ref]])assert.throws(()=>x.tools.healththread_stage_candidates(args(x,refs)),{code:'INVALID_AGENT_OUTPUT'});
 for(const extra of [{candidates:[{}]},{record_source_refs:[{source_id:x.a.source_id,sentence_index:0}]}])assert.throws(()=>x.tools.healththread_stage_candidates({...args(x,[ref]),...extra}),{code:'INVALID_AGENT_OUTPUT'});
 assert.equal(f.s.all('fact_change').length,0);
});
test('legacy completed self-report explicitly reanalyses into one same-episode editable thread',t=>{
 const f=fixture(t),x=begin(f,'目前头痛。','entry'),original=structuredClone(x.read.source);
 x.tools.healththread_stage_candidates({candidates:[],base_profile_revision:1,operation_key:key(),overview:{summary:'目前头痛。',regions:[]}});f.s.setRuntime(x.run.id,{mode:'fixture'});
 const episode=f.s.all('entry')[0].episode_id,body={expected_profile_revision:f.s.user(f.uid).revision},op=key();
 const out=f.s.reanalyse(f.uid,x.run.id,body,op);assert.deepEqual(f.s.reanalyse(f.uid,x.run.id,body,op),out);assert.ok(out.record_thread_id);assert.equal(f.s.recordThreads(f.uid).length,1);assert.equal(f.s.recordThreads(f.uid)[0].episode_id,episode);
 const run=f.s.claimRun(out.run_id),tools=f.s.toolsFor(run.id);tools.healththread_read_source({source_id:out.source_id});tools.healththread_retrieve_context({});tools.healththread_stage_candidates({candidates:[],record_source_refs:[{source_id:out.source_id,sentence_index:0}],record_dialogue:{summary:'目前头痛。',questions:[],missing_fields:[]},overview:{summary:'目前头痛。',regions:[]},base_profile_revision:run.base_profile_revision,operation_key:key()});f.s.setRuntime(run.id,{mode:'fixture'});
 const thread=f.s.recordThreads(f.uid)[0],edit=f.s.editRecord(f.uid,thread.id,{text:'头痛已经好了。',expected_version:thread.version},key()),next=f.s.claimRun(edit.run_id),et=f.s.toolsFor(next.id);et.healththread_read_source({source_id:edit.source_id});et.healththread_retrieve_context({});et.healththread_stage_candidates({candidates:[],record_dialogue:{summary:'头痛已经好了。',questions:[],missing_fields:[]},overview:{summary:'头痛已经好了。',regions:[]},base_profile_revision:next.base_profile_revision,operation_key:key()});f.s.setRuntime(next.id,{mode:'fixture'});
 assert.equal(f.s.profile(f.uid).health_profile.overview.summary,'头痛已经好了。');assert.equal(f.s.profile(f.uid).facts.length,0);assert.deepEqual(f.s.get(f.uid,'source',x.a.source_id),original);assert.equal(f.s.recordThreads(f.uid).length,1);
});
test('whole edits require an overview before checkpointing, retain exact edited narrative, and retrieve old episode as history',t=>{
 const f=fixture(t),a=f.s.acceptRecordTurn(f.uid,{text:'昨晚开始头痛。'},key());f.s.failRun(a.run_id,'DEPENDENCY_UNAVAILABLE');
 const thread=f.s.recordThreads(f.uid)[0];thread.summary='昨晚开始头痛。';f.s.save('record_thread',thread);
 f.s.insert(f.uid,'fact_revision',{fact_id:'old-episode-fact',revision:1,review_status:'patient_report',episode_id:thread.episode_id,field:'reported_text',value:'昨晚开始头痛。',evidence:[{source_id:a.source_id,source_text_version:1,locator:{page:null,start:0,end:7},quote:'昨晚开始头痛。'}]});
 const text='更正：前天晚上开始头痛。',edit=f.s.editRecord(f.uid,thread.id,{text,expected_version:thread.version},key()),run=f.s.claimRun(edit.run_id),tools=f.s.toolsFor(run.id);tools.healththread_read_source({source_id:edit.source_id});const context=tools.healththread_retrieve_context({});
 assert.equal(context.record_context.summary,text);assert.equal(context.facts.length,0);assert.equal(context.record_context.edit_replaces_history,true);
 const input={candidates:[],record_dialogue:{summary:'昨晚开始头痛。',questions:[],missing_fields:[]},base_profile_revision:run.base_profile_revision,operation_key:key()};
 assert.throws(()=>tools.healththread_stage_candidates(input),e=>e.code==='INVALID_AGENT_OUTPUT'&&e.details?.path==='overview');assert.equal(f.s.all('fact_change').length,0);
 tools.healththread_stage_candidates({...input,overview:{summary:'前天晚上开始头痛。',regions:[]}});f.s.setRuntime(run.id,{mode:'fixture'});
 const current=f.s.recordThreads(f.uid)[0];assert.equal(current.summary,text);assert.equal(current.summaries.at(-1).summary,text);assert.equal(current.edit_pending,false);assert.equal(f.s.get(f.uid,'source',a.source_id).text,'昨晚开始头痛。');
});
test('confirmed legacy adoption retains facts/history through failed retry and survives database reload',t=>{
 const dir=mkdtempSync(join(tmpdir(),'ht-legacy-reload-')),dbPath=join(dir,'store.sqlite');let s=new DomainStore({dbPath,demoAccounts:[{username:'a',password:'password-123'}]});t.after(()=>{s.close();rmSync(dir,{recursive:true,force:true});});
 const uid=s.login('a','password-123').user.id;s.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const f={s,uid},x=begin(f,'目前没有头痛。','entry'),span=x.read.sentence_spans[0],ann=x.read.sentence_annotations[0];
 const out=x.tools.healththread_stage_candidates({candidates:[{field:'symptom',value:span.quote,assertion:ann.assertion,temporal_scope:ann.temporal_scope,effective_time:ann.effective_time,evidence:[span],proposal_kind:'new'}],base_profile_revision:1,operation_key:key()}),change=s.get(uid,'fact_change',out.fact_change_id);s.confirm(uid,change.id,{accepted_change_ids:[change.proposals[0].id],expected_profile_revision:1},key());const originalFacts=s.profile(uid).facts,originalChange=s.get(uid,'fact_change',change.id);
 const renewed=s.reanalyse(uid,x.run.id,{expected_profile_revision:s.user(uid).revision},key());assert.equal(renewed.expired_fact_change_id,null);assert.deepEqual(s.profile(uid).facts,originalFacts);assert.deepEqual(s.get(uid,'fact_change',change.id),originalChange);
 s.failRun(renewed.run_id,'DEPENDENCY_UNAVAILABLE');const retry=s.retry(uid,renewed.run_id,key());assert.equal(s.internalRun(retry.run_id).record_thread_id,renewed.record_thread_id);assert.equal(s.internalRun(retry.run_id).legacy_record_adoption,true);assert.equal(s.recordThreads(uid).length,1);
 s.close();s=new DomainStore({dbPath});assert.equal(s.recordThreads(uid).length,1);assert.equal(s.internalRun(retry.run_id).record_thread_id,renewed.record_thread_id);assert.deepEqual(s.profile(uid).facts,originalFacts);assert.equal(s.get(uid,'source',x.a.source_id).text,'目前没有头痛。');
});
test('reanalysis of a pre-upgrade staged whole edit retains replacement semantics and authoritative source',t=>{
 const f=fixture(t),a=f.s.acceptRecordTurn(f.uid,{text:'昨晚头痛。'},key());f.s.failRun(a.run_id,'DEPENDENCY_UNAVAILABLE');const thread=f.s.recordThreads(f.uid)[0],edit=f.s.editRecord(f.uid,thread.id,{text:'更正：前天头痛。',expected_version:thread.version},key()),run=f.s.claimRun(edit.run_id);
 // Persist the old release's valid checkpoint that omitted overview.
 const change=f.s.insert(f.uid,'fact_change',{run_id:run.id,source_ids:run.source_ids,base_profile_revision:run.base_profile_revision,epoch:run.epoch,consent_version:run.consent_version,status:'pending',kind:'new',proposals:[],created_at:f.s.now()});run.fact_change_id=change.id;run.status='needs_review';f.s.save('run',run);
 assert.throws(()=>f.s.setRuntime(run.id,{mode:'fixture'}),e=>e.code==='INVALID_AGENT_OUTPUT'&&e.details?.path==='overview');assert.equal(f.s.internalRun(run.id).runtime,undefined);
 const renewed=f.s.reanalyse(f.uid,run.id,{expected_profile_revision:f.s.user(f.uid).revision},key()),next=f.s.claimRun(renewed.run_id);assert.equal(next.record_edit,true);assert.equal(next.record_thread_id,thread.id);assert.equal(next.source_ids[0],edit.source_id);
 const tools=f.s.toolsFor(next.id);tools.healththread_read_source({source_id:edit.source_id});tools.healththread_retrieve_context({});tools.healththread_stage_candidates({candidates:[],record_dialogue:{summary:'昨晚头痛。',questions:[],missing_fields:[]},overview:{summary:'前天头痛。',regions:[]},base_profile_revision:next.base_profile_revision,operation_key:key()});f.s.setRuntime(next.id,{mode:'fixture'});assert.equal(f.s.recordThreads(f.uid)[0].summary,'更正：前天头痛。');assert.equal(f.s.recordThreads(f.uid)[0].edit_pending,false);
});
test('completed documents do not gain legacy reanalysis or patient record threads',t=>{
 const f=fixture(t),x=begin(f,'目前没有头痛。');x.tools.healththread_stage_candidates(args(x,[]));f.s.setRuntime(x.run.id,{mode:'fixture'});assert.throws(()=>f.s.reanalyse(f.uid,x.run.id,{expected_profile_revision:f.s.user(f.uid).revision},key()),{code:'RUN_NOT_REANALYSABLE'});assert.equal(f.s.recordThreads(f.uid).length,0);
});
test('document references preserve comparison index against input order and reject uncertain source-only facts',t=>{
 const f=fixture(t),x=begin(f,'头痛。\n开始时间不清楚。\n医嘱：三天后复诊。');assert.throws(()=>x.tools.healththread_stage_candidates(args(x,[{source_id:x.a.source_id,sentence_index:1,field:'reported_text'}])),e=>e.code==='INVALID_AGENT_OUTPUT'&&e.details?.path==='document_source_refs[0]');assert.equal(f.s.all('fact_change').length,0);
 const fact=f.s.insert(f.uid,'fact_revision',{fact_id:'retrieved-old',revision:1,field:'symptom',value:'头痛。',assertion:'affirmed',temporal_scope:'unknown',review_status:'confirmed',evidence:[x.read.sentence_spans[0]]});x.tools.healththread_retrieve_context({});
 const out=x.tools.healththread_stage_candidates({...args(x,[{source_id:x.a.source_id,sentence_index:2,field:'instruction'},{source_id:x.a.source_id,sentence_index:0,field:'symptom'}]),comparisons:[{candidate_index:1,fact_id:fact.fact_id,revision:1,relation:'duplicate',reason:'相同原文。'}]});const p=f.s.get(f.uid,'fact_change',out.fact_change_id).proposals;assert.equal(p[1].comparisons[0].origin,'model');assert.equal(p[1].comparisons[0].fact_id,fact.fact_id);assert.equal(p[1].value,'头痛。');
});
