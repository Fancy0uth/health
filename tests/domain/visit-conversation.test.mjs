import test from 'node:test';
import assert from 'node:assert/strict';
import {DomainStore} from '../../services/api/domain-store.mjs';
function fixture(t){const s=new DomainStore({demoAccounts:[{username:'a',password:'password-123'},{username:'b',password:'password-456'}]});t.after(()=>s.close());const a=s.login('a','password-123').user.id,b=s.login('b','password-456').user.id;for(const u of [a,b])s.setConsent(u,{purpose:'analysis',granted:true,expected_version:1});return {s,a,b};}
function chat(s,u,text,selected=[]){const x=s.accept(u,'chat',{question:text,selected_source_ids:selected},'chat-'+crypto.randomUUID());s.failRun(x.run_id,'FIXTURE');return x;}
function visitResult(s,u,input){const x=s.accept(u,'visit',input,'visit-'+crypto.randomUUID());s.claimRun(x.run_id);const tools=s.toolsFor(x.run_id),{source}=tools.healththread_read_source({source_id:x.source_id});tools.healththread_retrieve_context({});const staged=tools.healththread_stage_result({kind:'visit_preparation',operation_key:'result-'+crypto.randomUUID(),dependencies:[{source_id:source.id,source_text_version:1}],payload:{speech:source.text,questions:[],unknowns:[],claims:[{text:source.text,fact_refs:[],evidence:[{source_id:source.id,source_text_version:1,locator:{page:null,start:0,end:source.text.length},quote:source.text}]}]}});return {...x,...staged};}
test('conversation visits include all chronological user turns and regenerate without a new concern',t=>{
 const {s,a,b}=fixture(t);let last;const texts=[];for(let n=0;n<8;n++){texts.push(`第${n}条描述。`);last=chat(s,a,texts.at(-1),last?[last.source_id]:[]);}
 const card=visitResult(s,a,{conversation_id:last.conversation_id});
 assert.equal(s.get(a,'source',card.source_id).text,texts.join('\n'));
 assert.equal(s.get(a,'result',card.result_id).conversation_id,last.conversation_id);
 const retry=s.accept(a,'visit',{previous_result_id:card.result_id},'regenerate-card-001');assert.equal(s.get(a,'source',retry.source_id).text,texts.join('\n'));
 assert.throws(()=>s.accept(b,'visit',{conversation_id:last.conversation_id},'foreign-conversation-001'),{code:'NOT_FOUND'});
 assert.throws(()=>s.accept(b,'visit',{previous_result_id:card.result_id},'foreign-card-retry-001'),{code:'NOT_FOUND'});
});
test('durable patient edits preserve generated payload and enforce ownership revisions scope and stale state',t=>{
 const {s,a,b}=fixture(t),card=visitResult(s,a,{current_concern:'原始描述。'}),original=s.get(a,'result',card.result_id).payload;
 const body={speech:'患者编辑后的表达。',questions:['患者自己的问题'],expected_edit_revision:0};
 assert.equal(typeof s.editVisit,'function');
 const edited=s.editVisit(a,card.result_id,body,'patient-edit-card-001',s.user(a).epoch);
 assert.deepEqual(edited.payload,original);assert.equal(edited.user_edit.revision,1);assert.equal(edited.user_edit.speech,body.speech);
 assert.deepEqual(s.editVisit(a,card.result_id,body,'patient-edit-card-001',s.user(a).epoch),edited);
 assert.throws(()=>s.editVisit(a,card.result_id,body,'patient-edit-conflict',s.user(a).epoch),{code:'REVISION_CONFLICT'});
 assert.throws(()=>s.editVisit(b,card.result_id,body,'patient-edit-foreign',s.user(b).epoch),{code:'NOT_FOUND'});
 assert.throws(()=>s.editVisit(a,card.result_id,{...body,expected_edit_revision:1},'patient-edit-epoch01',1),{code:'SCOPE_EPOCH_CONFLICT'});
 s.invalidate(a,x=>x.id===card.result_id,'stale');const staleEdit=s.editVisit(a,card.result_id,{...body,speech:'来源变化后仍可修改表达。',expected_edit_revision:1},'patient-edit-stale01',s.user(a).epoch);assert.equal(staleEdit.user_edit.revision,2);assert.equal(staleEdit.user_edit.speech,'来源变化后仍可修改表达。');assert.equal(staleEdit.status,'stale');assert.equal(staleEdit.validity,'stale');assert.deepEqual(staleEdit.payload,original);
 const retry=s.accept(a,'visit',{previous_result_id:card.result_id},'regenerate-legacy-001');assert.equal(s.get(a,'source',retry.source_id).text,'原始描述。');
});

