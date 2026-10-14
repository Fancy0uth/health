import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRuntime} from '../../agents/runtime/host.mjs';
test('fixture: real public Host installs approved plugin and exact-root Skills, exposes only five tools',async()=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-fixture-'));
 let runtime;
 try{runtime=await createRuntime({home,fixture:fixtureRuntime(scriptedProvider([]))});
 assert.equal(runtime.readiness.tools.length,5); assert.equal(runtime.readiness.skills.length,7);
 assert.ok(runtime.readiness.skills.some(s=>s.name==='health-state'));
 assert.ok(runtime.readiness.skills.every(s=>s.actual==='ready'&&s.trust==='trusted'));
 assert.equal(runtime.readiness.plugins.length,1); assert.equal(runtime.readiness.plugins[0].trusted,true);
 }finally{await runtime?.close();await rm(home,{recursive:true,force:true});}
});
import {scriptedProvider,fixtureRuntime} from './scripted-provider.mjs';
import {AgnesAgent} from '../../services/api/agnes-agent.mjs';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {sentenceSpans,literalSourceTime,classifySourceMarkers} from '../../services/api/source-validation.mjs';
test('fixture: care continuation preloads its dedicated Skill and stages exact confirmed instructions through two correlated SDK tools',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-care-followup-'));let runtime;
 const store=new DomainStore({demoAccounts:[{username:'care-sdk',password:'fixture-care-password'}]});
 t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('care-sdk','fixture-care-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
 const accepted=store.accept(uid,'document',{text:'请每日记录体温。遵医嘱用药。'},'sdk-care-document-0001');store.claimRun(accepted.run_id);
 const documentTools=store.toolsFor(accepted.run_id),source=documentTools.healththread_read_source({source_id:accepted.source_id}).source;documentTools.healththread_retrieve_context({});
 const candidates=sentenceSpans(source).map(span=>({field:'instruction',value:span.quote,assertion:classifySourceMarkers(span.quote).assertion,temporal_scope:classifySourceMarkers(span.quote).temporal_scope,effective_time:literalSourceTime(span.quote,source.id),evidence:[span],proposal_kind:'new'}));
 const staged=documentTools.healththread_stage_candidates({candidates,base_profile_revision:1,operation_key:'sdk-care-candidates-0001'}),change=store.get(uid,'fact_change',staged.fact_change_id);
 const confirmed=store.confirm(uid,change.id,{accepted_change_ids:change.proposals.map(p=>p.id),expected_profile_revision:1},'sdk-care-confirm-0001'),run=store.claimRun(confirmed.continuation_run_id);
 const facts=store.profile(uid).facts,refs=facts.map(f=>({fact_id:f.fact_id,revision:f.revision}));
 const tasks=facts.map((f,i)=>({text:f.value,instruction_refs:[refs[i]],schedule:f.effective_time.raw,explanation:i?'这条医嘱要求按医生的安排用药。':'这条医嘱要求每日记录体温。',questions:i?['具体药名和剂量需要向医生确认吗？']:[]}));
 const provider=scriptedProvider([{tool:'healththread_get_confirmed_instructions',args:{document_id:accepted.document_id}},{tool:'healththread_stage_result',args:{kind:'care_plan',payload:{tasks},dependencies:refs,operation_key:'stage:'+run.id}},{text:'已暂存'}]);
 runtime=await createRuntime({home,fixture:fixtureRuntime(provider)});const agent=new AgnesAgent({runtime,store});
 const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(args,invocation)=>store.toolsFor(run.id,invocation)[n](args)]));
 const output=await agent.run({run,tools,signal:new AbortController().signal});
 const activeSkill=JSON.stringify(provider.requests[0]).match(/<active_skill>([\s\S]*?)<\/active_skill>/)?.[1];
 assert.ok(activeSkill?.includes('/care-followup'),'care continuation must preload the dedicated care-followup Skill');
 assert.ok(!activeSkill.includes('/post-visit'));
 assert.equal(output.agh.tool_receipt_ids.length,2);
 const evidence=store.all('runtime_binding')[0].evidence;assert.deepEqual(evidence.correlations.map(c=>c.tool),['healththread_get_confirmed_instructions','healththread_stage_result']);
 assert.equal(evidence.repair_attempts,0);assert.equal(store.all('fact_change',uid).length,1);
 assert.deepEqual(store.careTasks(uid).tasks.map(({text,schedule,explanation,questions})=>({text,schedule,explanation,questions})),tasks.map(({text,schedule,explanation,questions})=>({text,schedule,explanation,questions})));
});
test('fixture: record dialogue uses real SDK tool schema and persists the model questions and complete pending summary',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-record-dialogue-'));let runtime;
 const store=new DomainStore({demoAccounts:[{username:'record-sdk',password:'fixture-record-password'}]});
 t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('record-sdk','fixture-record-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
 const a=store.acceptRecordTurn(uid,{text:'目前没有头痛。'},'sdk-record-input-0001'),run=store.claimRun(a.run_id),source=store.get(uid,'source',a.source_id);
 const candidates=sentenceSpans(source).map(span=>({field:'reported_text',value:span.quote,assertion:classifySourceMarkers(span.quote).assertion,temporal_scope:classifySourceMarkers(span.quote).temporal_scope,effective_time:literalSourceTime(span.quote,source.id),evidence:[span],proposal_kind:'new'}));
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:source.id}},{tool:'healththread_retrieve_context',args:{source_ids:[]}},{tool:'healththread_stage_candidates',args:{candidates,base_profile_revision:1,operation_key:'sdk-record-stage-0001',record_dialogue:{questions:['这次还有其他身体感受吗？'],missing_fields:['用药','过敏']}}},{text:'已暂存，待用户确认'}]);
 const fixtureModels=provider.models();fixtureModels[0].input=['text','image'];provider.models=()=>fixtureModels;const visionFixture=fixtureRuntime(provider);visionFixture.profileInput.provider.routes[0].models[0].input=['text','image'];runtime=await createRuntime({home,fixture:visionFixture});const agent=new AgnesAgent({runtime,store});const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(args,invocation)=>store.toolsFor(run.id,invocation)[n](args)]));
 const output=await agent.run({run,tools,signal:new AbortController().signal});assert.equal(output.agh.tool_receipt_ids.length,3);assert.ok(JSON.stringify(provider.requests[0]).includes(a.record_thread_id));
 const thread=store.recordThreads(uid)[0];assert.equal(thread.summaries[0].questions[0],'这次还有其他身体感受吗？');assert.equal(thread.summaries[0].proposals[0].assertion,'negated');assert.equal(store.profile(uid).facts.length,0);
});
test('fixture: the home assistant uses its own preloaded Skill and three correlated SDK tools',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-chat-'));let runtime;
 const store=new DomainStore({demoAccounts:[{username:'runtime',password:'fixture-runtime-password'}]});
 t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('runtime','fixture-runtime-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
 const receipt=store.accept(uid,'chat',{question:'你好。'},'sdk-chat-fixture-0001');const run=store.claimRun(receipt.run_id);
 const source=store.get(uid,'source',receipt.source_id);const evidence={source_id:source.id,source_text_version:1,quote:source.text,locator:{page:null,start:0,end:source.text.length}};
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:source.id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_result',args:{kind:'assistant_reply',operation_key:'sdk-chat-stage-0001',dependencies:[{source_id:source.id,source_text_version:1}],payload:{format_version:2,reply:source.text,intent:'greeting',speech:'',questions:[],unknowns:[],claims:[]}}},{text:'已暂存'}]);
 runtime=await createRuntime({home,fixture:fixtureRuntime(provider)});const agent=new AgnesAgent({runtime,store});
 const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(args,invocation)=>store.toolsFor(run.id,invocation)[n](args)]));
 const output=await agent.run({run,tools,signal:new AbortController().signal});assert.equal(output.agh.tool_receipt_ids.length,3);
 assert.ok(JSON.stringify(provider.requests[0]).includes('kind=assistant_reply'));assert.equal(store.all('result',uid)[0].kind,'assistant_reply');assert.equal(store.profile(uid).facts.length,0);
});
test('fixture: genuine SDK receipts correlate three sequential bound tools and preloaded Skill',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-sdk-'));let runtime;
 const store=new DomainStore({demoAccounts:[{username:'runtime',password:'fixture-runtime-password'}]});
 t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('runtime','fixture-runtime-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const accepted=store.accept(uid,'entry',{text:'目前没有头痛。'},'genuine-sdk-fixture-0001');const run=store.claimRun(accepted.run_id);
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:accepted.source_id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'genuine-sdk-stage-0001'}},{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'genuine-sdk-stage-0001'}},{text:'已暂存'}]);
 runtime=await createRuntime({home,fixture:fixtureRuntime(provider)});const agent=new AgnesAgent({runtime,store});
 const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(a,invocation)=>store.toolsFor(run.id,invocation)[n](a)]));
 const result=await agent.run({run,tools,signal:new AbortController().signal});
 assert.equal(result.agh.tool_receipt_ids.length,3);assert.equal(result.agh.session_id.startsWith('healththread:'),true);
 assert.deepEqual(result.agh.tool_receipt_ids,store.internalRun(run.id).tool_receipts);const corr=store.all('runtime_binding')[0].evidence.correlations;assert.equal(corr.length,4);assert.equal(corr[3].replay_of_tool_use_id,corr[2].tool_use_id);assert.notEqual(corr[3].tool_use_id,corr[2].tool_use_id);
 assert.equal(provider.requests.length,5);
 assert.ok(JSON.stringify(provider.requests[0]).includes('<active_skill>'));
 assert.ok(!provider.requests[0].system.includes('coding-doctrine'));
 assert.equal(store.internalRun(run.id).status,'needs_review');
});
test('fixture: Core argument rejections consume the combined durable two-repair budget before any fourth request',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-repair-'));let runtime;const store=new DomainStore({demoAccounts:[{username:'repair',password:'fixture-repair-password'}]});t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('repair','fixture-repair-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const a=store.accept(uid,'entry',{text:'合成原文。'},'repair-budget-key-0001');const run=store.claimRun(a.run_id);
 const provider=scriptedProvider(Array.from({length:4},()=>({tool:'healththread_read_source',args:{source_id:42}})));runtime=await createRuntime({home,fixture:fixtureRuntime(provider)});const agent=new AgnesAgent({runtime,store});
 await assert.rejects(agent.run({run,tools:store.toolsFor(run.id),signal:new AbortController().signal}));
 assert.equal(provider.requests.length,3);assert.equal(store.internalRun(run.id).repair_attempts,2);assert.deepEqual(store.internalRun(run.id).tool_receipts,[]);assert.equal(store.all('runtime_binding')[0].revoked,true);
});
async function runtimeCase(t,steps){const home=await mkdtemp(join(tmpdir(),'ht-agh-case-'));const store=new DomainStore({demoAccounts:[{username:'case',password:'fixture-case-password'}]});let runtime;t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});const uid=store.login('case','fixture-case-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const accepted=store.accept(uid,'entry',{text:'合成原文。'},'case-key-0000000001');const run=store.claimRun(accepted.run_id),provider=scriptedProvider(steps(accepted));const fixtureModels=provider.models();fixtureModels[0].input=['text','image'];provider.models=()=>fixtureModels;const visionFixture=fixtureRuntime(provider);visionFixture.profileInput.provider.routes[0].models[0].input=['text','image'];runtime=await createRuntime({home,fixture:visionFixture});const agent=new AgnesAgent({runtime,store});const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(a,invocation)=>store.toolsFor(run.id,invocation)[n](a)]));return{store,run,provider,agent,tools,runtime,uid};}
test('fixture: assistant JSON cannot fabricate a stage receipt, and outer retries share the two-repair cap',async t=>{
 const f=await runtimeCase(t,()=>Array.from({length:3},()=>({text:'{"status":"completed","receipt":"invented"}'})));
 await assert.rejects(f.agent.run({run:f.run,tools:f.tools,signal:new AbortController().signal}));assert.equal(f.provider.requests.length,3);assert.deepEqual(f.store.internalRun(f.run.id).tool_receipts,[]);assert.equal(f.store.internalRun(f.run.id).repair_attempts,2);
});
test('fixture: malformed candidates reject without effects; a corrected tool gets genuine correlated receipts',async t=>{
 const f=await runtimeCase(t,a=>[{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_candidates',args:{candidates:[{value:'fabricated'}],base_profile_revision:1,operation_key:'case-stage-0000000001'}},{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'case-stage-0000000001'}},{text:'暂存'},{text:'已保存，待核对'}]);
 const result=await f.agent.run({run:f.run,tools:f.tools,signal:new AbortController().signal});assert.equal(result.agh.tool_receipt_ids.length,3);assert.equal(f.store.internalRun(f.run.id).repair_attempts,1);assert.deepEqual(f.store.all('runtime_binding')[0].evidence.turns.map(t=>t.reason),['blocked','completed']);
});
test('fixture: SDK failure after staging preserves checkpoint and actual failure reason',async t=>{
 const f=await runtimeCase(t,a=>[{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'case-stage-0000000001'}},()=>{throw new Error('FIXTURE_TRANSPORT_FAILURE');}]);
 await assert.rejects(f.agent.run({run:f.run,tools:f.tools,signal:new AbortController().signal}));assert.equal(f.store.internalRun(f.run.id).status,'needs_review');assert.equal(f.store.all('runtime_binding')[0].diagnostic.reason,'error');assert.equal(f.store.all('runtime_binding')[0].revoked,true);
});
test('fixture: abort invokes genuine SDK cancellation and revokes authority before late stage',async t=>{
 let arrived,release;const waiting=new Promise(r=>arrived=r);const hold=new Promise(r=>release=r);const f=await runtimeCase(t,a=>[async()=>{arrived();await hold;return{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'late-stage-0000000001'}};}]);const controller=new AbortController();const pending=f.agent.run({run:f.run,tools:f.tools,signal:controller.signal});await waiting;controller.abort();release();await assert.rejects(pending);assert.deepEqual(f.store.internalRun(f.run.id).tool_receipts,[]);assert.equal(f.store.all('runtime_binding')[0].revoked,true);
});
// Value-only schema failures retain the existing fallback finalization path.
test('fixture: finalization denies all tool effects and retains both actual turn outcomes',async t=>{
 const f=await runtimeCase(t,a=>[{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:0,operation_key:'finalize-denied-0001'}},{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'finalize-denied-0001'}},{text:'暂存'},{tool:'healththread_read_source',args:{source_id:a.source_id}}]);
 const source=f.store.get(f.uid,'source',f.run.source_ids[0]);await assert.rejects(f.agent.run({run:f.run,tools:f.tools,signal:new AbortController().signal}));
 assert.equal(f.store.internalRun(f.run.id).status,'needs_review');assert.equal(f.store.internalRun(f.run.id).tool_receipts.length,3);assert.equal(f.store.internalRun(f.run.id).repair_attempts,2);assert.deepEqual(f.store.get(f.uid,'source',source.id),source);assert.deepEqual(f.store.all('fact_change')[0].proposals,[]);assert.equal(f.store.all('runtime_binding')[0].diagnostic.turns[0].reason,'blocked');assert.equal(f.store.all('runtime_binding')[0].diagnostic.turns[1].reason,'blocked');
});
test('fixture: W2 server-derived fields never mutate the actual SDK arguments or receipt hash',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-visit-'));let runtime;const store=new DomainStore({demoAccounts:[{username:'visit',password:'fixture-visit-password'}]});t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});const uid=store.login('visit','fixture-visit-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const a=store.accept(uid,'visit',{current_concern:'今天想向医生说明夜间咳嗽。'},'visit-fixture-00000001'),run=store.claimRun(a.run_id);const evidence={source_id:a.source_id,source_text_version:1,locator:{page:null,start:0,end:13},quote:'今天想向医生说明夜间咳嗽。'};
 const args={kind:'visit_preparation',payload:{format_version:2,speech:evidence.quote,questions:[],unknowns:[],claims:[{text:evidence.quote,fact_refs:[],evidence:[evidence]}]},dependencies:[{source_id:a.source_id,source_text_version:1}],operation_key:'visit-stage-00000001'};const original=structuredClone(args);
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_result',args},{tool:'healththread_stage_result',args:structuredClone(args)},{text:'已保存'}]);const fixtureModels=provider.models();fixtureModels[0].input=['text','image'];provider.models=()=>fixtureModels;const visionFixture=fixtureRuntime(provider);visionFixture.profileInput.provider.routes[0].models[0].input=['text','image'];runtime=await createRuntime({home,fixture:visionFixture});const agent=new AgnesAgent({runtime,store});const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(a,i)=>store.toolsFor(run.id,i)[n](a)]));const result=await agent.run({run,tools,signal:new AbortController().signal});assert.equal(result.agh.tool_receipt_ids.length,3);assert.equal(store.all('runtime_binding')[0].evidence.correlations.length,4);assert.equal(store.all('result').length,1);assert.deepEqual(args,original);assert.deepEqual(store.all('result')[0].payload.department,{status:'not_configured'});
});
test('fixture: repeated success, failure, repaired and cancelled runs close private SDK/endpoint lifecycles before parent shutdown',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-lifecycle-'));const store=new DomainStore({demoAccounts:[{username:'lifecycle',password:'lifecycle-password'}]});const steps=[];let provider=scriptedProvider(steps);const runtime=await createRuntime({home,fixture:fixtureRuntime({models:()=>provider.models(),infer:(...args)=>provider.infer(...args)})});t.after(async()=>{await runtime.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('lifecycle','lifecycle-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});let lastConnection,closedEvents=0;
 const observed={...runtime,async openRun(){lastConnection=await runtime.openRun();lastConnection.client.on('closed',()=>closedEvents++);return lastConnection;}};const agent=new AgnesAgent({runtime:observed,store});
 let iteration=0;for(const kind of ['success','failure','repaired','cancelled','success']){steps.length=0;provider=scriptedProvider(steps);iteration++;
  const a=store.accept(uid,'entry',{text:'生命周期原文。'},'lifecycle-'+kind+'-'+iteration),run=store.claimRun(a.run_id);const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(a,i)=>store.toolsFor(run.id,i)[n](a)]));const stage={tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'lifecycle-stage-'+run.id}};
  let arrived,release;const ready=new Promise(r=>arrived=r),hold=new Promise(r=>release=r);const controller=new AbortController();
  if(kind==='cancelled')steps.push(async()=>{arrived();await hold;return stage;});
  else{steps.push({tool:'healththread_read_source',args:{source_id:a.source_id}});if(kind==='failure')steps.push(()=>{throw new Error('FIXTURE_FAILURE');});else{steps.push({tool:'healththread_retrieve_context',args:{}});if(kind==='repaired')steps.push({...stage,args:{...stage.args,candidates:[{value:'invalid'}]}});steps.push(stage,{text:'暂存'});if(kind==='repaired')steps.push({text:'已保存'});}}
  const pending=agent.run({run,tools,signal:controller.signal});if(kind==='cancelled'){await ready;controller.abort();release();}
  if(['failure','cancelled'].includes(kind))await assert.rejects(pending);else await pending;
  assert.equal(agent.sessions.size,0);assert.deepEqual(runtime.lifecycle(),{activeRunConnections:0,pendingRunConnections:0,retainedSdkSessions:0,closed:false});assert.equal(lastConnection.lifecycle().closed,true);assert.equal(lastConnection.client.isClosed,true);assert.equal(lastConnection.client.connectionState,'closed');
  for(const session of lastConnection.client.sessions.values()){assert.equal(session.closed,true);assert.equal(session.attached,false);assert.equal((await session.events()[Symbol.asyncIterator]().next()).done,true);}
  await assert.rejects(lastConnection.client.session.new({cwd:lastConnection.workspace,preset:'healththread',sessionKey:'closed-session-attempt'}));lastConnection=null;
 }
 assert.equal(closedEvents,5);
});
test('fixture: concurrent runs use independent sessions and connections without cross-run cancellation or receipt routing',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-concurrent-')),store=new DomainStore({demoAccounts:[{username:'parallel-a',password:'parallel-password-a'},{username:'parallel-b',password:'parallel-password-b'}]});let runtime;t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const cases=['parallel-a','parallel-b'].map((name,index)=>{const uid=store.login(name,'parallel-password-'+(index?'b':'a')).user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const a=store.accept(uid,'entry',{text:'独立并发原文。'},'parallel-accept-'+name);return{uid,a,run:store.claimRun(a.run_id),counter:0};});
 let arrived,release,count=0;const ready=new Promise(r=>arrived=r),hold=new Promise(r=>release=r);const steps=Array.from({length:8},()=>async req=>{const c=cases.find(c=>JSON.stringify(req).includes(c.a.source_id));assert.ok(c);const n=c.counter++;if(n===0){if(++count===2)arrived();await hold;return{tool:'healththread_read_source',args:{source_id:c.a.source_id}};}if(n===1)return{tool:'healththread_retrieve_context',args:{}};if(n===2)return{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'parallel-stage-'+c.run.id}};return{text:'已暂存'};});
 runtime=await createRuntime({home,fixture:fixtureRuntime(scriptedProvider(steps))});const agent=new AgnesAgent({runtime,store});const results=Promise.all(cases.map(c=>agent.run({run:c.run,tools:Object.fromEntries(Object.keys(store.toolsFor(c.run.id)).map(n=>[n,(a,i)=>store.toolsFor(c.run.id,i)[n](a)])),signal:new AbortController().signal})));await ready;assert.equal(runtime.lifecycle().activeRunConnections,2);assert.equal(runtime.client.sessions.size,0);release();const [a,b]=await results;assert.notEqual(a.agh.session_id,b.agh.session_id);for(const [i,result]of [a,b].entries())assert.deepEqual(result.agh.tool_receipt_ids,store.internalRun(cases[i].run.id).tool_receipts);assert.equal(runtime.lifecycle().activeRunConnections,0);assert.equal(agent.sessions.size,0);
});
test('fixture: parent shutdown awaits an opening private connection and rejects publishing it',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-open-close-'));const runtime=await createRuntime({home,fixture:fixtureRuntime(scriptedProvider([]))});t.after(async()=>{await runtime.close();await rm(home,{recursive:true,force:true});});const opening=runtime.openRun();const closing=runtime.close();await assert.rejects(opening,{code:'AGH_RUNTIME_CLOSED'});await closing;assert.deepEqual(runtime.lifecycle(),{activeRunConnections:0,pendingRunConnections:0,retainedSdkSessions:0,closed:true});
});
test('fixture: duplicate stage calls in one native batch retain both invocation sequences and one effect receipt',async t=>{
 const f=await runtimeCase(t,a=>{const stage={tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'batched-stage-replay-0001'}};return[{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},{tools:[stage,structuredClone(stage)]},{text:'已暂存'}];});const result=await f.agent.run({run:f.run,tools:f.tools,signal:new AbortController().signal});assert.equal(result.agh.tool_receipt_ids.length,3);const correlations=f.store.all('runtime_binding')[0].evidence.correlations;assert.equal(correlations.length,4);assert.ok(correlations[3].call_seq<correlations[2].result_seq);assert.ok(correlations[3].result_seq>correlations[2].result_seq);assert.equal(correlations[3].replay_of_tool_use_id,correlations[2].tool_use_id);
});

