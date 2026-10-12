import test from 'node:test';import assert from 'node:assert/strict';
import {DomainStore} from '../../services/api/domain-store.mjs';
function setup(t){const s=new DomainStore({demoAccounts:[{username:'runtime',password:'runtime-fixture-password'}]});t.after(()=>s.close());const uid=s.login('runtime','runtime-fixture-password').user.id;s.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});const a=s.accept(uid,'entry',{text:'目前没有头痛。'},'binding-fixture-key-0001');s.claimRun(a.run_id);return {s,uid,a};}
test('durable runtime binding rejects identity forgery and records exact invocation provenance',t=>{const {s,uid,a}=setup(t);assert.equal(typeof s.reserveRuntime,'function');const key=s.reserveRuntime(a.run_id);assert.ok(!JSON.stringify(s.get(uid,'run',a.run_id)).includes(key));s.bindRuntimeSession(a.run_id,key,key);assert.throws(()=>s.checkRuntime(a.run_id,'forged'));const args={source_id:a.source_id};const out=s.toolsFor(a.run_id,{session_key:key,tool_use_id:'sdk-tool-1'}).healththread_read_source(args);const receipt=s.get(uid,'tool_receipt',out.receipt.id);assert.equal(receipt.agh_session_id,key);assert.equal(receipt.agh_tool_use_id,'sdk-tool-1');assert.match(receipt.args_hash,/^[0-9a-f]{64}$/);s.cancel(uid,a.run_id);assert.throws(()=>s.checkRuntime(a.run_id,key));});
test('durable repair counter counts only two admitted repairs and deduplicates a ledger result',t=>{const {s,a}=setup(t);assert.equal(typeof s.reserveRuntime,'function');const key=s.reserveRuntime(a.run_id);s.bindRuntimeSession(a.run_id,key,key);s.recordRuntimeRepair(a.run_id,key,'tool-result:5');s.recordRuntimeRepair(a.run_id,key,'tool-result:5');s.recordRuntimeRepair(a.run_id,key,'outer:1');assert.equal(s.internalRun(a.run_id).repair_attempts,2);assert.throws(()=>s.recordRuntimeRepair(a.run_id,key,'tool-result:9'),{code:'OUTPUT_REPAIR_EXHAUSTED'});assert.throws(()=>s.checkRuntime(a.run_id,key));});
test('read_source exposes exact immutable sentence locators and validator returns actionable field errors',t=>{
 const {s,a}=setup(t);const tools=s.toolsFor(a.run_id);const read=tools.healththread_read_source({source_id:a.source_id});
 assert.deepEqual(read.sentence_spans,[{source_id:a.source_id,source_text_version:1,locator:{page:null,start:0,end:7},quote:'目前没有头痛。'}]);tools.healththread_retrieve_context({});
 const candidate={field:'reported_text',value:'目前没有头痛。',assertion:'affirmed',temporal_scope:'current',effective_time:{raw:null,precision:'unknown',start:null,end:null,timezone:null,anchor_source_id:a.source_id},evidence:read.sentence_spans,proposal_kind:'new'};
 const stage=c=>tools.healththread_stage_candidates({candidates:[c],base_profile_revision:1,operation_key:'validator-feedback-0001'});
 assert.throws(()=>stage({...candidate,fact_id:'invented'}),e=>e.details?.path==='candidates[0].fact_id');
 assert.throws(()=>stage(candidate),e=>e.details?.path==='candidate.assertion'&&e.details.expected==='negated');
});
import {sentenceSpans,validateEvidence} from '../../services/api/source-validation.mjs';
test('sentence spans preserve UTF-16 emoji, CRLF and exact PDF page boundaries with finite bounds',()=>{
 const source={id:'s',text_version:1,text:'第一句😀。\r\n第二句。',pages:[]};const spans=sentenceSpans(source);assert.equal(spans.length,2);assert.deepEqual(spans.map(e=>e.locator),[{page:null,start:0,end:6},{page:null,start:8,end:12}]);assert.equal(source.text,'第一句😀。\r\n第二句。');assert.equal(validateEvidence(spans,()=>source).length,2);
 const pdf={id:'p',text_version:1,text:'第一页。\n第二页。',pages:[{page:1,start:0,end:4},{page:2,start:5,end:9}]};assert.deepEqual(sentenceSpans(pdf).map(e=>e.locator.page),[1,2]);assert.equal(validateEvidence(sentenceSpans(pdf),()=>pdf).length,2);
 assert.throws(()=>sentenceSpans({...pdf,text:'跨页句子。',pages:[{page:1,start:0,end:2},{page:2,start:2,end:5}]}),{code:'SOURCE_SPAN_CROSSES_PAGE'});
 assert.throws(()=>sentenceSpans({...source,text:'句。'.repeat(101)}),{code:'SOURCE_SPANS_LIMIT'});
});
