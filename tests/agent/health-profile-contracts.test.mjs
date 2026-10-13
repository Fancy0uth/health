import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join} from 'node:path';
import {AGH_ROOT} from '../../scripts/build-agh-runtime.mjs';
const require=createRequire(join(AGH_ROOT,'packages/host/package.json'));
const Ajv=require('ajv/dist/2020.js').default;
const read=async(name)=>JSON.parse(await readFile(new URL('../../contracts/schemas/'+name+'.json',import.meta.url)));
const stageSchema=await read('healththread_stage_candidates');
const validate=new Ajv({strict:false,allErrors:true}).compile(stageSchema);
const natural=(extra={})=>({candidates:[],record_source_refs:[{source_id:'patient-source',sentence_index:0}],record_dialogue:{summary:'今天右侧头痛。',questions:[],missing_fields:[]},base_profile_revision:1,operation_key:'health-profile-contract-001',...extra});
const observation={dimension:'body_site',value:'右侧',unit:null,observed_at:'今天'};
const candidate={field:'reported_text',value:'今天右侧头痛。',assertion:'affirmed',temporal_scope:'current',effective_time:{raw:'今天',precision:'unknown',start:null,end:null,timezone:null,anchor_source_id:'patient-source'},evidence:[{source_id:'patient-source',source_text_version:1,locator:{page:null,start:0,end:7},quote:'今天右侧头痛。'}],proposal_kind:'new'};
test('compact document schema requires classification and a native overview, without ambiguous manual inputs',()=>{
 const input={candidates:[],document_source_refs:[{source_id:'document',sentence_index:0,field:'reported_text'}],overview:{summary:'有来源的记录。',regions:[]},base_profile_revision:1,operation_key:'compact-document-contract'};
 assert.equal(validate(input),true,JSON.stringify(validate.errors));
 for(const bad of [{...input,overview:JSON.stringify(input.overview)},{...input,candidates:[candidate]},{...input,document_source_refs:[{source_id:'document',sentence_index:0}]},{...input,document_source_refs:[{source_id:'document',sentence_index:0,field:'invented'}]}])assert.equal(validate(bad),false);
 const noOverview=structuredClone(input);delete noOverview.overview;assert.equal(validate(noOverview),false);
});
test('health observations extend both candidate paths without making metadata mandatory',async()=>{
 assert.equal(validate(natural()),true);
 assert.equal(validate(natural({record_source_refs:[{source_id:'patient-source',sentence_index:0,health_observations:[observation]}]})),true,JSON.stringify(validate.errors));
 const manual={candidates:[{...candidate,health_observations:[observation]}],base_profile_revision:1,operation_key:'health-profile-contract-002'};
 assert.equal(validate(manual),true,JSON.stringify(validate.errors));
 const checkCandidate=new Ajv({strict:false}).compile(await read('candidate'));
 assert.equal(checkCandidate(candidate),true);
 assert.equal(checkCandidate(manual.candidates[0]),true,JSON.stringify(checkCandidate.errors));
 for(const invalid of [{...observation,dimension:'diagnosis'},{...observation,value:''},{...observation,unit:4},{...observation,observed_at:{}},{...observation,score:2}]){
  assert.equal(validate(natural({record_source_refs:[{source_id:'patient-source',sentence_index:0,health_observations:[invalid]}]})),false);
 }
});
test('stage comparisons refer to a candidate and specific fact revision with a bounded reason',()=>{
 const comparison={candidate_index:0,fact_id:'existing-fact',revision:2,relation:'conflict',reason:'新旧资料对当前同一项描述不同，待患者核对。'};
 for(const relation of ['conflict','update','duplicate','related'])assert.equal(validate(natural({comparisons:[{...comparison,relation}]})),true,JSON.stringify(validate.errors));
 for(const invalid of [{...comparison,candidate_index:-1},{...comparison,revision:0},{...comparison,relation:'replace'},{...comparison,reason:''},{...comparison,owner:'other'}])assert.equal(validate(natural({comparisons:[invalid]})),false);
});
test('care explanation and questions are optional bounded additions to exact instruction tasks',async()=>{
 const validate=new Ajv({strict:false,allErrors:true}).compile(await read('healththread_stage_result'));
 const base={kind:'care_plan',payload:{tasks:[{text:'遵医嘱用药。',instruction_refs:[{fact_id:'instruction',revision:1}],schedule:null}]},dependencies:[{fact_id:'instruction',revision:1}],operation_key:'health-profile-care-001'};
 assert.equal(validate(base),true);
 const extended=structuredClone(base);Object.assign(extended.payload.tasks[0],{explanation:'这条医嘱要求按医生的安排用药。',questions:['具体药名和剂量需要向医生确认吗？']});
 assert.equal(validate(extended),true,JSON.stringify(validate.errors));
 for(const invalid of [{explanation:3},{explanation:'x'.repeat(4001)},{questions:['']},{questions:Array(11).fill('需要澄清吗？')}]){
  const args=structuredClone(base);Object.assign(args.payload.tasks[0],invalid);assert.equal(validate(args),false);
 }
});
test('shipped extraction skills submit structured observations and current-fact comparisons',async()=>{
 for(const name of ['health-record','post-visit']){
  const skill=await readFile(new URL('../../agents/runtime/skills/'+name+'/SKILL.md',import.meta.url),'utf8');
  for(const term of ['health_observations','body_site','self_rating','measurement','observed_at','comparisons','candidate_index','conflict','update','duplicate','related'])assert.ok(skill.includes(term),`${name} missing ${term}`);
  assert.match(skill,/当前.*已确认.*fact/);
 }
 const post=await readFile(new URL('../../agents/runtime/skills/post-visit/SKILL.md',import.meta.url),'utf8');
 assert.match(post,/diagnosis.*不能.*推断/);
});
test('HTTP contract exposes review resolutions and versioned episode and feedback mutations',async()=>{
 const api=JSON.parse(await readFile(new URL('../../contracts/openapi.yaml',import.meta.url)));
 const schemas=api.components.schemas;
 for(const name of ['Candidate','Proposal','FactRevision'])assert.ok(schemas[name].properties.health_observations,name);
 assert.ok(schemas.Profile.properties.health_profile);
 for(const name of ['TaskPayload','CareTask'])assert.ok(schemas[name].properties.explanation&&schemas[name].properties.questions,name);
 const confirm=api.paths['/api/fact-changes/{id}/confirm'].post.requestBody.content['application/json'].schema;
 assert.ok(confirm.properties.resolutions);
 for(const [path,method] of [['/api/episodes/{id}','patch'],['/api/care-tasks/{id}/feedback','post']]){
  const operation=api.paths[path]?.[method];assert.ok(operation,path);
  assert.ok(operation.requestBody.content['application/json'].schema.required.includes('expected_version'));
  assert.ok(operation.parameters.some(p=>p.$ref==='#/components/parameters/HealthThreadEpoch'));
 }
});
test('only v2 chat permits omitted legacy speech and unknowns while supplied fields remain strict',async()=>{
 const schema=await read('healththread_stage_result'),check=new Ajv({strict:false,allErrors:true}).compile(schema);
 const base={kind:'assistant_reply',payload:{format_version:2,intent:'records',reply:'这段反馈会保留，原医嘱不变。',questions:[],claims:[]},dependencies:[],operation_key:'v2-optional-empty-fields'};
 assert.equal(check(base),true,JSON.stringify(check.errors));
 for(const payload of [{...base.payload,speech:null},{...base.payload,unknowns:null},{...base.payload,unknowns:[4]},{...base.payload,speech:4},{...base.payload,questions:undefined},{...base.payload,claims:undefined},{...base.payload,format_version:undefined}])assert.equal(check({...base,payload}),false);
 assert.equal(check({...base,kind:'visit_preparation',payload:{format_version:2,questions:[],claims:[]}}),false);
});
test('care Skill keeps the two-tool continuation scope and source dependencies when physician instructions are empty',async()=>{
 const skill=await readFile(new URL('../../agents/runtime/skills/care-followup/SKILL.md',import.meta.url),'utf8');
 assert.match(skill,/healththread_get_confirmed_instructions → healththread_stage_result/);
 assert.doesNotMatch(skill,/按需 retrieve_context|需要更具体资料时调用 retrieve_context/);
 assert.match(skill,/instructions=\[\][\s\S]*guidance[\s\S]*source_id[\s\S]*source_text_version/);
 assert.doesNotMatch(skill,/instructions=\[\]，提交[\s\S]{0,150}dependencies:\[\]/);
});
test('automatic record Skills separate saved provenance, health overview, and reported adherence time',async()=>{
 const assistant=await readFile(new URL('../../agents/runtime/skills/health-assistant/SKILL.md',import.meta.url),'utf8'),record=await readFile(new URL('../../agents/runtime/skills/health-record/SKILL.md',import.meta.url),'utf8');
 assert.doesNotMatch(assistant,/记录候选始终待患者核对事实/);assert.doesNotMatch(record.split('---')[1],/待患者核对的事实候选/);
 assert.match(assistant,/当前普通记录在运行核验后已自动保存，仅实际冲突需核实/);assert.match(assistant,/只能写“患者报告今天执行；医嘱计划3天”，不能写已执行近3天/);
 for(const skill of [assistant,record]){assert.match(skill,/overview.summary 和每个分区摘要各用 1–3 句通俗中文描述有来源的健康近况/);assert.match(skill,/不写 image_transcript\/readable\/uncertainties 等处理元数据或保存、核对等产品状态/);assert.match(skill,/patient_report 只称患者自述，不称已确认/);}
});
test('workflow schema narrowing retains confirmation conditions, limits and untouched legacy contract',async()=>{
 const {schemasForWorkflow}=await import('../../agents/runtime/plugin/workflow-schemas.mjs');const original=await read('healththread_stage_result'),chat=schemasForWorkflow('chat').healththread_stage_result,check=new Ajv({strict:false}).compile(chat),legacy=new Ajv({strict:false}).compile(original);
 const base={kind:'assistant_reply',operation_key:'scoped-condition-check',dependencies:[],payload:{format_version:2,intent:'clarify',reply:'需要生成沟通卡吗？',questions:[],claims:[]}};
 assert.equal(check(base),true);assert.equal(check({...base,payload:{...base.payload,intent:'confirm_visit'}}),false);assert.equal(check({...base,payload:{...base.payload,questions:Array(21).fill('问题？')}}),false);assert.equal(check({...base,payload:{...base.payload,reply:'x'.repeat(20001)}}),false);assert.equal(check({...base,payload:{...base.payload,unexpected:true}}),false);
 const old={...base,payload:{intent:'clarify',speech:'旧版原句。',questions:[],claims:[],unknowns:[]}};assert.equal(legacy(old),true);assert.equal(check(old),false);assert.deepEqual(schemasForWorkflow('entry').healththread_stage_result,original);assert.deepEqual(schemasForWorkflow('document').healththread_stage_result,original);assert.throws(()=>schemasForWorkflow('untrusted-workflow'),{code:'AGH_WORKFLOW_INVALID'});
 chat.$defs.chat_payload.properties.reply.maxLength=99999;assert.equal(schemasForWorkflow('chat').healththread_stage_result.$defs.chat_payload.properties.reply.maxLength,20000);
});
test('overview field descriptions guide plain health summaries without introducing rejection rules',async()=>{
 const result=await read('healththread_stage_result'),overviews=[stageSchema.properties.overview,result.$defs.chat_payload.properties.automatic_record.properties.overview];
 for(const overview of overviews){for(const summary of [overview.properties.summary,overview.properties.regions.items.properties.summary]){assert.match(summary.description,/1–3/);assert.match(summary.description,/image_transcript/);assert.match(summary.description,/patient_report/);assert.match(summary.description,/计划/);assert.equal(summary.maxLength,20000);assert.equal(summary.pattern,undefined);}assert.match(overview.properties.regions.description,/同一部位/);}
});
test('compact chat public contract adds exclusive refs while active runtime avoids duplicated claim/candidate output',async()=>{
 const schema=await read('healththread_stage_result'),{schemasForWorkflow}=await import('../../agents/runtime/plugin/workflow-schemas.mjs'),publicCheck=new Ajv({strict:false}).compile(schema),activeCheck=new Ajv({strict:false}).compile(schemasForWorkflow('chat').healththread_stage_result),automatic={action:'save',summary:'患者报告没有恶心。',record_source_refs:[{source_id:'source',sentence_index:0,field:'reported_text'}],overview:{summary:'患者报告没有恶心。',regions:[]}},args={kind:'assistant_reply',operation_key:'compact-contract-example',dependencies:[],payload:{format_version:2,intent:'clarify',reply:'记下了。',questions:[],claims:[],automatic_record:automatic}};
 assert.equal(publicCheck(args),true,JSON.stringify(publicCheck.errors));assert.equal(activeCheck(args),true,JSON.stringify(activeCheck.errors));
 const old=structuredClone(args);delete old.payload.automatic_record.record_source_refs;old.payload.automatic_record.candidates=[candidate];assert.equal(publicCheck(old),true,JSON.stringify(publicCheck.errors));assert.equal(activeCheck(old),false);
 for(const mutate of [a=>a.payload.automatic_record.candidates=[],a=>a.payload.claims=[{text:'原句',fact_refs:[],evidence:[]}],a=>a.payload.automatic_record.record_source_refs[0].source_text_version=2,a=>a.payload.automatic_record.record_source_refs[0].sentence_index=-1,a=>a.payload.automatic_record.record_source_refs[0].field='invented',a=>delete a.payload.automatic_record.record_source_refs]){const bad=structuredClone(args);mutate(bad);assert.equal(activeCheck(bad),false);}
 const skip={...args,payload:{...args.payload,automatic_record:{action:'skip',reason:'无健康信息。'}}};assert.equal(activeCheck(skip),true);delete skip.payload.automatic_record.reason;assert.equal(activeCheck(skip),false);
});
