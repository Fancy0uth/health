import test from 'node:test';
import assert from 'node:assert/strict';
import {healthProfileMarkup,captureDisclosureState,restoreDisclosureState} from '../../packages/client/health-profile.js';
import {NativeBridge} from '../../packages/client/native-bridge.js';
import {DomainClient,MemoryStorage} from '../../packages/client/domain-client.js';

const dimensions={body_site_symptom:'上腹不适',time_course:'昨晚开始',self_rating:null,impact_context:null,associated:'昨晚否认呕吐',measurements:null,background_care:null,evidence_status:'患者自述，尚待了解'};
const problem=(key,status='active')=>({key,title:'上腹 <不适>',body_region:'abdomen',status,assessment:'仍有不适，程度与影响尚未记录。',dimensions,source_ids:['source-private']});
const overview={format_version:2,status:'current',summary:'近期仍有上腹不适。',document_version:3,framework:'internal-framework',updated_at:'2026-10-14T01:00:00Z',problems:[problem('stable-private'),problem('ended','resolved')],background:[{summary:'病历记载：计划复查，执行未记录。',source_ids:['s2']}],uncertainties:[{summary:'程度需要进一步了解。',source_ids:['s3']}]};
test('maintained assessment hides only cited internal source IDs while keeping clinical detail and exact links',()=>{
 const id='source_05e11111-2222-4333-8444-555555555555';
 const doc={...overview,summary:`根据 ${id} 整理。`,problems:[{...problem('stable'),title:`近况 ${id}`,assessment:`资料 ${id}：2026-10-14 血压122/78mmHg。`,source_ids:[id],dimensions:{...dimensions,measurements:'2026-10-14 血压122/78mmHg',evidence_status:`门诊记录来源：${id}；另一段文字source_unrelated保持原样。`}}],background:[{summary:`相关记录 ${id}`,source_ids:[id]}],uncertainties:[{summary:`${id} 中程度未记录。`,source_ids:[id]}]};
 const before=structuredClone(doc);
 for(const mode of ['web','mobile']){
  const html=healthProfileMarkup({overview:doc},'overview',mode),visible=html.replace(/<[^>]*>/g,'');
  assert.doesNotMatch(visible,new RegExp(id));assert.match(visible,/已关联原文/);assert.match(visible,/2026-10-14 血压122\/78mmHg/);assert.match(visible,/source_unrelated保持原样/);assert.match(visible,/未记录/);
  assert.equal((html.match(new RegExp(`data-id="${id}"`,'g'))||[]).length,1);
 }
 assert.deepEqual(doc,before);
 const raw=healthProfileMarkup({current_problems:[{value:`患者原文 ${id}，122/78mmHg。`,evidence:[{source_id:id,quote:`患者原句 ${id}`}]}]},'current_problems');
 assert.match(raw,new RegExp(`患者原句 ${id}`));assert.match(raw,new RegExp(`患者原文 ${id}`));
});
test('both clients expose recent dimension prose directly and keep history and original sources secondary',()=>{
 for(const mode of ['web','mobile']){
  const html=healthProfileMarkup({overview},'overview',mode);
  const report=html.slice(0,html.indexOf('<details'));
  for(const text of ['最近的整体情况','部位与表现','上腹不适','时间与变化','昨晚开始','伴随与否定','昨晚否认呕吐','背景与处理','病历记载：计划复查','程度需要进一步了解','未记录'])assert.ok(report.includes(text),text);
  assert.doesNotMatch(report,/记录经过|来源详情|待处理差异|文档版本|<dd>未记录<\/dd>/);
  assert.doesNotMatch(html,/data-(act|action)="profile-view"/);
  assert.match(html,/<details[^>]*data-disclosure="health-ended"[^>]*>/);
  assert.match(html,/data-disclosure="health-report-sources"/);
  assert.match(html,new RegExp(`${mode==='mobile'?'data-action':'data-act'}="source"`));
  assert.doesNotMatch(html,/<不适>|internal-framework|>source-private<|>stable-private<|未记录：正常/);
 }
});
test('recent dimensions preserve distinct problems, ratings and units without pulling ended symptoms into the current report',()=>{
 const doc={...overview,background:[],uncertainties:[],problems:[
  {...problem('abdomen'),title:'胃部不适',dimensions:{...dimensions,self_rating:'昨晚用户自评4分，今早2分（0–10分）。',measurements:'今早体温36.8℃。'}},
  {...problem('knee'),title:'右膝酸',source_ids:['knee-source'],dimensions:{...dimensions,body_site_symptom:'右膝走路时酸。',time_course:'持续两天。',self_rating:'用户自评3分（0–10分）。',associated:null}},
  {...problem('old','resolved'),title:'已结束的头痛',dimensions:{...dimensions,body_site_symptom:'去年头痛。',measurements:'去年体温38.1℃。'}}
 ]};
 const before=structuredClone(doc);
 for(const mode of ['web','mobile']){
  const html=healthProfileMarkup({overview:doc},'overview',mode),recent=html.slice(0,html.indexOf('<details'));
  for(const text of ['胃部不适','右膝酸','昨晚用户自评4分，今早2分（0–10分）。','用户自评3分（0–10分）。','今早体温36.8℃。','持续两天。'])assert.ok(recent.includes(text),text);
  assert.doesNotMatch(recent,/去年头痛|38.1℃|没有呕吐|身体正常/);
  assert.equal((recent.match(/昨晚否认呕吐/g)||[]).length,1);
 }
 assert.deepEqual(doc,before);
});
test('legacy remains readable and honest; stale v2 keeps prior assessment with recovery',()=>{
 const legacy=healthProfileMarkup({overview:{status:'current',summary:'旧版内容',regions:[{id:'abdomen',label:'腹部',summary:'旧部位资料',source_ids:['s']}]}},'overview');
 assert.match(legacy,/旧版内容/);assert.match(legacy,/旧部位资料/);assert.match(legacy,/尚未完成新的问题评估/);assert.match(legacy,/更新汇总/);
 const oldFailed=healthProfileMarkup({overview:{status:'stale',summary:'保留旧版整体描述',regions:[],refresh_state:'failed',refresh_run_id:'old',refresh_retryable:true}});
 assert.match(oldFailed,/保留旧版整体描述/);assert.match(oldFailed,/尚未更新/);
 const stale=healthProfileMarkup({overview:{...overview,status:'stale',refresh_state:'failed',refresh_run_id:'run',refresh_retryable:true}},'overview');
 assert.match(stale,/仍有不适，程度与影响尚未记录/);assert.match(stale,/尚未更新/);assert.match(stale,/重试更新近况/);
 assert.equal((stale.match(/data-act="retry-recovery"/g)||[]).length,1);assert.doesNotMatch(stale,/data-act="profile-refresh"/);
});
test('report source disclosure stays open across polling and problem reordering',()=>{
 const old=[{open:true,dataset:{disclosure:'health-report-sources'}},{open:true,dataset:{disclosure:'health-ended'}}];
 const saved=captureDisclosureState({querySelectorAll:()=>old});
 const nodes=[{dataset:{disclosure:'other'}},{dataset:{disclosure:'health-ended'}},{dataset:{disclosure:'health-report-sources'}}];
 restoreDisclosureState({querySelectorAll:()=>nodes},saved);assert.deepEqual(nodes.map(n=>n.open),[false,true,true]);
 const html=healthProfileMarkup({overview:{...overview,problems:[problem('new'),problem('stable-private')]}});
 assert.match(html,/data-disclosure="health-report-sources"/);
});
test('lost refresh receipt is recovered before exposing a retry of its failed run',()=>{
 const profile={overview:{...overview,status:'stale',refresh_state:'failed',refresh_run_id:'failed-run',refresh_retryable:true}};
 for(const mode of ['web','mobile']){
  const unresolved=healthProfileMarkup(profile,'overview',mode,new Set(),{unknown:true});
  assert.match(unresolved,/查询 \/ 重试原评估请求/);assert.doesNotMatch(unresolved,/data-(act|action)="retry-recovery"/);
  const resolved=healthProfileMarkup(profile,'overview',mode,new Set(),{unknown:false});
  assert.match(resolved,/data-(act|action)="retry-recovery"/);assert.doesNotMatch(resolved,/data-(act|action)="profile-refresh"/);
 }
});
function harness({consent=true,data=true,document=null}={}){
 const client=new DomainClient({storage:new MemoryStorage(),channel:null});
 client.state.user={id:'owner'};client.sessionEpoch='session';client.scopeEpoch=1;client.allClearEpoch=0;client.csrf='csrf';
 client.state.consents={consents:[{purpose:'analysis',granted:consent}]};client.state.profile.health_profile={overview:document};
 client.state.timeline.entries=data?[{source_id:'source',source:{kind:'self_report',text:'不适'}}]:[];
 client.refresh=async()=>client.state;
 const bridge=new NativeBridge(client);bridge.refresh=async()=>bridge.snapshot();
 let calls=0;client.refreshHealthProfile=async()=>{calls++;return {run_id:null,status:'no_data'};};
 return {client,bridge,calls:()=>calls};
}
test('legacy entry upgrades only once with consent and saved data, including no-data and failure',async()=>{
 for(const opts of [{consent:false},{data:false},{document:overview},{document:{status:'stale',refresh_state:'failed',refresh_run_id:'old'}}]){
  const {bridge,calls}=harness(opts);await bridge.openHealthProfile();assert.equal(calls(),0);
 }
 const {bridge,client,calls}=harness();await bridge.openHealthProfile();await bridge.openHealthProfile();assert.equal(calls(),1);assert.match(bridge.healthProfileRefreshState().message,/没有可用于评估的已保存资料/);
 const reopened=new NativeBridge(client);reopened.refresh=async()=>reopened.snapshot();await reopened.openHealthProfile();assert.equal(calls(),1);
 const failed=harness();failed.client.refreshHealthProfile=async()=>{throw new Error('offline');};
 await assert.rejects(failed.bridge.openHealthProfile(),/offline/);await failed.bridge.openHealthProfile();assert.match(failed.bridge.healthProfileRefreshState().message,/未完成/);
});
test('manual refresh coalesces clicks and unknown outcome reuses original journal operation',async()=>{
 const {bridge,client}=harness();let release,calls=0;client.refreshHealthProfile=()=>{calls++;return new Promise(resolve=>release=resolve);};
 const first=bridge.openHealthProfile({automatic:false}),second=bridge.openHealthProfile({automatic:false});
 await Promise.resolve();assert.equal(calls,1);release({run_id:null,status:'no_data'});await Promise.all([first,second]);
 client.operations=[{id:'original',slot:'health-profile-refresh',state:'unknown'}];let retried;
 client.retryOperation=async id=>{retried=id;return {run_id:null,status:'no_data'};};
 await bridge.openHealthProfile({automatic:false});assert.equal(retried,'original');assert.equal(calls,1);
});
test('refresh API uses journalled UUID body operation key and standard operation slot',async()=>{
 const client=new DomainClient({storage:new MemoryStorage(),channel:null});let submitted;
 client.submit=(...args)=>{submitted=args;return Promise.resolve({status:'queued'});};
 await client.refreshHealthProfile();assert.equal(submitted[0],'health-profile-refresh');assert.equal(submitted[1],'/api/health-profile/refresh');assert.match(submitted[2].operation_key,/^[0-9a-f-]{36}$/);
});
test('lost refresh receipt preserves exact body UUID, auth and epoch when recovering the real journal',async()=>{
 const {client,bridge}=harness();delete client.refreshHealthProfile;
 const me={user:client.state.user,csrf_token:'csrf',scope_epoch:1,all_clear_epoch:0};client.verifySession=async()=>me;
 const requests=[];let lost=true;
 client.raw=async(path,options)=>{requests.push({path,body:structuredClone(options.body),headers:{...options.headers}});if(lost)throw new Error('response lost');return {run_id:null,status:'no_data'};};
 await assert.rejects(bridge.openHealthProfile({automatic:false}),{code:'OUTCOME_UNKNOWN'});
 const op=client.pendingOperations()[0];assert.equal(op.slot,'health-profile-refresh');assert.match(op.body.operation_key,/^[0-9a-f-]{36}$/);
 await bridge.openHealthProfile();assert.equal(requests.length,1);
 lost=false;await bridge.openHealthProfile({automatic:false});assert.equal(requests.length,2);assert.deepEqual(requests[0],requests[1]);
 assert.equal(requests[1].headers['X-CSRF-Token'],'csrf');assert.equal(requests[1].headers['X-HealthThread-Epoch'],'1');assert.equal(client.pendingOperations().length,0);
});
test('late refresh cannot publish status or continue a request after identity scope changes',async()=>{
 const {client,bridge}=harness();let finish;client.refreshHealthProfile=()=>new Promise(resolve=>finish=resolve);
 const request=bridge.openHealthProfile({automatic:false});await Promise.resolve();client.invalidateScope();finish({run_id:'old-run',status:'queued'});
 await assert.rejects(request,{code:'SESSION_CHANGED'});assert.equal(bridge.healthProfileRefreshState().busy,false);assert.equal(bridge.healthProfileRefreshState().message,undefined);
});