test('chat context exposes earlier assistant questions as context only and retains all user sources',t=>{
 const {s,a}=fixture(t),first=s.accept(a,'chat',{question:'头痛。'},'dialogue-question-001');s.claimRun(first.run_id);
 const tools=s.toolsFor(first.run_id),{source,sentence_spans}=tools.healththread_read_source({source_id:first.source_id});tools.healththread_retrieve_context({});
 tools.healththread_stage_result({kind:'assistant_reply',operation_key:'dialogue-result-001',dependencies:[{source_id:source.id,source_text_version:1}],payload:{intent:'clarify',speech:source.text,questions:['开始多久了？'],unknowns:[],claims:[{text:source.text,evidence:sentence_spans,fact_refs:[]}]}});
 const second=s.accept(a,'chat',{question:'三天。',selected_source_ids:[first.source_id]},'dialogue-question-002');s.claimRun(second.run_id);
 const context=s.toolsFor(second.run_id).healththread_retrieve_context({});
 assert.deepEqual(context.sources.map(source=>source.text),['三天。','头痛。']);
 assert.deepEqual(context.conversation_messages.map(m=>[m.role,m.text]),[['user','头痛。'],['assistant','开始多久了？'],['user','三天。']]);
 assert.equal(context.conversation_messages[1].context_only,true);
 assert.ok(context.sources.every(source=>source.text!=='开始多久了？'));
});
test('deleted conversation turns and excess dialogue size fail explicitly without partial card creation',t=>{
 const {s,a}=fixture(t),first=chat(s,a,'原始描述。'),second=chat(s,a,'补充描述。',[first.source_id]);
 s.deleteData(a,first.source_id,'delete-dialogue-001');
 assert.throws(()=>s.accept(a,'visit',{conversation_id:second.conversation_id},'deleted-dialogue-card'),{code:'SOURCE_DELETED'});
 const other=chat(s,a,'新的完整描述。');s.limits.textBytes=4;
 assert.throws(()=>s.accept(a,'visit',{conversation_id:other.conversation_id},'large-dialogue-card1'),{code:'PAYLOAD_TOO_LARGE'});
 assert.equal(s.all('run',a).filter(r=>r.workflow==='visit').length,0);
});

test('an old edit receipt cannot replay erased patient text after deletion',t=>{
 const {s,a}=fixture(t),card=visitResult(s,a,{current_concern:'待删除描述。'}),body={speech:'待删除患者修改。',questions:[],expected_edit_revision:0};
 s.editVisit(a,card.result_id,body,'deleted-edit-receipt');s.deleteData(a,card.source_id,'delete-edited-card01');
 assert.throws(()=>s.editVisit(a,card.result_id,body,'deleted-edit-receipt'),{code:'SOURCE_DELETED'});
});

test('deleting a conversation turn also erases copied card concerns and their regenerated descendants',t=>{
 const {s,a}=fixture(t),chatTurn=chat(s,a,'必须彻底删除的原文。');
 const card=visitResult(s,a,{conversation_id:chatTurn.conversation_id});
 const regenerated=visitResult(s,a,{previous_result_id:card.result_id});
 s.deleteData(a,chatTurn.source_id,'delete-derived-card1');
 assert.equal(s.timeline(a).entries.length,0);
 assert.equal(s.all('source',a).length,0);
 assert.throws(()=>s.get(a,'result',regenerated.result_id),{code:'NOT_FOUND'});
});

