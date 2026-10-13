import * as healthUI from '../../packages/client/health-profile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isRecordConfirmation} from '../../packages/client/record-dialogue.js';
const source=(await readFile(new URL('../../apps/mobile/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function mobile(options={}) {
  let html='',body;const listeners={},events={};
  const root={contains:()=>false,querySelector:()=>null,get innerHTML(){return html;},set innerHTML(v){this.renderCount=(this.renderCount||0)+1;html=v;body={scrollTop:0,scrollHeight:1600,clientHeight:400,scrollTo({top}){this.scrollTop=top;}};}};
  const overlay={innerHTML:'',querySelector:()=>({showModal(){},addEventListener(){},close(){}})};const toast={textContent:'',classList:{add(){},remove(){}}};
  const data={sessions:[],records:[],tasks:[],documents:[],consent:{organize:true},factHistory:[],selectedHistory:[],factVersion:1};
  const store={data,preferences:{reduceMotion:true},reload(){},persist:()=>true,record:id=>data.records.find(r=>r.id===id),session:id=>data.sessions.find(s=>s.id===id),sessions:()=>data.sessions,pending:()=>0,cardExists:()=>false,stale:()=>false,ensureSession:()=>data.sessions[0]};
  const native={copyText:()=> '合成沟通卡',client:{getDraft:()=>'',pendingOperations:()=>[],setDraft(){},clearDraftIf(){},state:{user:{username:'test'},runs:{}}},review:async id=>({id:'change-'+id,source_ids:[id],review_revision:1,proposals:[{id:'p',value:'合成记录'}]})};
  Object.assign(data,options.data||{});native.sources=new Map(options.sources||[]);
  const testLocation={hash:options.hash||'#home'},testHistory={replaceState(_state,_unused,hash){testLocation.hash=hash;},pushState(_state,_unused,hash){testLocation.hash=hash;}};
  const context=vm.createContext({...healthUI,AbortController,isRecordConfirmation,nativeBridge:()=>native,store,window:{addEventListener:(name,fn)=>listeners[name]=fn},document:{activeElement:null,getElementById:id=>({app:root,overlays:overlay,toast})[id],querySelector:s=>s==='.screen-body'?body:null,documentElement:{classList:{toggle(){}}},addEventListener:(name,fn)=>events[name]=fn},navigator:{onLine:true},location:testLocation,history:testHistory,setTimeout:()=>0,clearTimeout(){},requestAnimationFrame:fn=>fn(),matchMedia:()=>({matches:true,addEventListener(){}}),assertionLabel:()=>'',scopeLabel:()=>'',executionLabel:()=>'',CSS:{escape:v=>v},console,appendAssistantReply(sessions,id,message){sessions.find(s=>s.id===id).messages.push({role:'assistant',...message});}});
  native.waitDocument=(...args)=>native.wait(...args);
  vm.runInContext(source,context);
  return {location:testLocation,root,overlay,data,native,events,body:()=>body,sync:()=>listeners['healththread:state'](),run:code=>vm.runInContext(code,context)};
}
test('mobile background refresh already preserves the main reading position',()=>{
  const p=mobile();p.body().scrollTop=380;p.sync();assert.equal(p.body().scrollTop,380);
});
test('mobile reply completion must not pull a reader away from earlier messages',async()=>{
  const p=mobile();p.data.sessions=[{id:'chat',title:'合成对话',messages:[],updatedAt:'2026-10-13'}];
  p.run("route={page:'home',view:'chat',id:'chat'};drafts.ask='合成问题';let finishReply;askAssistant=()=>new Promise(resolve=>finishReply=resolve)");
  const pending=p.run('sendChat()');p.body().scrollTop=320;p.run("finishReply({answer:'合成回复'})");await pending;assert.equal(p.body().scrollTop,320);
});
test('mobile record completion cannot scroll a different page',async()=>{
  const p=mobile();p.native.recordTurn=async()=>({record_thread_id:'thread',source_id:'r',run_id:'run'});
  p.run('let finishRecord;native.wait=()=>new Promise(resolve=>finishRecord=resolve)');
  const pending=p.run("saveRecord('合成记录')");await new Promise(resolve=>setImmediate(resolve));p.run("go('timeline')");p.body().scrollTop=220;p.run('finishRecord()');await pending;assert.equal(p.body().scrollTop,220);
});
test('mobile review binds later corrections to the original record rather than its evidence IDs',async()=>{
  const p=mobile();p.data.records=[{id:'original',proposals:[]}];p.native.review=async()=>({id:'second',source_ids:['correction2','correction1'],proposals:[{id:'p',value:'最新更正'}]});
  await p.run("openReview('original')");p.run("checked.add('p');render()");assert.ok(p.run('capturedReview(activeRecord())'));assert.match(p.root.innerHTML,/<button[^>]*data-action="confirm-review"(?![^>]*disabled)[^>]*>/);
});
for(const medical of [false,true])test(`mobile ${medical?'medical':'record'} review accepts candidates arriving after opening`,async()=>{
  const p=mobile(),item={id:'r',source_id:'r',text:'原文',original:'原文',proposals:[]};p.data.records=[item];p.data.medical=item;
  p.native.review=async()=>{throw Object.assign(new Error('not ready'),{code:'NO_PENDING_CANDIDATES'});};await p.run(`openReview('r',false,${medical})`);
  item.change_id='ready';item.proposals=[{id:'p',value:'候选'}];p.native.client.factChange=async()=>({id:'ready',status:'pending',source_ids:['r'],review_revision:1,proposals:item.proposals});await p.sync();
  p.run(`${medical?'medicalChecked':'checked'}.add('p');render()`);assert.ok(p.run(`capturedReview(${medical?'d().medical':'activeRecord()'},${medical})`));
});
test('mobile edit opens full text, keeps typing through sync and submits the selected fact version',async()=>{
  const p=mobile();p.data.records=[{id:'r',text:'原文',facts:[{fact_id:'f1',revision:1,value:'第一条'},{fact_id:'f2',revision:3,value:'第二条'}]}];
  await p.run("action('correct',{dataset:{id:'r'}})");assert.match(p.root.innerHTML,/name="editText"/);
  p.events.change({target:{name:'editFact',value:'f2'}});p.events.input({target:{name:'editText',value:'更正后的第二条'}});await p.sync();assert.match(p.root.innerHTML,/更正后的第二条/);
  let submitted;p.native.editRecord=async(...args)=>{submitted=args;return {source_id:'r'};};await p.run("action('confirm-correction',{dataset:{}})");assert.deepEqual(submitted,['r','更正后的第二条','f2',3]);
});
test('explicit record submission reveals its saved turn without waiting for analysis',async()=>{
  const p=mobile();p.native.recordTurn=async()=>({record_thread_id:'thread',source_id:'r',run_id:'run'});
  p.run('let finishRecord;native.wait=()=>new Promise(resolve=>finishRecord=resolve)');const pending=p.run("saveRecord('合成记录')");
  await new Promise(resolve=>setImmediate(resolve));const submittedTop=p.body().scrollTop;p.run('finishRecord()');await pending;assert.equal(submittedTop,1600);
});
test('mobile explicit missing record targets never select a different record',async()=>{
  const p=mobile();p.data.records=[{id:'other',text:'其他记录',change_id:'change'}];let reads=0;p.native.review=async()=>{reads++;return {proposals:[]};};
  await p.run("openReview('deleted')");assert.equal(reads,0);
  await p.run("action('correct',{dataset:{id:'deleted'}})");assert.notEqual(p.run('route.view'),'correct');
  p.run("route={page:'home',view:'review',id:'deleted'}");assert.equal(p.run('activeRecord()'),undefined);
});
test('mobile latest requested review wins when reads complete out of order',async()=>{
  const p=mobile();p.data.records=[{id:'a',text:'甲'},{id:'b',text:'乙'}];const resolvers={};p.native.review=id=>new Promise(resolve=>resolvers[id]=resolve);
  const a=p.run("openReview('a')"),b=p.run("openReview('b')");resolvers.b({proposals:[]});await b;resolvers.a({proposals:[]});await a;assert.equal(p.run('route.id'),'b');
});
test('mobile pending review cannot reopen a page after navigation',async()=>{
  const p=mobile();p.data.records=[{id:'a',text:'甲'}];let finish;p.native.review=()=>new Promise(resolve=>finish=resolve);
  const pending=p.run("openReview('a')");p.run("go('timeline')");finish({proposals:[]});await pending;assert.equal(p.run('route.page'),'timeline');assert.equal(p.run('route.view'),'');
});
test('mobile confirmation completion preserves a newer review and its selection',async()=>{
  const p=mobile();p.data.records=[{id:'a',text:'甲'},{id:'b',text:'乙'}];await p.run("openReview('a');");p.run("checked.add('p')");let finish;p.native.confirm=()=>new Promise(resolve=>finish=resolve);
  const pending=p.run('confirmReview()');await p.run("openReview('b')");p.run("checked.add('p')");finish({});await pending;assert.equal(p.run('route.id'),'b');assert.equal(p.run("checked.has('p')"),true);
});
test('mobile card display and print use the signed in identity without invented source IDs',()=>{
  const p=mobile();p.data.questions=[];p.run("store.cardExists=()=>true;store.speech=()=> '表达稿'");
  const card=p.run('communicationCard()'),print=p.run('printCard()');assert.doesNotMatch(card+print,/林悦/);assert.match(card,/test/);assert.doesNotMatch(card,/data-id="r1"/);
});
test('mobile export accurately describes the complete account export',()=>{
  const p=mobile();const html=p.run('exportPage()');assert.doesNotMatch(html,/export-range|选择导出范围/);assert.match(html,/当前账号/);
});
test('mobile printed card uses the same canonical content as copied card',()=>{
  const p=mobile();p.data.questions=[];p.run("store.speech=()=> '旧草稿'");p.native.copyText=()=> '当前表达稿\n用户已编辑的问题\n来源：合成原文';
  const html=p.run('printCard()');assert.match(html,/当前表达稿/);assert.match(html,/用户已编辑的问题/);assert.match(html,/来源：合成原文/);assert.doesNotMatch(html,/旧草稿/);
});
test('mobile card edits cannot be saved onto a replacement result',async()=>{
  const p=mobile();p.data.cardResultId='old';p.data.questions=['旧问题'];p.run("store.speech=()=> '旧表达'");await p.run("action('edit-card',{dataset:{}})");p.data.cardResultId='new';
  await p.run("action('save-card',{dataset:{}})");assert.equal(p.data.cardEdit,undefined);
});
for(const operation of ['correction','retry-accept','retry-complete','parse-accept','parse-complete','generate','analysis'])test(`mobile ${operation} completion preserves navigation away and back`,async()=>{
  const p=mobile();p.data.records=[{id:'r',text:'原文',run_id:'run'}];p.data.consent.parse=true;p.data.currentConcern='本次困扰';p.data.medical={source_id:'doc',original:'病历'};
  p.run("route={page:'home',view:'review',id:'r'};drafts.editText='更正原文'");let finish;const delayed=()=>new Promise(resolve=>finish=resolve);p.native.wait=async()=>{};p.native.retryEntry=async()=>({run_id:'run'});p.native.createDocument=async()=>({run_id:'run',source_id:'doc'});
  let pending;
  if(operation==='correction'){p.native.editRecord=delayed;pending=p.run("action('confirm-correction',{dataset:{}})");}
  else if(operation.startsWith('retry')){if(operation==='retry-accept')p.native.retryEntry=delayed;else p.native.wait=delayed;pending=p.run("action('retry-analysis',{dataset:{}})");}
  else if(operation.startsWith('parse')){if(operation==='parse-accept')p.native.createDocument=delayed;else p.native.wait=delayed;pending=p.run("parseMedical('合成病历')");}
  else if(operation==='analysis'){p.native.wait=delayed;pending=p.run("analyzeRecord(store.record('r'))");}
  else{p.data.sessions=[{id:'chat',messages:[{role:'user',text:'合成问题'},{role:'assistant',text:'合成回复'}]}];p.native.generateVisit=delayed;pending=p.run("action('generate-card',{dataset:{id:'chat'}})");}
  await new Promise(resolve=>setImmediate(resolve));const page=p.run('route.page'),view=p.run('route.view'),id=p.run('route.id');p.run("go('timeline')");p.run(`go(${JSON.stringify(page)},${JSON.stringify(view)},${JSON.stringify(id)})`);p.run("checked.add('new-selection')");
  finish({source_id:'r',run_id:'run'});await pending;await new Promise(resolve=>setImmediate(resolve));assert.equal(p.run('route.page'),page);assert.equal(p.run('route.view'),view);assert.equal(p.run('route.id'),id);assert.equal(p.run("checked.has('new-selection')"),true);
});
test('mobile canonical card validity is independent of unrelated profile revisions',async()=>{
  const code=(await readFile(new URL('../../apps/mobile/store.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replace(/\bexport /g,'');const context=vm.createContext({loadData:()=>({records:[],sessions:[],cardVersion:1,factVersion:9,cardSourceDeleted:false,cardResultId:'result'}),localStorage:{getItem:()=>null}});vm.runInContext(code,context);assert.equal(vm.runInContext('stale()',context),false);assert.equal(vm.runInContext('data.cardSourceDeleted=true;stale()',context),true);
});
test('mobile versions do not infer conflicts between unrelated global dates or invent evidence IDs',()=>{
  const p=mobile();p.data.symptomStart='2026-01-01';p.data.medical={onset:'2026-10-01'};p.data.factHistory=[{version:2,oldValue:'旧值',newValue:'新值'},{version:3,recordId:'correction-source',oldValue:'旧值',newValue:'新值'}];
  const html=p.run('versions()');assert.doesNotMatch(html,/病历候选与当前日期不同|data-id="r1"/);assert.match(html,/data-id="correction-source"/);
});
test('mobile correction evidence remains readable after deduplication removes its standalone record',()=>{
  const p=mobile();p.native.sources=new Map([['correction-source',{id:'correction-source',text:'用户更正的完整原文',recorded_at:'2026-10-13T10:00:00Z'}]]);p.run("openSheet('source','correction-source')");const html=p.run('overlays.innerHTML');assert.match(html,/用户更正的完整原文/);assert.doesNotMatch(html,/原始记录已不存在|data-action="correct"/);
});

test('mobile completed card link opens the exact saved result only when clicked',async()=>{
  const p=mobile();p.data.sessions=[{id:'origin',messages:[{role:'user',text:'完整问题'},{role:'assistant',text:'已生成',action:'card',visit_result_id:'result-1'}]}];p.run("route={page:'home',view:'chat',id:'origin'};render()");assert.equal(p.run('route.page'),'home');
  await p.run("action('view-chat-card',{dataset:{id:'result-1'}})");assert.equal(p.data.selectedCardResultId,'result-1');assert.equal(p.run('route.page'),'card');
});
test('mobile empty card starts an assistant conversation instead of a blank visit form',async()=>{
  const p=mobile();assert.match(p.run('communicationCard()'),/data-action="start-card-chat"/);await p.run("action('start-card-chat',{dataset:{}})");assert.equal(p.run('route.page'),'home');assert.equal(p.run('inputMode'),'ask');assert.notEqual(p.run('route.view'),'visit');
});
test('mobile regeneration uses canonical context once and clears busy after failure',async()=>{
  const p=mobile();let calls=0,fail;p.native.regenerateVisit=()=>{calls++;return new Promise((resolve,reject)=>fail=reject);};const first=p.run("action('regenerate-card',{dataset:{}})");await p.run("action('regenerate-card',{dataset:{}})");assert.equal(calls,1);fail(new Error('生成失败'));await first;assert.equal(p.run('cardBusy'),false);assert.match(p.run('cardError'),/请重试/);
});
test('mobile edits save durably with captured revision and keep conflicting drafts',async()=>{
  const p=mobile();p.data.cardResultId='result';p.data.cardEditRevision=4;p.data.questions=['问题'];p.run("store.speech=()=> '原稿'");await p.run("action('edit-card',{dataset:{}})");p.run("drafts.speech='我的修改';drafts.questions='问题一\\n问题二'");let args;p.native.saveCardEdit=async(...values)=>{args=values;throw Object.assign(new Error('版本冲突'),{code:'REVISION_CONFLICT'});};await assert.rejects(p.run("action('save-card',{dataset:{}})"),/版本冲突/);assert.deepEqual(JSON.parse(JSON.stringify(args)),['result','我的修改',['问题一','问题二'],4,[]]);assert.equal(p.run('drafts.speech'),'我的修改');assert.equal(p.run('route.view'),'editCard');assert.equal(p.run('cardSaveBusy'),false);
});
test('mobile card omits unsupported medical fields and keeps editing distinct from fact confirmation',()=>{
  const p=mobile();p.data.questions=[];p.run("store.cardExists=()=>true;store.speech=()=> '模型表达稿';route={page:'card',view:'editCard'}");assert.doesNotMatch(p.run('communicationCard()'),/用药情况|过敏情况|开始时间/);assert.doesNotMatch(p.run('footer()'),/确认内容|confirm-card/);assert.match(p.run('footer()'),/save-card/);
});

test('mobile card source and remaining questions come from canonical card data',()=>{
  const p=mobile();p.data.questions=[];p.data.cardSourceId='saved-concern';p.data.cardConversationId='origin-chat';p.data.cardUnknowns=['症状持续时间待补充'];p.run("store.cardExists=()=>true;store.speech=()=> '没有腹胀'");const html=p.run('communicationCard()');assert.match(html,/data-action="source" data-id="saved-concern"/);assert.doesNotMatch(html,/data-action="source" data-id="origin-chat"/);assert.match(html,/症状持续时间待补充/);assert.match(html,/医生沟通卡/);assert.doesNotMatch(html,/<h2[^>]*>胃部不适/);
});
test('mobile card saving waits once and cannot navigate away from a newer page',async()=>{
  const p=mobile();p.data.cardResultId='result';p.data.questions=['问题'];p.run("store.speech=()=> '表达'");await p.run("action('edit-card',{dataset:{}})");let calls=0,finish;p.native.saveCardEdit=()=>{calls++;return new Promise(resolve=>finish=resolve);};const pending=p.run("action('save-card',{dataset:{}})");await p.run("action('save-card',{dataset:{}})");assert.equal(calls,1);assert.equal(p.run('route.view'),'editCard');p.run("go('timeline')");finish();await pending;assert.equal(p.run('route.page'),'timeline');assert.equal(p.run('cardSaveBusy'),false);
});
test('mobile keeps preparation replies conversational without a generation CTA',()=>{
  const p=mobile();p.data.sessions=[{id:'origin',title:'对话',messages:[{role:'user',text:'问题'},{role:'assistant',text:'回复一',action:'visit'},{role:'assistant',text:'回复二',action:'visit'},{role:'assistant',text:'查看时间线',action:'timeline'}]}];p.run("route={page:'home',view:'chat',id:'origin'}");
  for(const html of [p.run('chat()'),p.run('conversation()')]){assert.equal((html.match(/data-action="generate-card"/g)||[]).length,0);assert.doesNotMatch(html,/data-action="message-visit"/);assert.match(html,/data-action="message-timeline"/);}
});
test('mobile card renders each canonical source only once including the concern source',()=>{
  const p=mobile();p.data.questions=[];p.data.cardSourceId='concern';p.data.cardRecords=[{id:'concern',text:'本次困扰'},{id:'history',text:'历史记录'},{id:'history',text:'重复历史'}];p.run("store.cardExists=()=>true;store.speech=()=> '表达稿'");const html=p.run('communicationCard()');assert.equal((html.match(/data-action="source" data-id="concern"/g)||[]).length,1);assert.equal((html.match(/data-action="source" data-id="history"/g)||[]).length,1);
});
test('mobile generation failure preserves the current card and reports actionable messages without leaking provider errors',async()=>{
  for(const [code,expected] of [['DEPENDENCY_UNAVAILABLE','沟通卡暂时未生成成功，对话和已有卡片已保留。请重试。'],['NO_VISIT_CONVERSATION','请先在首页和助手聊聊本次就诊情况，再生成沟通卡。'],['CONVERSATION_NOT_READY','请等待本次对话回复完成，再生成沟通卡。'],['SOURCE_DELETED','原来的对话或资料已删除，请在首页重新描述本次情况后生成。'],['CONSENT_REQUIRED','请先在设置中授权健康记录整理，再生成沟通卡。']]){
    const p=mobile();p.data.cardResultId='existing';p.data.cardDraft='已有内容';p.native.regenerateVisit=async()=>{throw Object.assign(new Error('RAW_PROVIDER_STACK'),{code});};await p.run("action('regenerate-card',{dataset:{}})");assert.equal(p.run('cardError'),expected);assert.equal(p.run('cardBusy'),false);assert.equal(p.data.cardResultId,'existing');assert.equal(p.data.cardDraft,'已有内容');
  }
});

test('mobile chat and history expose only completed card links without generation buttons',()=>{
  const p=mobile();p.data.sessions=[{id:'chat',title:'聊天',updatedAt:'2026-10-13',messages:[{role:'user',text:'你好'},{role:'assistant',text:'你好',action:'visit'}]}];p.run("go('home','chat','chat')");
  assert.doesNotMatch(p.root.innerHTML,/data-action="generate-card"/);
  p.run("go('home','conversation','chat')");assert.doesNotMatch(p.root.innerHTML,/data-action="generate-card"/);
  p.data.sessions[0].messages.push({role:'assistant',text:'沟通卡已生成。',action:'card',visit_result_id:'card-1'});p.run("go('home','chat','chat')");
  assert.match(p.root.innerHTML,/查看沟通卡/);assert.match(p.root.innerHTML,/data-action="view-chat-card"[^>]*data-id="card-1"/);
});
test('restored regeneration stays busy and cannot submit a duplicate on mobile',async()=>{
  const p=mobile();Object.assign(p.data,{cardRegenerationPending:true,questions:[]});p.run("store.cardExists=()=>true;store.speech=()=> '已保存卡片';go('card');let submissions=0;native.regenerateVisit=async()=>{submissions++}");
  assert.match(p.root.innerHTML,/<button[^>]*data-action="regenerate-card"[^>]*disabled/);assert.match(p.root.innerHTML,/正在重新生成沟通卡/);
  await p.run("action('regenerate-card',{dataset:{}})");assert.equal(p.run('submissions'),0);
});

test('mobile main composer and record-change route always use natural chat',async()=>{
 const p=mobile();assert.doesNotMatch(p.run('composer()'),/data-action="mode-record"/);
 await p.run("action('record-change',{dataset:{}})");
 p.run("drafts.ask='有点不舒服';sendChat=()=> 'chat';saveRecord=()=> 'record'");assert.equal(p.run('submitMessage()'),'chat');
});

test('mobile authorized child retries stay in conversation and prevent duplicate submission',async()=>{
 const p=mobile();p.data.sessions=[{id:'chat',messages:[{role:'assistant',text:'整理未完成',visit_retry_run_id:'visit',record_retry_run_id:'record'}]}];p.run("route={page:'home',view:'chat',id:'chat'};render()");assert.match(p.root.innerHTML,/重试整理记录/);assert.match(p.root.innerHTML,/重试生成沟通卡/);
 p.run("let finishAction;let childCalls=0;native.retryAssistantAction=()=>{childCalls++;return new Promise(resolve=>finishAction=resolve)}");const pending=p.run("action('retry-chat-action',{dataset:{id:'visit'}})");await p.run("action('retry-chat-action',{dataset:{id:'visit'}})");assert.equal(p.run('childCalls'),1);p.run('finishAction()');await pending;assert.equal(p.run('route.view'),'chat');
});

test('mobile card retains unique source links without printing raw transcripts',()=>{
 const p=mobile();Object.assign(p.data,{questions:[],cardSourceId:'assembled',cardRecords:[{id:'assembled',text:'完整拼接对话和生成指令'},{id:'turn',text:'单轮原话和工作流命令'},{id:'turn',text:'重复依赖'}]});p.run("store.cardExists=()=>true;store.speech=()=> '自然就诊摘要'");const html=p.run('communicationCard()');assert.match(html,/自然就诊摘要/);assert.doesNotMatch(html,/完整拼接对话|单轮原话|重复依赖/);assert.match(html,/2 份来源/);assert.equal((html.match(/data-action="source" data-id="turn"/g)||[]).length,1);
});
test('mobile successful regeneration replaces a stale network error with current status',async()=>{
 const p=mobile();p.run("notify('Failed to fetch')");assert.doesNotMatch(p.run('toastNode.textContent'),/Failed to fetch/);assert.match(p.run('toastNode.textContent'),/连接|网络/);
 p.native.regenerateVisit=async()=>{};await p.run('generateCard(null,true)');assert.match(p.run('toastNode.textContent'),/沟通卡已更新/);
});

test('mobile record details lead with the saved summary and source opens the original',async()=>{
 const p=mobile();p.data.records=[{id:'saved',text:'完整原话和保存指令',summary:'这三天主要是饭后腹胀。',status:'pending',analysis:'complete'}];await p.run("action('record-detail',{dataset:{id:'saved'}})");assert.match(p.run('overlays.innerHTML'),/这三天主要是饭后腹胀/);assert.doesNotMatch(p.run('overlays.innerHTML'),/完整原话和保存指令/);assert.match(p.run('overlays.innerHTML'),/查看来源/);
 await p.run("action('source',{dataset:{id:'saved'}})");assert.match(p.run('overlays.innerHTML'),/完整原话和保存指令/);
});

test('mobile late card completion clears its error only after receipt verification',async()=>{
 const p=mobile();p.run("cardError='沟通卡暂时未生成成功';cardErrorRunId='late'");p.native.client.state.runs.late={id:'late',status:'completed',result_id:'card'};p.native.client.state.results=[{id:'card'}];await p.sync();assert.match(p.run('cardError'),/未生成成功/);
 p.native.client.state.runs.late.runtime={mode:'real'};await p.sync();assert.equal(p.run('cardError'),'');
});

test('mobile card editor allows clearing all remaining items explicitly',async()=>{
 const p=mobile();Object.assign(p.data,{cardResultId:'card',cardEditRevision:2,questions:[],cardUnknowns:['矛盾的待补充项']});p.run("store.speech=()=> '正文'");await p.run("action('edit-card',{dataset:{}})");assert.match(p.root.innerHTML,/还需补充（每行一项）/);assert.match(p.root.innerHTML,/矛盾的待补充项/);p.events.input({target:{name:'unknowns',value:''}});let saved;p.native.saveCardEdit=async(...args)=>{saved=args;};await p.run("action('save-card',{dataset:{}})");assert.deepEqual(Array.from(saved[4]),[]);
});
test('mobile profile has four views and correction input survives refresh',async()=>{
 const p=mobile();p.data.healthProfile={current_problems:[],events:[],background:[],unknowns:[{dimension:'impact'}]};p.native.client.state.profile={facts:[{fact_id:'f',revision:2,value:'旧描述'}]};
 await p.run("action('health-profile',{dataset:{}})");assert.match(p.root.innerHTML,/身体近况/);await p.run("action('profile-view',{dataset:{view:'unknowns'}})");assert.match(p.root.innerHTML,/生活影响/);
 await p.run("action('profile-correct',{dataset:{id:'f',version:'2'}})");p.events.input({target:{name:'profileCorrection',value:'编辑中的正确原话'}});await p.sync();assert.match(p.root.innerHTML,/编辑中的正确原话/);
});
test('mobile medical review preserves exact old fact version and submits keep existing',async()=>{
 const p=mobile();p.data.medical={source_id:'doc',review_state:'exceptions',name:'新病历',original:'新原文',proposals:[]};p.native.review=async()=>({id:'change',review_revision:7,proposals:[{id:'new',value:'新原文',comparisons:[{fact_id:'old',revision:3,relation:'conflict',old_snapshot:{value:'旧原文'}}]}]});let submitted;p.native.confirm=async(...args)=>{submitted=args;return {}};
 await p.run("openReview('doc',false,true)");p.run("medicalChecked.add('new');render()");assert.match(p.root.innerHTML,/旧原文/);await p.run('confirmReview(true)');assert.equal(submitted,undefined);
 p.events.change({target:{name:'comparison-resolution',dataset:{resolution:healthUI.resolutionKey('new','old',3)},value:'keep_existing'}});await p.run('confirmReview(true)');assert.equal(submitted[4][0].revision,3);assert.equal(submitted[4][0].action,'keep_existing');
});
test('mobile feedback saves once, opens linked chat and keeps editable next message',async()=>{
 const p=mobile();p.data.tasks=[{id:'task',text:'原医嘱',version:3,validity:'current',status:'pending'}];let releaseFeedback,releaseReply,calls=0;p.native.feedbackTask=()=>{calls++;return new Promise(resolve=>releaseFeedback=resolve)};p.native.wait=()=>new Promise(resolve=>releaseReply=resolve);
 await p.run("action('task',{dataset:{id:'task'}})");p.events.input({target:{name:'careFeedback',dataset:{task:'task'},value:'执行情况与新问题'}});
 const submitting=p.run("action('care-feedback',{dataset:{id:'task',version:'3'}})");await p.run("action('care-feedback',{dataset:{id:'task',version:'3'}})");assert.equal(calls,1);
 p.data.sessions=[{id:'linked',conversation_id:'linked',title:'反馈',messages:[{role:'user',text:'执行情况与新问题'}]}];releaseFeedback({conversation_id:'linked',run_id:'run'});await new Promise(resolve=>setImmediate(resolve));assert.equal(p.data.activeSessionId,'linked');p.events.input({target:{name:'message',value:'下一条还可以编辑'}});releaseReply({});await submitting;assert.match(p.root.innerHTML,/下一条还可以编辑/);
});
test('mobile failed feedback retains draft and re-enables submission in the open task sheet',async()=>{
 const p=mobile();p.data.tasks=[{id:'task',text:'医嘱',version:1,status:'pending',validity:'current'}];p.native.feedbackTask=async()=>{throw new Error('network unavailable')};await p.run("action('task',{dataset:{id:'task'}})");p.events.input({target:{name:'careFeedback',dataset:{task:'task'},value:'仍需保留的反馈'}});
 await assert.rejects(p.run("action('care-feedback',{dataset:{id:'task',version:'1'}})"));assert.match(p.overlay.innerHTML,/仍需保留的反馈/);assert.doesNotMatch(p.overlay.innerHTML,/data-action="care-feedback"[^>]*disabled/);
});
test('mobile feedback accepted after switching task sheets does not navigate away',async()=>{
 const p=mobile();p.data.tasks=[{id:'a',text:'医嘱 A',version:1,status:'pending',validity:'current'},{id:'b',text:'医嘱 B',version:1,status:'pending',validity:'current'}];let release;p.native.feedbackTask=()=>new Promise(resolve=>release=resolve);p.native.wait=async()=>({});await p.run("action('task',{dataset:{id:'a'}})");p.events.input({target:{name:'careFeedback',dataset:{task:'a'},value:'反馈 A'}});
 const submitting=p.run("action('care-feedback',{dataset:{id:'a',version:'1'}})");await p.run("action('task',{dataset:{id:'b'}})");release({conversation_id:'chat-a',run_id:'run'});await submitting;assert.equal(p.run('sheet.value'),'b');assert.match(p.overlay.innerHTML,/医嘱 B/);
});
test('mobile upload keeps the file input mounted while the native chooser is open',async()=>{
 const p=mobile();p.data.consent.parse=true;p.run("go('timeline','upload')");await p.run("action('choose-file',{dataset:{}})");const before=p.root.renderCount;await p.sync();assert.equal(p.root.renderCount,before);p.run('releaseFilePicker()');await p.sync();assert.ok(p.root.renderCount>before);
});
test('mobile processing document review explains waiting and failure offers a source-bound retry',async()=>{
 const p=mobile();p.data.medical={source_id:'doc',review_state:'exceptions',name:'病历',original:'原文',analysis:'running',proposals:[]};p.data.documents=[p.data.medical];p.run("go('timeline','medicalReview')");assert.match(p.root.innerHTML,/正在分析/);assert.doesNotMatch(p.root.innerHTML,/暂无可确认候选/);p.data.medical.analysis='failed';p.run('render()');assert.match(p.root.innerHTML,/重试分析/);
 let retried,release;p.native.retryEntry=async id=>{retried=id;return {run_id:'retry'}};p.native.wait=()=>new Promise(resolve=>release=resolve);const pending=p.run("action('retry-medical',{dataset:{id:'doc'}})");await new Promise(resolve=>setImmediate(resolve));p.run("go('home')");release({});await pending;assert.equal(retried,'doc');assert.equal(p.run('route.page'),'home');
});
test('mobile accepted file no longer claims unuploaded when analysis later fails',async()=>{
 const p=mobile();p.data.consent.parse=true;p.data.medical={source_id:'doc',review_state:'exceptions',name:'实际文件.txt',original:'已保存原文',analysis:'failed',proposals:[]};p.native.createDocument=async()=>({source_id:'doc',run_id:'run'});p.native.wait=async()=>{throw new Error('分析未完成')};p.run("file={name:'实际文件.txt'};go('timeline','upload')");await p.run("parseMedical('已保存原文')");assert.doesNotMatch(p.root.innerHTML,/未上传/);assert.match(p.root.innerHTML,/重试分析/);
});
test('mobile candidate review labels non-normalized time without claiming missing original time',()=>{
 const p=mobile();p.data.medical={source_id:'doc',review_state:'exceptions',name:'病历',original:'原文',analysis:'complete',proposals:[{id:'p',value:'胃部不适',health_observations:[{dimension:'onset',value:'今天早饭后'}]}]};p.run("go('timeline','medicalReview')");assert.match(p.root.innerHTML,/事件时间：今天早饭后/);assert.doesNotMatch(p.root.innerHTML,/时间：未记录/);
});
test('mobile home counts deferred medical candidates and opens the right review',async()=>{
 const p=mobile();p.data.documents=[{source_id:'doc',review_state:'exceptions',name:'待核对病历',original:'原文',proposals:[{id:'deferred',proposal_status:'deferred',value:'过敏信息'}]}];p.run('render()');assert.match(p.root.innerHTML,/1 项待核对/);assert.doesNotMatch(p.root.innerHTML,/当前没有待核对事项/);await p.run("action('review',{dataset:{}})");assert.equal(p.run('route.view'),'medicalReview');assert.equal(p.run('medicalReviewSourceId'),'doc');
});
test('mobile care task list shows ongoing explanation before any tasks arrive',()=>{
 const p=mobile();p.native.client.state.runs={care:{workflow:'care_plan',status:'queued'}};p.run("go('timeline','medical')");assert.match(p.root.innerHTML,/正在整理医嘱解释与诊后建议/);assert.doesNotMatch(p.root.innerHTML,/暂无诊后事项/);
});
test('mobile failed care generation retries its run once and preserves navigation',async()=>{
 const p=mobile();p.native.client.state.runs={care:{id:'care',document_id:'doc',workflow:'care_plan',status:'failed'}};p.run("go('timeline','medical')");assert.match(p.root.innerHTML,/医嘱解释未完成/);assert.doesNotMatch(p.root.innerHTML,/暂无诊后事项/);let calls=0,release;p.native.retryCarePlan=async id=>{assert.equal(id,'care');calls++;return new Promise(resolve=>release=resolve)};p.native.wait=async()=>({});const pending=p.run("action('retry-care-plan',{dataset:{id:'care'}})");await p.run("action('retry-care-plan',{dataset:{id:'care'}})");assert.equal(calls,1);p.run("go('home')");release({run_id:'next'});await pending;assert.equal(p.run('route.page'),'home');
});
test('mobile restored history retries the exact failed run without creating another turn',async()=>{
 const p=mobile();p.data.sessions=[{id:'history',title:'失败对话',updatedAt:'2026-10-13',messages:[{role:'user',text:'原问题'},{role:'assistant',text:'回复未完成',run_id:'failed',chat_retry_run_id:'failed'}]}];p.run("go('home','conversation','history')");assert.match(p.root.innerHTML,/data-action="retry-chat-run"/);let calls=0,release;p.native.retryChatRun=async id=>{assert.equal(id,'failed');calls++;return new Promise(resolve=>release=resolve)};const pending=p.run("action('retry-chat-run',{dataset:{id:'failed'}})");await p.run("action('retry-chat-run',{dataset:{id:'failed'}})");assert.equal(calls,1);release({});await pending;assert.equal(p.run('route.view'),'conversation');
});
test('mobile profile image conflict resolves transcript evidence to its original document',async()=>{const p=mobile();p.data.documents=[{source_id:'image',analysis_source_id:'ocr',name:'影像病历',original:'识别文字',review_state:'exceptions'}];p.run("go('timeline','healthProfile')");await p.run("action('profile-review',{dataset:{id:'ocr'}})");assert.equal(p.run('route.view'),'medicalReview');assert.equal(p.run('medicalReviewSourceId'),'image');assert.match(p.root.innerHTML,/识别文字/);});
test('mobile generic image and transcript sources retain document identity and uncertainty',async()=>{const p=mobile();p.data.documents=[{source_id:'image',analysis_source_id:'ocr',name:'影像病历',original:'完整识别文字',transcript:{status:'partial',uncertainties:['药名不清']},original_url:'/api/documents/doc/original'}];p.native.sources=new Map([['ocr',{id:'ocr',kind:'medical_document',input_kind:'image_transcript',text:'完整识别文字'}],['image',{id:'image',kind:'medical_document',text:''}]]);for(const id of ['ocr','image']){await p.run(`action('source',{dataset:{id:'${id}'}})`);assert.match(p.overlay.innerHTML,/病历识别文字/);assert.doesNotMatch(p.overlay.innerHTML,/用户原文/);assert.match(p.overlay.innerHTML,/药名不清/);assert.match(p.overlay.innerHTML,/\/api\/documents\/doc\/original/);assert.match(p.overlay.innerHTML,/data-action="medical-review" data-id="image"/);}});
test('mobile timeline labels known recording time when event date is unknown',()=>{const p=mobile();p.data.records=[{id:'r',summary:'患者记录',status:'patient_report',recorded_at:'2026-10-14T01:59:50+08:00',created:'2026/10/14 01:59:50',date:null}];p.run("go('timeline')");assert.match(p.root.innerHTML,/记录时间/);assert.match(p.root.innerHTML,/2026/);assert.doesNotMatch(p.root.innerHTML,/<strong>未记录<\/strong>/);});
test('mobile overview keeps expanded source sections through a background update',async()=>{const p=mobile();p.data.healthProfile={overview:{status:'current',regions:[{id:'abdomen',label:'腹部',summary:'原有描述',source_ids:[]}]}};p.run("go('timeline','healthProfile')");let nodes=[{dataset:{disclosure:'abdomen'},open:true}];p.root.querySelectorAll=()=>nodes;const original=Object.getOwnPropertyDescriptor(p.root,'innerHTML');Object.defineProperty(p.root,'innerHTML',{get:original.get,set(value){original.set.call(this,value);nodes=[{dataset:{disclosure:'abdomen'},open:false}];}});await p.sync();assert.equal(nodes[0].open,true);});
test('mobile failed edit shows exact accepted text and retries the run once without redirecting',async()=>{const p=mobile();p.data.records=[{id:'r',record_thread_id:'thread',record_version:3,summary:'已接受的修订',edit_pending:true,edit_recovery:{state:'failed',retryable:true,run_id:'failed-edit',source_id:'edited-source',text:'已接受的修订'},proposals:[]}];p.run("openSheet('record','r');let calls=0,release;native.retryRecovery=async id=>{calls++;globalThis.retried=id;return new Promise(resolve=>release=resolve)};native.wait=async()=>({status:'completed'})");assert.match(p.overlay.innerHTML,/重试整理记录/);assert.doesNotMatch(p.overlay.innerHTML,/正在更新记录/);const pending=p.run("action('retry-recovery',{dataset:{id:'failed-edit'}})");await p.run("action('retry-recovery',{dataset:{id:'failed-edit'}})");assert.equal(p.run('calls'),1);p.run("go('home');release({run_id:'next'})");await pending;assert.equal(p.run('retried'),'failed-edit');assert.equal(p.run('sheet'),null);});
test('mobile conflict completion separately waits on overview refresh without reconfirming',async()=>{const p=mobile();p.data.records=[{id:'r',review_state:'exceptions',proposals:[]}];p.run("let confirmations=0,waited=[];native.confirm=async()=>{confirmations++;return {overview_refresh_run_id:'overview-run',continuation_run_id:'care-run'}};native.wait=async id=>{waited.push(id);if(id==='overview-run')throw new Error('refresh failed');}");await p.run("openReview('r')");p.run("checked.add('p')");await p.run('confirmReview()');assert.equal(p.run('confirmations'),1);assert.deepEqual(Array.from(p.run('waited')).sort(),['care-run','overview-run']);assert.equal(p.run('route.page'),'timeline');});
test('accepted mobile edit failure leaves recovery detail instead of a resubmittable stale editor',async()=>{const p=mobile();p.data.records=[{id:'r',record_thread_id:'thread',record_version:2,summary:'原记录',proposals:[]}];p.run("let patches=0;native.editRecord=async()=>{patches++;return {run_id:'edit'}};native.wait=async()=>{throw new Error('failed')}");await p.run("action('correct',{dataset:{id:'r'}})");p.run("drafts.editText='完整修订'");await p.run("action('confirm-correction',{dataset:{}})");assert.equal(p.run('patches'),1);assert.equal(p.run('route.page'),'timeline');assert.equal(p.run('sheet.kind'),'record');assert.doesNotMatch(p.root.innerHTML,/name="editText"/);});
test('mobile recovery polling preserves the open record reading position and selected control',async()=>{const p=mobile();p.data.records=[{id:'r',summary:'记录',proposals:[]}];p.run("openSheet('record','r')");let scroll={scrollTop:125},focusCount=0;const active={dataset:{action:'source',id:'r'}};p.overlay.contains=node=>node===active;p.run('document.activeElement=null');p.overlay.querySelector=selector=>selector==='.sheet-content'?scroll:{showModal(){},addEventListener(){},close(){}};p.overlay.querySelectorAll=()=>[{dataset:{action:'source',id:'r'},focus(){focusCount++;}}];
  p.run("document.activeElement={dataset:{action:'source',id:'r'}}");p.overlay.contains=()=>true;await p.sync();assert.equal(scroll.scrollTop,125);assert.equal(focusCount,1);
});

test('mobile source sheet survives a fresh page reload and never substitutes another document',async()=>{const options={data:{documents:[{source_id:'image',analysis_source_id:'ocr/id',name:'目标病历',original:'完整目标识别文字',transcript:{uncertainties:['药名不清']},original_url:'/api/documents/owned/original'},{source_id:'other',name:'另一份资料',original:'不能串用'}]}};const p=mobile(options);await p.run("action('source',{dataset:{id:'ocr/id'}})");assert.match(p.location.hash,/ocr%2Fid/);assert.doesNotMatch(p.location.hash,/完整目标/);const reloaded=mobile({...options,hash:p.location.hash});assert.match(reloaded.overlay.innerHTML,/完整目标识别文字/);assert.match(reloaded.overlay.innerHTML,/药名不清/);assert.match(reloaded.overlay.innerHTML,/owned\/original/);reloaded.run('closeSheet()');assert.doesNotMatch(reloaded.location.hash,/source=/);const foreign=mobile({hash:p.location.hash});assert.match(foreign.overlay.innerHTML,/原始记录已不存在/);assert.doesNotMatch(foreign.overlay.innerHTML,/完整目标识别文字/);});
test('mobile source reload reads only the current account cache and clears removed content on sync',async()=>{const p=mobile({hash:'#timeline/healthProfile?source=source-one',sources:[['source-one',{id:'source-one',kind:'self_report',text:'该账号原文'}]]});assert.match(p.overlay.innerHTML,/该账号原文/);p.native.sources.clear();await p.sync();assert.doesNotMatch(p.overlay.innerHTML,/该账号原文/);assert.match(p.overlay.innerHTML,/原始记录已不存在/);assert.equal(p.run('route.view'),'healthProfile');});
test('reloaded mobile document processing page follows canonical completion and failure without navigating',async()=>{const document={source_id:'doc',analysis_status:'completed',care_status:'completed',analysis:'complete',proposals:[]};const p=mobile({hash:'#timeline/parsing',data:{medical:document,documents:[document]}});assert.match(p.root.innerHTML,/<h2>病历已整理<\/h2>/);assert.doesNotMatch(p.root.innerHTML,/正在处理病历|取消处理/);assert.match(p.root.innerHTML,/data-action="medical-review" data-id="doc"/);assert.match(p.root.innerHTML,/查看身体近况/);document.care_status='failed';document.care_run_id='care';await p.sync();assert.match(p.root.innerHTML,/诊后建议未完成/);assert.match(p.root.innerHTML,/data-action="retry-care-plan" data-id="care"/);assert.doesNotMatch(p.root.innerHTML,/正在处理病历|取消处理/);assert.equal(p.run('route.view'),'parsing');document.care_status='running';await p.sync();assert.match(p.root.innerHTML,/<h2>正在处理病历<\/h2>/);assert.doesNotMatch(p.root.innerHTML,/取消处理/);});
test('mobile document route title distinguishes saved analysis from actual exception review',async()=>{const document={source_id:'doc',analysis:'complete',proposals:[],review_state:'automatic'};const p=mobile({hash:'#timeline/medicalReview',data:{medical:document,documents:[document]}});assert.match(p.root.innerHTML,/<h1>病历原文与分析<\/h1>/);assert.doesNotMatch(p.root.innerHTML,/<h1>病历差异核对<\/h1>/);document.review_state='exceptions';document.proposals=[{id:'uncertain',value:'需要核实'}];await p.sync();assert.match(p.root.innerHTML,/<h1>病历差异核对<\/h1>/);});
test('mobile upload clears its cancel controller after failure and does not lend it to a retry',async()=>{const p=mobile();p.data.consent.parse=true;const doc={source_id:'doc',analysis_run_id:'upload-run',analysis_status:'running',proposals:[]};p.data.medical=doc;p.data.documents=[doc];p.native.createDocument=async()=>({source_id:'doc',run_id:'upload-run'});p.native.wait=async()=>{throw new Error('failed')};await p.run("parseMedical('原文')");assert.equal(p.run('jobController'),null);p.native.retryEntry=async()=>({run_id:'retry-run'});let release;p.native.waitDocument=()=>new Promise(resolve=>release=resolve);p.run("go('timeline','parsing')");const retry=p.run("action('retry-medical',{dataset:{id:'doc'}})");await new Promise(resolve=>setImmediate(resolve));assert.doesNotMatch(p.root.innerHTML,/取消处理/);p.run("go('home')");release({status:'completed'});await retry;});
test('mobile cancellation belongs only to the current live document wait',async()=>{const p=mobile();p.data.consent.parse=true;const doc={source_id:'doc',analysis_run_id:'upload-run',analysis_status:'running',proposals:[]};p.data.medical=doc;p.data.documents=[doc];p.native.createDocument=async()=>({source_id:'doc',run_id:'upload-run'});let signal,release;p.native.waitDocument=(_id,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve)};const pending=p.run("parseMedical('原文')");await new Promise(resolve=>setImmediate(resolve));assert.match(p.root.innerHTML,/取消处理/);p.data.medical={...doc,source_id:'other'};await p.sync();assert.doesNotMatch(p.root.innerHTML,/取消处理/);await p.run("action('cancel-job',{dataset:{}})");assert.equal(signal.aborted,false);p.data.medical=doc;await p.sync();await p.run("action('cancel-job',{dataset:{}})");assert.equal(signal.aborted,true);release();await pending;assert.equal(p.run('jobController'),null);});