test('fixture: a valid stage after both repairs still receives one tool-disabled finalization turn',async t=>{
 const f=await runtimeCase(t,a=>[{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},...Array.from({length:2},()=>({tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:0,operation_key:'two-repairs-stage-001'}})),{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'two-repairs-stage-001'}},{text:'已暂存'},{text:'已暂存，待用户核对'}]);
 const outcome=await f.agent.run({run:f.run,tools:f.tools,signal:new AbortController().signal});
 assert.equal(f.provider.requests.length,7);
 assert.equal(f.store.internalRun(f.run.id).repair_attempts,2);
 assert.equal(outcome.agh.tool_receipt_ids.length,3);
 assert.deepEqual(f.store.all('runtime_binding')[0].evidence.turns.map(t=>t.reason),['blocked','completed']);
 assert.equal(f.store.all('fact_change').length,1);
});
test('fixture: finalization after two repairs cannot reopen tools or extend the repair budget',async t=>{
 const f=await runtimeCase(t,a=>[{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_retrieve_context',args:{}},...Array.from({length:2},()=>({tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:0,operation_key:'two-repairs-denied-01'}})),{tool:'healththread_stage_candidates',args:{candidates:[],base_profile_revision:1,operation_key:'two-repairs-denied-01'}},{text:'已暂存'},{tool:'healththread_read_source',args:{source_id:a.source_id}},{text:'不应继续'}]);
 await assert.rejects(f.agent.run({run:f.run,tools:f.tools,signal:new AbortController().signal}));
 assert.equal(f.provider.requests.length,7);
 assert.equal(f.store.internalRun(f.run.id).repair_attempts,2);
 assert.equal(f.store.internalRun(f.run.id).tool_receipts.length,3);
 assert.equal(f.store.all('fact_change').length,1);
 assert.deepEqual(f.store.all('runtime_binding')[0].diagnostic.turns.map(t=>t.reason),['blocked','blocked']);
});
test('fixture: visit repair details reach the model and corrected primary-source evidence stays correlated',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-visit-repair-'));let runtime;const store=new DomainStore({demoAccounts:[{username:'repair-visit',password:'fixture-visit-password'}]});t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('repair-visit','fixture-visit-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
 const previous=store.accept(uid,'entry',{text:'第一段原文。'},'visit-prior-repair-01');store.failRun(previous.run_id,'FIXTURE');
 const accepted=store.accept(uid,'visit',{current_concern:'第一段原文。第二段原文。',selected_source_ids:[previous.source_id]},'visit-repair-case-01'),run=store.claimRun(accepted.run_id);
 const originalSpan=sentenceSpans(store.get(uid,'source',previous.source_id))[0],primarySpan=sentenceSpans(store.get(uid,'source',accepted.source_id))[0];
 const args=(span,dependency)=>({kind:'visit_preparation',operation_key:'visit-repair-stage01',payload:{format_version:2,speech:span.quote,questions:[],unknowns:[],claims:[{text:span===originalSpan?'错误重写的原句。':span.quote,fact_refs:[],evidence:[span]}]},dependencies:[{source_id:dependency,source_text_version:1}]});
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:accepted.source_id}},{tool:'healththread_retrieve_context',args:{source_ids:[previous.source_id]}},{tool:'healththread_stage_result',args:args(originalSpan,previous.source_id)},{tool:'healththread_stage_result',args:args(primarySpan,previous.source_id)},{tool:'healththread_stage_result',args:args(primarySpan,accepted.source_id)},{text:'已暂存'},{text:'已暂存，待核对'}]);
 const fixtureModels=provider.models();fixtureModels[0].input=['text','image'];provider.models=()=>fixtureModels;const visionFixture=fixtureRuntime(provider);visionFixture.profileInput.provider.routes[0].models[0].input=['text','image'];runtime=await createRuntime({home,fixture:visionFixture});const agent=new AgnesAgent({runtime,store});const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(a,i)=>store.toolsFor(run.id,i)[n](a)]));
 const result=await agent.run({run,tools,signal:new AbortController().signal});
 assert.match(JSON.stringify(provider.requests[3]),/CLAIM_TEXT_EVIDENCE_MISMATCH/);assert.match(JSON.stringify(provider.requests[4]),/missing_dependencies/);
 assert.equal(result.agh.tool_receipt_ids.length,3);assert.equal(store.internalRun(run.id).repair_attempts,2);assert.equal(store.all('result',uid).length,1);
 assert.equal(store.all('runtime_binding')[0].evidence.turns.at(-1).reason,'completed');
});
test('fixture: v2 natural feedback reply may omit legacy empty speech and unknowns through the real SDK schema',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-chat-optional-'));let runtime;
 const store=new DomainStore({demoAccounts:[{username:'optional-sdk',password:'fixture-runtime-password'}]});
 t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const uid=store.login('optional-sdk','fixture-runtime-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
 const accepted=store.accept(uid,'chat',{question:'我会继续按医嘱记录症状，先不整理正式记录。'},'sdk-chat-optional-0001'),run=store.claimRun(accepted.run_id);
 const args={kind:'assistant_reply',operation_key:'sdk-chat-optional-stage',dependencies:[],payload:{format_version:2,intent:'records',reply:'好的，这段反馈会保留。你可以继续按原医嘱记录症状。',questions:[],claims:[]}},original=structuredClone(args);
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:accepted.source_id}},{tool:'healththread_retrieve_context',args:{}},{tool:'healththread_stage_result',args},{text:'已暂存'}]);
 runtime=await createRuntime({home,fixture:fixtureRuntime(provider)});const agent=new AgnesAgent({runtime,store}),tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(a,i)=>store.toolsFor(run.id,i)[n](a)]));
 const output=await agent.run({run,tools,signal:new AbortController().signal});assert.equal(output.agh.tool_receipt_ids.length,3);assert.equal(store.all('runtime_binding')[0].evidence.repair_attempts,0);assert.deepEqual(args,original);const result=store.all('result',uid)[0];assert.equal(result.payload.reply,args.payload.reply);assert.equal(result.payload.speech,'');assert.deepEqual(result.payload.unknowns,[]);
});
test('fixture: image uses actual SDK multimodal content and transcription Skill with two correlated scoped tools',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-agh-image-'));let runtime;
 const store=new DomainStore({demoAccounts:[{username:'vision-sdk',password:'fixture-vision-password'}]});t.after(async()=>{await runtime?.close();store.close();await rm(home,{recursive:true,force:true});});
 const {extractDocument}=await import('../../services/api/document-extraction.mjs');const {readFile}=await import('node:fs/promises');const bytes=await readFile(new URL('../fixtures/medical-note.png',import.meta.url));const document=await extractDocument(bytes,'image/png');
 const uid=store.login('vision-sdk','fixture-vision-password').user.id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const a=store.accept(uid,'document',{text:'',name:'note.png'},'sdk-image-document-0001',document),run=store.claimRun(a.run_id);
 const provider=scriptedProvider([{tool:'healththread_read_source',args:{source_id:a.source_id}},{tool:'healththread_stage_result',args:{kind:'transcription',payload:{status:'readable',text:'诊断：腹胀。',uncertainties:[],source_id:a.source_id,source_text_version:1},dependencies:[{source_id:a.source_id,source_text_version:1}],operation_key:'stage:'+run.id}},{text:'已暂存'}]);const fixtureModels=provider.models();fixtureModels[0].input=['text','image'];provider.models=()=>fixtureModels;const visionFixture=fixtureRuntime(provider);visionFixture.profileInput.provider.routes[0].models[0].input=['text','image'];runtime=await createRuntime({home,fixture:visionFixture});const agent=new AgnesAgent({runtime,store});const tools=Object.fromEntries(Object.keys(store.toolsFor(run.id)).map(n=>[n,(args,invocation)=>store.toolsFor(run.id,invocation)[n](args)]));
 const output=await agent.run({run,tools,signal:new AbortController().signal});const request=JSON.stringify(provider.requests[0]);assert.ok(request.includes('document-transcription'));assert.ok(request.includes('image/png'));assert.ok(request.includes(bytes.toString('base64')));assert.deepEqual(store.all('runtime_binding')[0].evidence.correlations.map(c=>c.tool),['healththread_read_source','healththread_stage_result']);store.setRuntime(run.id,{mode:'real',agh:output.agh});assert.equal(store.documentView(uid,a.document_id).transcript.provenance.runtime.mode,'real');
});
