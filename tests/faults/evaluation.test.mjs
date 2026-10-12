import test from 'node:test';
import assert from 'node:assert/strict';
import {scoreCandidates,scoreVisit,selectFirstStage} from '../../scripts/evaluate-model.mjs';
const gold={candidates:[{quote:'目前没有头痛。',fields:['reported_text','symptom'],assertion:'negated',temporal_scope:'current',time:{raw:null,precision:'unknown',start:null,end:null},locator:{page:null,start:0,end:7}}]};
const candidate={field:'reported_text',value:'目前没有头痛。',assertion:'negated',temporal_scope:'current',effective_time:{raw:null,precision:'unknown',start:null,end:null,anchor_source_id:'source'},evidence:[{source_id:'source',source_text_version:1,locator:{page:null,start:0,end:7},quote:'目前没有头痛。'}]};
test('evaluation gold catches lost negation, missing candidates, extra diagnoses and wrong source independently',()=>{
 assert.deepEqual(scoreCandidates(gold,[candidate],'source'),{fields_correct:5,fields_total:5,supported:1,output_count:1,expected_count:1,matched_expected:1,semantics_pass:true});
 const bad={...candidate,assertion:'affirmed',evidence:[{...candidate.evidence[0],source_id:'foreign'}]};const score=scoreCandidates(gold,[bad,{...candidate,field:'diagnosis',value:'确诊偏头痛。'}],'source');assert.equal(score.fields_correct,4);assert.equal(score.fields_total,10);assert.equal(score.supported,0);assert.equal(score.semantics_pass,false);assert.equal(scoreCandidates(gold,[],'source').matched_expected,0);assert.equal(scoreCandidates(gold,null,'source').semantics_pass,false);
});
test('Core-rejected first stage cannot be replaced by repaired later stage in raw metrics',()=>{
 const calls=[{name:'healththread_stage_candidates',args:{candidates:'bad'},is_error:true,call_seq:3},{name:'healththread_stage_candidates',args:{candidates:[candidate]},is_error:false,call_seq:9}];assert.equal(selectFirstStage(calls).call_seq,3);assert.equal(selectFirstStage([]),null);
});
test('visit evaluation detects omitted concern and manufactured claims even with JSON-valid speech',()=>{
 const g={claims:[{quote:'目前没有头痛。',locator:{page:null,start:0,end:7}}]};const good={speech:'目前没有头痛。',claims:[{text:'目前没有头痛。',evidence:candidate.evidence,fact_refs:[]}],questions:[],unknowns:[]};assert.equal(scoreVisit(g,good,'source').semantics_pass,true);assert.equal(scoreVisit(g,{...good,speech:'确诊偏头痛。',claims:[{text:'确诊偏头痛。',evidence:[],fact_refs:[]}]},'source').semantics_pass,false);
});
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {observeRuntime,scoreTasks} from '../../scripts/evaluate-model.mjs';
import {createRuntime} from '../../agents/runtime/host.mjs';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {AgnesAgent} from '../../services/api/agnes-agent.mjs';
import {scriptedProvider,fixtureRuntime} from '../agent/scripted-provider.mjs';
test('public SDK observation retains Core-rejected first stage before repaired domain-admitted output',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-eval-observe-'));const s=new DomainStore({demoAccounts:[{username:'eval',password:'evaluation-fixture-password'}]});let runtime;t.after(async()=>{await runtime?.close();s.close();await rm(home,{recursive:true,force:true});});const uid=s.login('eval','evaluation-fixture-password').user.id;s.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const a=s.accept(uid,'entry',{text:'合成原文。'},'eval-observe-entry-001'),run=s.claimRun(a.run_id);
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_candidates',args:{candidates:'not array',base_profile_revision:1,operation_key:'eval-observe-stage-001'}},{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'eval-observe-stage-001'}},{text:'暂存'},{text:'已保存'}]);runtime=await createRuntime({home,fixture:fixtureRuntime(provider)});const observations=new Map();const agent=new AgnesAgent({runtime:observeRuntime(runtime,observations),store:s});
 await agent.run({run,tools:Object.fromEntries(Object.keys(s.toolsFor(run.id)).map(n=>[n,(args,i)=>s.toolsFor(run.id,i)[n](args)])),signal:new AbortController().signal});const record=[...observations.values()][0],first=selectFirstStage(record.sdk_stages);assert.equal(first.args.candidates,'not array');assert.equal(first.is_error,true);assert.equal(record.sdk_stages.length,2);assert.deepEqual(record.sdk_stages[1].args.candidates,[]);assert.equal(s.internalRun(run.id).repair_attempts,2);assert.equal(s.all('fact_change')[0].proposals.length,0);
});
test('care evaluation rejects invented schedules and exact-text tasks pointing to another fact',()=>{
 const confirmed=[{fact_id:'f1',revision:1,field:'instruction',value:'医嘱：每日记录。'}];const payload={tasks:[{text:'医嘱：每日记录。',instruction_refs:[{fact_id:'f1',revision:1}],schedule:null}]};assert.equal(scoreTasks(['医嘱：每日记录。'],payload,confirmed).semantics_pass,true);assert.equal(scoreTasks(['医嘱：每日记录。'],{tasks:[{...payload.tasks[0],schedule:'每天服药5mg'}]},confirmed).semantics_pass,false);assert.equal(scoreTasks(['医嘱：每日记录。'],{tasks:[{...payload.tasks[0],instruction_refs:[{fact_id:'other',revision:1}]}]},confirmed).semantics_pass,false);assert.equal(scoreTasks([],{tasks:[],explanation:'没有已确认医嘱。'},[]).semantics_pass,true);
});
test('evidence metric ignores object key ordering and separates literal support from exact time-code accuracy',()=>{
 const reordered={...candidate,evidence:[{source_id:'source',source_text_version:1,quote:'目前没有头痛。',locator:{end:7,start:0,page:null}}]};assert.equal(scoreCandidates(gold,[reordered],'source').semantics_pass,true);
 const relative={...candidate,effective_time:{...candidate.effective_time,raw:'目前',precision:'relative'}};const score=scoreCandidates(gold,[relative],'source');assert.equal(score.fields_correct,4);assert.equal(score.supported,1);assert.equal(score.semantics_pass,false);
});
import {summarizeEvidence} from '../../scripts/evaluate-model.mjs';
test('offline summary retains malformed first proposals and failed/not-run cases without borrowing final task refs as gold',()=>{
 const dataset={cases:[{id:'X',split:'heldout',workflow:'entry',gold,input:'目前没有头痛。'},{id:'Y',split:'heldout',workflow:'entry',gold,input:'目前没有头痛。'}]};const evidence={cases:[{id:'X',split:'heldout',workflow:'entry',acceptance:{source_id:'source'},primary:{status:'failed',error:'bad',repair_attempts:2,raw_first_stage:{args:{candidates:'malformed'}},final_candidates:null,sdk_stage_calls:[],admitted_stage_calls:[]}}],not_run:[{id:'Y',reason:'quota'}]};const result=summarizeEvidence(evidence,dataset,{});assert.equal(result.cases.length,1);assert.equal(result.not_run.length,1);assert.equal(result.aggregates.all.cases,2);assert.equal(result.aggregates.all.attempted_cases,1);assert.equal(result.aggregates.all.strict_raw_case_pass,0);assert.equal(result.aggregates.all.raw_candidate.expected_candidates,2);assert.deepEqual(result.aggregates.all.raw_structural_first_stage,['X']);
});
