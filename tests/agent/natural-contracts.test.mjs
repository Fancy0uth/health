import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {AGH_ROOT} from '../../scripts/build-agh-runtime.mjs';
const require=createRequire(join(AGH_ROOT,'packages/host/package.json'));
const Ajv=require('ajv/dist/2020.js').default;
const schema=JSON.parse(await readFile(new URL('../../contracts/schemas/healththread_stage_result.json',import.meta.url)));
const validate=new Ajv({strict:false,allErrors:true}).compile(schema);
const chat=(payload)=>({kind:'assistant_reply',payload:{speech:'',questions:[],unknowns:[],claims:[],intent:'clarify',...payload},dependencies:[],operation_key:'natural-contract-001'});
test('v2 chat accepts complete natural reply and each scoped action intent',()=>{
 for(const intent of ['clarify','offer_visit','offer_record','offer_both','confirm_visit','confirm_record','confirm_both']){
  const payload=chat({format_version:2,reply:'听起来已经影响到你了。这三天每天会出现几次？',intent,...(intent.startsWith('confirm_')?{confirmation_quote:'可以，就按刚才说的整理吧。',confirmation_offer_id:'offer-run'}:{})});
  assert.equal(validate(payload),true,JSON.stringify(validate.errors));
 }
});
test('v2 chat rejects missing reply and malformed confirmation evidence',()=>{
 assert.equal(validate(chat({format_version:2})),false);
 assert.equal(validate(chat({format_version:2,reply:'正在整理。',intent:'confirm_record'})),false);
 assert.equal(validate(chat({format_version:2,reply:'正在整理。',intent:'confirm_record',confirmation_quote:'',confirmation_offer_id:'offer-run'})),false);
 assert.equal(validate(chat({format_version:2,reply:45})),false);
});
test('legacy chat and visit remain accepted while v2 visit allows a separate natural narrative',()=>{
 assert.equal(validate(chat({intent:'offer_visit'})),true);
 for(const format of [{},{format_version:2}])assert.equal(validate({kind:'visit_preparation',payload:{...format,speech:'近三天反复头痛，用户后来更正为右侧。具体原因尚不明确。',questions:['这三天的症状还需要向医生补充什么'],unknowns:[],claims:[]},dependencies:[],operation_key:'natural-contract-002'}),true,JSON.stringify(validate.errors));
 assert.equal(validate(chat({format_version:3,reply:'你好'})),false);
});
test('record candidate metadata may carry a natural summary without replacing evidence',async()=>{
 const schema=JSON.parse(await readFile(new URL('../../contracts/schemas/healththread_stage_candidates.json',import.meta.url)));
 const validate=new Ajv({strict:false}).compile(schema);
 assert.equal(validate({candidates:[],base_profile_revision:1,operation_key:'natural-contract-003',record_dialogue:{summary:'近三天右侧头痛，未提及发热。',questions:[],missing_fields:[]}}),true,JSON.stringify(validate.errors));
});
test('runtime action instructions distinguish asking for confirmation from execution consent',async()=>{
 const skill=await readFile(new URL('../../agents/runtime/skills/health-assistant/SKILL.md',import.meta.url),'utf8');
 // Keep the observed real-model failure as a semantic example in the shipped skill.
 assert.ok(skill.includes('对，就是这些情况。现在想保存记录并生成就诊沟通卡，你再确认一下。'));
 assert.match(skill,/没有.*pending_action_offer.*offer_/);
 assert.match(skill,/拒绝.*旧提议.*失效/);
 assert.match(schema.$defs.chat_payload.properties.intent.description,/asking.*permission.*offer_/i);
 assert.match(schema.$defs.chat_payload.properties.confirmation_offer_id.description,/Never invent.*empty/i);
});
test('a fresh both-action offer needs no consent evidence; an empty confirmation id is rejected',()=>{
 assert.equal(validate(chat({format_version:2,intent:'offer_both',reply:'我可以保存记录并生成沟通卡。你确认可以吗？'})),true);
 assert.equal(validate(chat({format_version:2,intent:'confirm_both',reply:'我会开始整理。',confirmation_quote:'对，就是这些情况。现在想保存记录并生成就诊沟通卡，你再确认一下。',confirmation_offer_id:''})),false);
});
test('runtime summary check preserves untouched symptom fields and resolves negation scope',async()=>{
 const skill=await readFile(new URL('../../agents/runtime/skills/health-assistant/SKILL.md',import.meta.url),'utf8');
 assert.match(skill,/只更正开始时间.*不能.*一阵一阵.*不是一阵一阵/);
 assert.match(skill,/否定词.*作用范围/);
 assert.match(skill,/助手旧总结.*不是证据/);
});
test('record and visit summaries exclude product workflow and correction discussion',async()=>{
 for(const name of ['health-record','visit-preparation']){
  const skill=await readFile(new URL('../../agents/runtime/skills/'+name+'/SKILL.md',import.meta.url),'utf8');
  assert.match(skill,/最终有效的患者健康状态/);
  assert.match(skill,/不叙述.*保存记录.*生成.*同意.*更正/);
 }
});
test('record candidates exclude partially superseded sentences and conversational acknowledgments',async()=>{
 const skill=await readFile(new URL('../../agents/runtime/skills/health-record/SKILL.md',import.meta.url),'utf8');
 assert.ok(skill.includes('肚脐周围，从昨天晚上开始，一阵一阵的，感觉比较轻。'));
 assert.match(skill,/任何健康成分.*已被更正.*整句.*排除/);
 assert.match(skill,/对，就是这些情况。.*其他内容没问题。.*不.*候选/);
 assert.match(skill,/仍有效.*自然摘要.*不.*伪造/);
});
test('v2 visit defaults to server-linked sources and keeps its version during repairs',async()=>{
 const skill=await readFile(new URL('../../agents/runtime/skills/visit-preparation/SKILL.md',import.meta.url),'utf8');
 assert.match(skill,/默认.*claims=\[\]/);
 assert.match(skill,/服务端.*source_ids/);
 assert.match(skill,/修复.*format_version:2.*不得.*省略/);
 assert.doesNotMatch(skill,/至少一条 claim/);
 assert.match(schema.$defs.claim.description,/optional.*v2/i);
});
test('natural records accept bounded source sentence selections without model-made evidence',async()=>{
 const schema=JSON.parse(await readFile(new URL('../../contracts/schemas/healththread_stage_candidates.json',import.meta.url)));
 const validate=new Ajv({strict:false}).compile(schema);
 const args={candidates:[],record_source_refs:[{source_id:'authorized-concern',sentence_index:0}],base_profile_revision:1,operation_key:'natural-reference-001',record_dialogue:{summary:'今天早饭后开始间歇腹痛。',questions:[],missing_fields:[]}};
 assert.equal(validate(args),true,JSON.stringify(validate.errors));
 assert.equal(validate({...args,record_dialogue:{questions:[],missing_fields:[]}}),false);
 assert.equal(validate({...args,record_source_refs:Array.from({length:101},(_,sentence_index)=>({source_id:'authorized-concern',sentence_index}))}),false);
 for(const ref of [{source_id:'source',sentence_index:-1},{source_id:'source',sentence_index:0.5},{source_id:'source'},{source_id:'source',sentence_index:0,quote:'伪造'}])assert.equal(validate({...args,record_source_refs:[ref]}),false);
});