test('visit repair diagnostics identify primary concern evidence and missing source dependencies',t=>{
 const {s,a}=fixture(t),prior=chat(s,a,'第一轮原文。'),next=chat(s,a,'第二轮原文。',[prior.source_id]);
 const card=s.accept(a,'visit',{conversation_id:next.conversation_id},'diagnostic-visit-001');s.claimRun(card.run_id);
 const tools=s.toolsFor(card.run_id),primary=tools.healththread_read_source({source_id:card.source_id});const context=tools.healththread_retrieve_context({});
 const span=context.source_spans.find(x=>x.source_id===prior.source_id).sentence_spans[0];
 const payload={speech:span.quote,questions:[],unknowns:[],claims:[{text:span.quote,fact_refs:[],evidence:[span]}]};
 assert.throws(()=>tools.healththread_stage_result({kind:'visit_preparation',payload,dependencies:[{source_id:prior.source_id,source_text_version:1}],operation_key:'diagnostic-stage-001'}),error=>{
   assert.equal(error.code,'INVALID_AGENT_OUTPUT');assert.equal(error.details?.path,'payload.claims');assert.equal(error.details?.required_source_id,card.source_id);assert.match(error.details?.rule||'',/dependencies/);return true;
 });
 const correctedSpan=primary.sentence_spans[0];payload.claims=[{text:correctedSpan.quote,fact_refs:[],evidence:[correctedSpan]}];payload.speech=correctedSpan.quote;
 assert.throws(()=>tools.healththread_stage_result({kind:'visit_preparation',payload,dependencies:[{source_id:prior.source_id,source_text_version:1}],operation_key:'diagnostic-stage-001'}),error=>{
   assert.equal(error.code,'INVALID_AGENT_OUTPUT');assert.equal(error.details?.path,'dependencies');assert.deepEqual(error.details?.missing_dependencies,[{source_id:card.source_id,source_text_version:1}]);return true;
 });
 assert.equal(s.all('result',a).length,0);
 const saved=tools.healththread_stage_result({kind:'visit_preparation',payload,dependencies:[{source_id:card.source_id,source_text_version:1}],operation_key:'diagnostic-stage-001'});
 assert.ok(saved.result_id);
});

test('question safety rejection identifies questions and preserves source duration through a local repair',t=>{
 const {s,a}=fixture(t),card=s.accept(a,'visit',{current_concern:'最近三天饭后腹胀，没有吃药，过敏史不清楚。'},'question-repair-visit');s.claimRun(card.run_id);
 const tools=s.toolsFor(card.run_id),{source,sentence_spans}=tools.healththread_read_source({source_id:card.source_id});tools.healththread_retrieve_context({});
 const args={kind:'visit_preparation',operation_key:'question-repair-stage',dependencies:[{source_id:source.id,source_text_version:1}],payload:{speech:source.text,questions:['针对我最近三天饭后腹胀、没有吃药、过敏史不清楚的情况，需要补充哪些检查？'],unknowns:[],claims:[{text:source.text,fact_refs:[],evidence:sentence_spans}]}};
 assert.throws(()=>tools.healththread_stage_result(args),error=>{assert.equal(error.code,'INVALID_AGENT_OUTPUT');assert.equal(error.details?.path,'payload.questions');assert.equal(error.details?.question_index,0);assert.match(error.details?.rule||'',/speech/);assert.match(error.details?.rule||'',/non-numeric/);return true;});
 assert.equal(s.all('result',a).length,0);
 args.payload.questions=['针对我描述的腹胀情况，就诊时需要补充哪些信息？'];
 const saved=tools.healththread_stage_result(args),result=s.get(a,'result',saved.result_id);
 assert.equal(result.payload.speech,source.text);assert.deepEqual(result.payload.claims,args.payload.claims);assert.deepEqual(result.payload.questions,args.payload.questions);
});
test('patient can edit or clear unknowns while omitted fields preserve prior content and original model payload',t=>{const {s,a}=fixture(t),card=visitResult(s,a,{current_concern:'腹胀。'}),original=s.get(a,'result',card.result_id).payload;const first=s.editVisit(a,card.result_id,{speech:'腹胀，开始时间已说明。',questions:[],unknowns:['只需补充持续时间。'],expected_edit_revision:0},'edit-unknowns-first-001');assert.deepEqual(first.user_edit.unknowns,['只需补充持续时间。']);assert.deepEqual(first.payload,original);const legacy=s.editVisit(a,card.result_id,{speech:'饭后腹胀。',questions:[],expected_edit_revision:1},'edit-unknowns-legacy-01');assert.deepEqual(legacy.user_edit.unknowns,first.user_edit.unknowns);assert.throws(()=>s.editVisit(a,card.result_id,{speech:'饭后腹胀。',questions:[],unknowns:['x'.repeat(2001)],expected_edit_revision:2},'edit-unknowns-long-001'),{code:'INVALID_INPUT'});const cleared=s.editVisit(a,card.result_id,{speech:'饭后腹胀。',questions:[],unknowns:[],expected_edit_revision:2},'edit-unknowns-clear-001');assert.deepEqual(cleared.user_edit.unknowns,[]);assert.equal(cleared.user_edit.revision,3);assert.deepEqual(cleared.payload,original);});
