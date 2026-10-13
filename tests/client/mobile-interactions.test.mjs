import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {isRecordConfirmation} from '../../packages/client/record-dialogue.js';
const source=(await readFile(new URL('../../apps/mobile/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function mobile() {
  let html='',body;const listeners={},events={};
  const root={contains:()=>false,querySelector:()=>null,get innerHTML(){return html;},set innerHTML(v){html=v;body={scrollTop:0,scrollHeight:1600,clientHeight:400,scrollTo({top}){this.scrollTop=top;}};}};
  const overlay={innerHTML:'',querySelector:()=>({showModal(){},addEventListener(){},close(){}})};const toast={textContent:'',classList:{add(){},remove(){}}};
  const data={sessions:[],records:[],tasks:[],documents:[],consent:{organize:true},factHistory:[],selectedHistory:[],factVersion:1};
  const store={data,preferences:{reduceMotion:true},reload(){},persist:()=>true,record:id=>data.records.find(r=>r.id===id),session:id=>data.sessions.find(s=>s.id===id),sessions:()=>data.sessions,pending:()=>0,cardExists:()=>false,stale:()=>false,ensureSession:()=>data.sessions[0]};
  const native={copyText:()=> '合成沟通卡',client:{getDraft:()=>'',pendingOperations:()=>[],setDraft(){},clearDraftIf(){},state:{user:{username:'test'},runs:{}}},review:async id=>({id:'change-'+id,source_ids:[id],review_revision:1,proposals:[{id:'p',value:'合成记录'}]})};
  const context=vm.createContext({AbortController,isRecordConfirmation,nativeBridge:()=>native,store,window:{addEventListener:(name,fn)=>listeners[name]=fn},document:{activeElement:null,getElementById:id=>({app:root,overlays:overlay,toast})[id],querySelector:s=>s==='.screen-body'?body:null,documentElement:{classList:{toggle(){}}},addEventListener:(name,fn)=>events[name]=fn},navigator:{onLine:true},location:{hash:'#home'},history:{replaceState(){},pushState(){}},setTimeout:()=>0,clearTimeout(){},requestAnimationFrame:fn=>fn(),matchMedia:()=>({matches:true,addEventListener(){}}),assertionLabel:()=>'',scopeLabel:()=>'',executionLabel:()=>'',CSS:{escape:v=>v},console,appendAssistantReply(sessions,id,message){sessions.find(s=>s.id===id).messages.push({role:'assistant',...message});}});
  vm.runInContext(source,context);
  return {root,data,native,events,body:()=>body,sync:()=>listeners['healththread:state'](),run:code=>vm.runInContext(code,context)};
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
