import * as healthUI from '../../packages/client/health-profile.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../../apps/web/src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function page(options={}) {
  let html='',nodes={};const listeners={},appListeners={};
  const root={addEventListener:(type,fn)=>appListeners[type]=fn,querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],contains:()=>false,
    get innerHTML(){return html;},set innerHTML(value){this.renderCount=(this.renderCount||0)+1;html=value;nodes={'#chat-thread':{scrollTop:0,scrollHeight:1200,clientHeight:400},'.history-transcript':{scrollTop:0},'.detail-drawer':{scrollTop:0}};}};
  const data={sessions:[],records:[],tasks:[],documents:[],consent:{},symptomStart:'',selectedHistory:[]};
  const native={client:{state:{user:{},runs:{}},getDraft:()=>'',pendingOperations:()=>[]},review:async id=>({id:'change-'+id,source_ids:[id],review_revision:0,proposals:[{id:'p-'+id,value:'合成记录'}]})};
  const window={scrollX:0,scrollY:0,scrollTo(x,y){this.scrollY=y;},addEventListener:(type,fn)=>listeners[type]=fn};
  Object.assign(data,options.data||{});native.sources=new Map(options.sources||[]);
  const testLocation={hash:options.hash||'#home'},testHistory={replaceState(_state,_unused,hash){testLocation.hash=hash;},pushState(_state,_unused,hash){testLocation.hash=hash;}};
  const context=vm.createContext({...healthUI,nativeBridge:()=>native,loadData:()=>data,saveData(){},NAV:[{id:'home',label:'首页'},{id:'timeline',label:'时间线'}],window,document:{getElementById:id=>id==='app'?root:nodes['#'+id],activeElement:null},location:testLocation,history:testHistory,setTimeout:()=>0,clearTimeout(){},matchMedia:()=>({matches:true}),assertionLabel:()=>'',scopeLabel:()=>''});
  native.waitDocument=(...args)=>native.wait(...args);
  vm.runInContext(source,context);
  return {location:testLocation,root,nodes:()=>nodes,context,window,data,input:target=>appListeners.input({target}),change:target=>appListeners.change({target}),sync:()=>listeners['healththread:state'](),run:code=>vm.runInContext(code,context)};
}
test('background sync preserves scroll positions in chat, history and record drawer',()=>{
  const p=page();p.nodes()['#chat-thread'].scrollTop=350;p.nodes()['.history-transcript'].scrollTop=180;p.nodes()['.detail-drawer'].scrollTop=90;p.window.scrollY=220;
  p.sync();assert.equal(p.nodes()['#chat-thread'].scrollTop,350);assert.equal(p.nodes()['.history-transcript'].scrollTop,180);assert.equal(p.nodes()['.detail-drawer'].scrollTop,90);assert.equal(p.window.scrollY,220);
});
test('review from the open record does not switch to another pending record',async()=>{
  const p=page();p.data.records=[{id:'other',change_id:'a',proposals:[]},{id:'selected',change_id:'b',proposals:[]}];
  p.run("selectedRecord='selected';subview='record';");await p.run("doAction('review',{dataset:{}})");
  assert.equal(p.run('selectedRecord'),'selected');
});
test('review selection can be confirmed and feedback shows the selected count',async()=>{
  const p=page();p.data.records=[{id:'selected',proposals:[]}];await p.run("openReview('selected')");
  assert.match(p.root.innerHTML,/请勾选/);p.run("selectedForReview.add('p-selected');render()");
  assert.match(p.root.innerHTML,/已选择 1 项/);assert.match(p.root.innerHTML,/<button[^>]*data-act="confirm-review"(?![^>]*disabled)[^>]*>/);
});
test('candidates arriving after review was opened become confirmable without reopening the page',async()=>{
  const p=page();p.data.records=[{id:'selected',proposals:[],analysis:'saved'}];
  p.run("selectedRecord='selected';subview='review';reviewSnapshot=null;native.client.factChange=async id=>({id,source_ids:['selected'],review_revision:0,proposals:[{id:'arrived',value:'新候选'}]});render();");
  p.data.records[0].change_id='ready';p.data.records[0].proposals=[{id:'arrived',value:'新候选'}];
  await p.sync();await new Promise(resolve=>setImmediate(resolve));p.run("selectedForReview.add('arrived');render()");
  assert.ok(p.run("capturedReview('selected')"));assert.match(p.root.innerHTML,/<button[^>]*data-act="confirm-review"(?![^>]*disabled)[^>]*>/);
});
test('review of a later correction remains confirmable from the original record',async()=>{
  const p=page();p.data.records=[{id:'original',change_id:'correction-2',proposals:[]}];
  p.run("native.review=async()=>({id:'correction-2',source_ids:['new-correction','first-correction'],review_revision:2,proposals:[{id:'revised',value:'最新更正'}]})");
  await p.run("openReview('original')");p.run("selectedForReview.add('revised');render()");
  assert.ok(p.run("capturedReview('original')"));assert.match(p.root.innerHTML,/<button[^>]*data-act="confirm-review"(?![^>]*disabled)[^>]*>/);
});
test('an older review response cannot replace candidates for the newly selected record',async()=>{
  const p=page();p.data.records=[{id:'a',text:'A',proposals:[]},{id:'b',text:'B',proposals:[]}];
  p.run("const reviews={};native.review=id=>new Promise(resolve=>reviews[id]=resolve)");
  const first=p.run("openReview('a')"),second=p.run("openReview('b')");
  p.run("reviews.b({id:'cb',proposals:[{id:'pb',value:'B candidate'}]})");await second;
  p.run("reviews.a({id:'ca',proposals:[{id:'pa',value:'A candidate'}]})");await first;
  assert.match(p.root.innerHTML,/B candidate/);assert.doesNotMatch(p.root.innerHTML,/A candidate/);
});
test('review finishing after navigation does not reopen the review page',async()=>{
  const p=page();p.data.records=[{id:'a',text:'A',proposals:[]}];
  p.run("let finishReview;native.review=()=>new Promise(resolve=>finishReview=resolve)");
  const pending=p.run("openReview('a')");p.run("open('home')");
  p.run("finishReview({id:'ca',proposals:[]})");await pending;
  assert.equal(p.run('subview'),'');assert.equal(p.run('page'),'home');
});
test('medical review binds the requested document instead of the previously selected document',async()=>{
  const p=page();p.data.documents=[{source_id:'a',name:'Doc A',original:'original A'},{source_id:'b',name:'Doc B',original:'original B'}];p.data.medical=p.data.documents[0];
  await p.run("openReview('b',true)");
  assert.match(p.root.innerHTML,/original B/);assert.doesNotMatch(p.root.innerHTML,/original A/);
});
test('a missing source never falls back to an unrelated latest record',async()=>{
  const p=page();p.data.records=[{id:'latest',text:'Unrelated private record',proposals:[]}];
  await p.run("doAction('source',{dataset:{id:'deleted-source'}})");
  assert.doesNotMatch(p.root.innerHTML,/Unrelated private record/);
});
test('communication card does not invent a source record or patient identity',()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,factVersion:1,cardDraft:'synthetic speech',cardConcern:'synthetic concern',cardRecords:[{id:'actual-source',text:'backing text',status:'confirmed'}],questions:[]});
  p.run("native.client.state.user.username='测试账号';open('card')");
  assert.doesNotMatch(p.root.innerHTML,/data-id="r1"/);
  p.run("openSubview('editCard')");assert.doesNotMatch(p.root.innerHTML,/data-id="r1"/);
  p.run("openSubview('print')");assert.doesNotMatch(p.root.innerHTML,/林悦/);assert.match(p.root.innerHTML,/测试账号/);
});
test('timeline records with no issue do not acquire an invented stomach symptom',()=>{
  const p=page();p.data.records=[{id:'head',text:'合成头痛记录',date:'2026-10-13',status:'pending',proposals:[]}];p.run("open('timeline')");
  assert.doesNotMatch(p.root.innerHTML,/胃部不适/);
});
test('conflict comparison is bound to the clicked record and its own candidates',async()=>{
  const p=page();p.data.records=[{id:'a',text:'A',facts:[{value:'A confirmed'}],proposals:[]},{id:'b',text:'B',facts:[{value:'B confirmed'}],proposals:[{value:'B correction'}]}];p.run("selectedRecord='a'");
  await p.run("doAction('conflict',{dataset:{id:'b'}})");
  assert.match(p.root.innerHTML,/B confirmed/);assert.match(p.root.innerHTML,/B correction/);assert.doesNotMatch(p.root.innerHTML,/A confirmed/);
});
test('confirmation completion preserves a different review opened while it was pending',async()=>{
  const p=page();p.data.records=[{id:'a',text:'A',proposals:[]},{id:'b',text:'B',proposals:[]}];await p.run("openReview('a')");
  p.run("selectedForReview.add('p-a');let finishConfirm;native.confirm=()=>new Promise(resolve=>finishConfirm=resolve)");
  const pending=p.run('confirmReview()');await p.run("openReview('b')");p.run("selectedForReview.add('p-b');finishConfirm({})");await pending;
  assert.equal(p.run('subview'),'review');assert.equal(p.run('selectedRecord'),'b');assert.ok(p.run("capturedReview('b')"));assert.ok(p.run("selectedForReview.has('p-b')"));
});
test('retry analysis keeps its original source and does not reopen after navigation',async()=>{
  const p=page();p.data.records=[{id:'a',text:'A',proposals:[]}];p.run("selectedRecord='a';subview='review';let finishRetry;native.retryEntry=async()=>({run_id:'retry-run'});native.wait=()=>new Promise(resolve=>finishRetry=resolve)");
  const pending=p.run("doAction('retry-analysis',{dataset:{}})");await new Promise(resolve=>setImmediate(resolve));p.run("open('home');finishRetry({})");await pending;
  assert.equal(p.run('subview'),'');
});

test('unsaved communication card edits survive background synchronization',async()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,factVersion:1,cardResultId:'card-a',cardDraft:'original speech',cardRecords:[],questions:['original question']});
  await p.run("doAction('edit-card',{dataset:{}})");
  p.input({id:'card-draft',value:'edited speech',dataset:{}});p.input({id:'card-questions',value:'edited question',dataset:{}});await p.sync();
  assert.match(p.root.innerHTML,/<textarea id="card-draft"[^>]*>edited speech<\/textarea>/);assert.match(p.root.innerHTML,/<textarea id="card-questions"[^>]*>edited question<\/textarea>/);
});
test('saving an old card editor cannot apply its text to a newer card',async()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,factVersion:1,cardResultId:'old',cardDraft:'old speech',cardRecords:[],questions:[]});await p.run("doAction('edit-card',{dataset:{}})");
  p.data.cardResultId='new';p.data.cardDraft='new speech';await p.sync();await p.run("doAction('save-card',{dataset:{}})");assert.equal(p.data.cardEdit,undefined);
});
test('unrelated profile changes do not mark a valid card stale',()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,factVersion:8,cardSourceDeleted:false,cardDraft:'speech',cardRecords:[],questions:[]});p.run("open('card')");assert.doesNotMatch(p.root.innerHTML,/stale-banner/);
  p.data.cardSourceDeleted=true;p.run('render()');assert.match(p.root.innerHTML,/stale-banner/);
});
test('visit generation is bound to the chosen conversation rather than a form draft',async()=>{
  const p=page();Object.assign(p.data,{currentConcern:'obsolete form',activeSessionId:'other',sessions:[{id:'chosen',messages:[{role:'user',text:'first'},{role:'assistant',text:'reply'},{role:'user',text:'followup'}]}]});let sent;
  p.run("native.generateVisit=async id=>{globalThis.generatedSession=id}");await p.run("doAction('generate-card',{dataset:{id:'chosen'}})");
  assert.equal(p.run('generatedSession'),'chosen');assert.equal(p.run('page'),'card');
});
test('card details preserve negated concerns and do not borrow unsaved visit impact',()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,cardDraft:'speech',cardConcern:'没有胃痛，主要是头痛',impact:'new visit only impact',cardRecords:[],questions:[]});p.run("open('card')");
  assert.match(p.root.innerHTML,/speech/);assert.doesNotMatch(p.root.innerHTML,/new visit only impact/);
});
for(const action of ['file-upload','sample-file'])test(`${action} completion cannot replace a newer review`,async()=>{
  const p=page();p.data.consent.parse=true;p.data.documents=[{source_id:'doc',original:'document'}];p.data.records=[{id:'new',text:'New record',proposals:[]}];
  p.run("openSubview('upload');let finishUpload;native.createDocument=async()=>({source_id:'doc',run_id:'upload'});native.wait=()=>new Promise(resolve=>finishUpload=resolve)");
  const pending=action==='file-upload'?p.run("onFileChange({target:{files:[{name:'test.txt',text:async()=> 'synthetic document'}]}})"):p.run("doAction('sample-file',{dataset:{}})");
  await new Promise(resolve=>setImmediate(resolve));await p.run("openReview('new')");p.run("selectedForReview.add('p-new');finishUpload({})");await pending;
  assert.equal(p.run('subview'),'review');assert.equal(p.run('selectedRecord'),'new');assert.ok(p.run("selectedForReview.has('p-new')"));
});
test('correction completion cannot replace the record reviewed after leaving the editor',async()=>{
  const p=page();p.data.records=[{id:'old',text:'Old',proposals:[]},{id:'new',text:'New',proposals:[]}];await p.run("doAction('correct',{dataset:{id:'old'}})");
  p.run("let finishCorrection;native.editRecord=async()=>({source_id:'old',run_id:'edit'});native.wait=()=>new Promise(resolve=>finishCorrection=resolve)");
  const pending=p.run("doAction('submit-correction',{dataset:{}})");await new Promise(resolve=>setImmediate(resolve));await p.run("openReview('new')");p.run("selectedForReview.add('p-new');finishCorrection({})");await pending;
  assert.equal(p.run('selectedRecord'),'new');assert.ok(p.run("selectedForReview.has('p-new')"));assert.ok(p.run("capturedReview('new')"));
});
test('card generation finishing after navigation does not leave the current page',async()=>{
  const p=page();p.run("data.sessions=[{id:'session',messages:[{role:'user',text:'hello'},{role:'assistant',text:'reply'}]}];data.activeSessionId='session';open('home');let finishCard;native.generateVisit=()=>new Promise(resolve=>finishCard=resolve)");const pending=p.run("doAction('generate-card',{dataset:{}})");p.run("open('timeline');finishCard({})");await pending;assert.equal(p.run('page'),'timeline');
});
test('successful export records its date after initiating the download',async()=>{
  const p=page();let downloads=0;p.context.Blob=Blob;p.context.URL={createObjectURL:()=> 'blob:synthetic',revokeObjectURL(){}};p.context.document.createElement=()=>({click(){downloads++;}});p.run("native.client.exportData=async()=>({sources:[]})");
  await p.run("doAction('download-export',{dataset:{}})");assert.equal(downloads,1);assert.match(p.data.exportAt,/^\d{4}-\d{2}-\d{2}$/);p.run("openSubview('export')");assert.match(p.root.innerHTML,new RegExp(p.data.exportAt));
});
test('record acceptance does not switch a conversation selected while saving',async()=>{
  const p=page();p.data.consent.organize=true;p.context.isRecordConfirmation=()=>false;p.run("native.client.setDraft=()=>{};native.client.clearDraftIf=()=>{};let finishRecord;native.recordTurn=()=>new Promise(resolve=>finishRecord=resolve);native.wait=async()=>({})");
  const pending=p.run("saveRecord('synthetic record')");await p.run("doAction('continue-session',{dataset:{id:'other-chat'}})");p.run("finishRecord({source_id:'saved',record_thread_id:'saved-thread',run_id:'run'})");await pending;assert.equal(p.data.activeSessionId,'other-chat');
});
test('care task completion does not close a different task drawer',async()=>{
  const p=page();p.data.tasks=[{id:'a',text:'A',version:1,status:'pending',validity:'current'},{id:'b',text:'B',version:1,status:'pending',validity:'current'}];await p.run("doAction('task',{dataset:{id:'a'}})");p.run("let finishTask;native.updateTask=()=>new Promise(resolve=>finishTask=resolve)");
  const pending=p.run("doAction('task-done',{dataset:{version:'1'}})");p.run("open('home')");await p.run("doAction('task',{dataset:{id:'b'}})");p.run("finishTask({})");await pending;assert.equal(p.run('subview'),'task');assert.equal(p.run('selectedTask'),'b');
});
test('data deletion completion does not redirect after leaving confirmation',async()=>{
  const p=page();p.run("openSubview('deleteConfirm');deleteAcknowledged=true;let finishDelete;native.deleteAll=()=>new Promise(resolve=>finishDelete=resolve)");const pending=p.run("doAction('delete-local',{dataset:{}})");p.run("open('home');finishDelete({})");await pending;assert.equal(p.run('page'),'home');assert.equal(p.run('subview'),'');
});
test('correction provenance remains readable when its source is omitted from timeline records',async()=>{
  const p=page();p.run("native.sources=new Map([['correction-source',{id:'correction-source',text:'Immutable correction original',recorded_at:'2026-10-13T02:00:00Z',input_kind:'self_report'}]])");
  await p.run("doAction('source',{dataset:{id:'correction-source'}})");
  assert.match(p.root.innerHTML,/Immutable correction original/);assert.doesNotMatch(p.root.innerHTML,/原始记录已不可查看/);assert.doesNotMatch(p.root.innerHTML,/data-act="correct"|data-act="record"/);
});

test('home keeps preparation replies conversational without a generation action',()=>{
  const p=page();p.data.sessions=[{id:'chat-one',title:'Chat',updatedAt:'2026-10-13',messages:[{role:'user',text:'question'},{role:'assistant',text:'reply',action:'visit'},{role:'user',text:'followup'},{role:'assistant',text:'another reply',action:'visit'}]}];p.data.activeSessionId='chat-one';p.run('render()');
  assert.doesNotMatch(p.root.innerHTML,/data-act="generate-card"/);assert.doesNotMatch(p.root.innerHTML,/data-act="go-visit"/);
});
test('empty card returns to home asking mode without a visit form',async()=>{
  const p=page();p.run("inputMode='record';open('card')");assert.match(p.root.innerHTML,/回到首页准备就诊/);await p.run("doAction('start-visit',{dataset:{}})");assert.equal(p.run('page'),'home');assert.equal(p.run('subview'),'');assert.equal(p.run('inputMode'),'ask');
});
test('regeneration uses the canonical saved card context and blocks duplicate clicks',async()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,cardDraft:'saved',cardRecords:[],questions:[]});p.run("open('card');let finishGeneration;let generations=0;native.regenerateVisit=()=>{generations++;return new Promise(resolve=>finishGeneration=resolve)}");
  const first=p.run("doAction('regenerate-card',{dataset:{}})");await p.run("doAction('regenerate-card',{dataset:{}})");assert.equal(p.run('generations'),1);assert.match(p.root.innerHTML,/正在生成/);assert.match(p.root.innerHTML,/<button[^>]*data-act="regenerate-card"[^>]*disabled/);p.run('finishGeneration({})');await first;
});
test('card save persists speech questions and captured revision through the shared API',async()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,cardResultId:'card',cardDraft:'speech',cardRecords:[],questions:['question'],cardEditRevision:3});p.run("native.saveCardEdit=async(...args)=>{globalThis.savedCard=args}");await p.run("doAction('edit-card',{dataset:{}})");p.input({id:'card-draft',value:'new speech',dataset:{}});p.input({id:'card-questions',value:'new question',dataset:{}});await p.run("doAction('save-card',{dataset:{}})");
  assert.equal(JSON.stringify(p.run('savedCard')),JSON.stringify(['card','new speech',['new question'],3,[]]));
});
test('failed durable save keeps the edited card text visible for reconciliation',async()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,cardResultId:'card',cardDraft:'speech',cardRecords:[],questions:[],cardEditRevision:2});p.run("native.saveCardEdit=async()=>{throw Object.assign(new Error('conflict'),{code:'REVISION_CONFLICT'})}");await p.run("doAction('edit-card',{dataset:{}})");p.input({id:'card-draft',value:'keep my edit',dataset:{}});await p.run("doAction('save-card',{dataset:{}})");assert.equal(p.run('subview'),'editCard');assert.match(p.root.innerHTML,/keep my edit/);assert.match(p.root.innerHTML,/版本|其他|变化/);
});
test('empty-card preparation leaves a record thread before switching to ask mode',async()=>{
  const p=page();p.data.sessions=[{id:'record-thread',record_thread_id:'record-thread',messages:[]}];p.data.activeSessionId='record-thread';await p.run("doAction('start-visit',{dataset:{}})");assert.equal(p.data.activeSessionId,null);assert.equal(p.run('inputMode'),'ask');
});
test('card source drawer shows immutable generation context rather than generated speech',async()=>{
  const p=page();Object.assign(p.data,{cardSourceId:'context',cardConversationId:'chat',cardConcern:'generated interpretation',sessions:[{id:'chat',title:'Conversation',messages:[{role:'user',text:'original turn'}]}]});p.run("native.sources=new Map([['context',{id:'context',text:'full original conversation'}]])");await p.run("doAction('chat-source',{dataset:{}})");assert.match(p.root.innerHTML,/full original conversation/);assert.doesNotMatch(p.root.innerHTML,/generated interpretation/);
});
test('card save blocks duplicate submissions while retaining captured revision',async()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,cardResultId:'card',cardDraft:'speech',cardRecords:[],questions:[],cardEditRevision:4});await p.run("doAction('edit-card',{dataset:{}})");p.run("let finishSave;let saveCalls=0;native.saveCardEdit=()=>{saveCalls++;return new Promise(resolve=>finishSave=resolve)}");const first=p.run("doAction('save-card',{dataset:{}})");await p.run("doAction('save-card',{dataset:{}})");assert.equal(p.run('saveCalls'),1);assert.match(p.root.innerHTML,/正在保存/);p.run('finishSave({})');await first;
});
test('generation failure remains visible in the originating conversation history',async()=>{
  const p=page();p.data.sessions=[{id:'chat',title:'Chat',updatedAt:'2026-10-13',messages:[{role:'user',text:'question'},{role:'assistant',text:'reply'}]}];p.run("selectedSessionId='chat';openSubview('conversations');native.generateVisit=async()=>{throw new Error('SCHEMA_VALIDATION_FAILED')}");await p.run("doAction('generate-card',{dataset:{id:'chat'}})");assert.equal(p.run('subview'),'conversations');assert.match(p.root.innerHTML,/role="alert"/);assert.doesNotMatch(p.root.innerHTML,/SCHEMA_VALIDATION_FAILED/);
});
for(const [code,expected] of [['NO_VISIT_CONVERSATION',/请先在首页/],['CONVERSATION_NOT_READY',/等待.*回复/],['NO_CARD',/还没有沟通卡/],['CONSENT_REQUIRED',/设置.*授权/]])test(`card generation explains ${code} with actionable guidance`,async()=>{
  const p=page();p.data.activeSessionId='chat';p.run(`native.generateVisit=async()=>{throw Object.assign(new Error('failure'),{code:'${code}'})}`);await p.run("doAction('generate-card',{dataset:{id:'chat'}})");assert.match(p.run('cardError'),expected);assert.doesNotMatch(p.run('cardError'),new RegExp(code));
});

test('chat and history offer no generation button and show a small card link only for completed output',()=>{
  const p=page();p.run("executionLabel=()=>''");p.data.sessions=[{id:'chat',title:'聊天',updatedAt:'2026-10-13',messages:[{role:'user',text:'你好'},{role:'assistant',text:'你好',action:'visit'}]}];p.data.activeSessionId='chat';p.run('render()');
  assert.doesNotMatch(p.root.innerHTML,/data-act="generate-card"/);
  p.run("selectedSessionId='chat';openSubview('conversations')");assert.doesNotMatch(p.root.innerHTML,/data-act="generate-card"/);
  p.data.sessions[0].messages.push({role:'assistant',text:'沟通卡已生成。',action:'card',visit_result_id:'card-1'});p.run("open('home')");
  assert.match(p.root.innerHTML,/查看沟通卡/);assert.match(p.root.innerHTML,/data-act="view-chat-card"[^>]*data-id="card-1"/);
});
test('restored regeneration stays busy and cannot submit a duplicate on desktop',async()=>{
  const p=page();Object.assign(p.data,{cardVersion:1,cardDraft:'已保存卡片',cardRecords:[],questions:[],cardRegenerationPending:true});p.run("open('card');let submissions=0;native.regenerateVisit=async()=>{submissions++}");
  assert.match(p.root.innerHTML,/<button[^>]*data-act="regenerate-card"[^>]*disabled/);assert.match(p.root.innerHTML,/正在生成医生沟通卡/);
  await p.run("doAction('regenerate-card',{dataset:{}})");assert.equal(p.run('submissions'),0);
});

test('desktop main composer and record-new-change route always use natural chat',async()=>{
 const p=page();assert.doesNotMatch(p.root.innerHTML,/data-act="mode-record"/);
 await p.run("doAction('record-new-change',{dataset:{}})");
 p.run("chatDraft='有点不舒服';sendChat=()=> 'chat';saveRecord=()=> 'record'");assert.equal(p.run('submitHomeInput()'),'chat');
});

test('desktop authorized child retries are quiet independent actions and cannot double submit',async()=>{
 const p=page();p.data.sessions=[{id:'chat',messages:[{role:'assistant',text:'整理未完成',visit_retry_run_id:'visit',record_retry_run_id:'record'}]}];p.data.activeSessionId='chat';p.run('render()');assert.match(p.root.innerHTML,/重试整理记录/);assert.match(p.root.innerHTML,/重试生成沟通卡/);
 p.run("let finishAction;let childCalls=0;native.retryAssistantAction=()=>{childCalls++;return new Promise(resolve=>finishAction=resolve)}");const pending=p.run("doAction('retry-chat-action',{dataset:{id:'record'}})");await p.run("doAction('retry-chat-action',{dataset:{id:'record'}})");assert.equal(p.run('childCalls'),1);p.run('finishAction()');await pending;assert.equal(p.run('page'),'home');
});

test('desktop card lists unique provenance links without repeating assembled or individual transcripts',()=>{
 const p=page();Object.assign(p.data,{cardVersion:1,cardDraft:'自然就诊摘要',questions:[],cardSourceId:'assembled',cardRecords:[{id:'assembled',text:'完整拼接对话和生成指令',source:'用户自述'},{id:'turn',text:'单轮原话和工作流命令',source:'用户自述'},{id:'turn',text:'重复依赖'}]});p.run("open('card')");assert.match(p.root.innerHTML,/自然就诊摘要/);assert.doesNotMatch(p.root.innerHTML,/完整拼接对话|单轮原话|重复依赖/);assert.match(p.root.innerHTML,/2 份来源/);assert.equal((p.root.innerHTML.match(/data-act="source" data-id="turn"/g)||[]).length,1);
});
test('desktop network errors use a readable notification',()=>{const p=page();p.run("flash('Failed to fetch')");assert.doesNotMatch(p.root.innerHTML,/Failed to fetch/);assert.match(p.root.innerHTML,/连接|网络/);});

test('desktop record details lead with the saved summary and keep full raw text behind source',async()=>{
 const p=page();p.data.records=[{id:'saved',text:'完整原话和保存指令',summary:'这三天主要是饭后腹胀。',status:'pending',analysis:'complete'}];await p.run("doAction('record',{dataset:{id:'saved'}})");assert.match(p.root.innerHTML,/这三天主要是饭后腹胀/);assert.doesNotMatch(p.root.innerHTML,/完整原话和保存指令/);assert.match(p.root.innerHTML,/查看来源/);
 await p.run("doAction('source',{dataset:{id:'saved'}})");assert.match(p.root.innerHTML,/完整原话和保存指令/);
});

test('desktop late card completion clears its error only after receipt verification',async()=>{
 const p=page();p.run("cardError='沟通卡暂时未生成成功';cardErrorRunId='late';native.client.state.runs.late={id:'late',status:'completed',result_id:'card'};native.client.state.results=[{id:'card'}]");await p.sync();assert.match(p.run('cardError'),/未生成成功/);
 p.run("native.client.state.runs.late.runtime={mode:'real'}");await p.sync();assert.equal(p.run('cardError'),'');
});

test('desktop card editor allows correcting and clearing remaining items',async()=>{
 const p=page();Object.assign(p.data,{cardVersion:1,cardResultId:'card',cardDraft:'正文',questions:[],cardUnknowns:['矛盾的待补充项']});p.run("native.saveCardEdit=async(...args)=>{globalThis.savedCard=args}");await p.run("doAction('edit-card',{dataset:{}})");assert.match(p.root.innerHTML,/还需补充（每行一项）/);p.input({id:'card-unknowns',value:'',dataset:{}});await p.run("doAction('save-card',{dataset:{}})");assert.equal(JSON.stringify(p.run('savedCard[4]')),'[]');
});
test('desktop medical review blocks unresolved conflicts and forwards deliberate defer',async()=>{
 const p=page();p.data.documents=[{source_id:'doc',review_state:'exceptions',name:'本次病历',original:'新原文'}];p.data.medical=p.data.documents[0];
 p.run("native.review=async()=>({id:'change',review_revision:7,proposals:[{id:'new',value:'新原文',comparisons:[{fact_id:'old',revision:3,relation:'conflict',old_snapshot:{value:'旧原文'}}]}]});let submitted;native.confirm=async(...args)=>{submitted=args;return {}};");
 await p.run("openReview('doc',true)");p.run("selectedForReview.add('new');render()");assert.match(p.root.innerHTML,/旧原文/);await p.run('confirmReview(true)');assert.equal(p.run('submitted'),undefined);
 const key=healthUI.resolutionKey('new','old',3);p.change({dataset:{resolution:key},value:'defer'});await p.run('confirmReview(true)');assert.equal(p.run('submitted[4][0].action'),'defer');
});
test('desktop profile opens four views and keeps unsaved correction through refresh',async()=>{
 const p=page();p.data.healthProfile={current_problems:[],events:[],background:[],unknowns:[{dimension:'impact'}]};p.run("native.client.state.profile={facts:[{fact_id:'f',revision:2,value:'旧描述'}]}");
 await p.run("doAction('health-profile',{dataset:{}})");assert.match(p.root.innerHTML,/身体近况/);assert.match(p.root.innerHTML,/记录经过/);await p.run("doAction('profile-view',{dataset:{view:'unknowns'}})");assert.match(p.root.innerHTML,/生活影响/);
 await p.run("doAction('profile-correct',{dataset:{id:'f',version:'2'}})");p.input({id:'profile-correction-text',value:'编辑中的正确原话',dataset:{}});await p.sync();assert.match(p.root.innerHTML,/编辑中的正确原话/);
});
test('desktop feedback saves once, opens linked chat, and preserves newly typed followup',async()=>{
 const p=page();p.data.tasks=[{id:'task',text:'原医嘱',version:3,validity:'current',status:'pending'}];
 p.run("let releaseFeedback,releaseReply,calls=0;native.feedbackTask=()=>{calls++;return new Promise(resolve=>releaseFeedback=resolve)};native.wait=()=>new Promise(resolve=>releaseReply=resolve)");
 await p.run("doAction('task',{dataset:{id:'task'}})");p.input({id:'care-feedback-text',dataset:{task:'task'},value:'未完成，想补充情况'});p.sync();assert.match(p.root.innerHTML,/未完成，想补充情况/);
 const submitting=p.run("doAction('care-feedback',{dataset:{id:'task',version:'3'}})");await p.run("doAction('care-feedback',{dataset:{id:'task',version:'3'}})");assert.equal(p.run('calls'),1);
 p.data.sessions=[{id:'linked',conversation_id:'linked',title:'反馈',messages:[{role:'user',text:'未完成，想补充情况'}]}];p.run("releaseFeedback({conversation_id:'linked',run_id:'run'})");await new Promise(resolve=>setImmediate(resolve));assert.equal(p.data.activeSessionId,'linked');p.input({id:'chat-input',value:'接下来还想问',dataset:{}});p.run('releaseReply({})');await submitting;assert.match(p.root.innerHTML,/接下来还想问/);
});
test('desktop upload keeps the file input mounted while the native chooser is open',async()=>{
 const p=page();p.run("openSubview('upload')");await p.run("doAction('choose-file',{dataset:{}})");const before=p.root.renderCount;await p.sync();assert.equal(p.root.renderCount,before);p.run('releaseFilePicker()');await p.sync();assert.ok(p.root.renderCount>before);
});
test('desktop actual uploaded document shows processing in upload and review without simulated copy',()=>{
 const p=page();p.data.medical={source_id:'doc',review_state:'exceptions',name:'真实病历.txt',original:'原文',analysis:'running',proposals:[]};p.data.documents=[p.data.medical];p.data.uploadedName='真实病历.txt';p.data.uploadState='processing';p.run("openSubview('upload')");assert.match(p.root.innerHTML,/正在分析/);assert.doesNotMatch(p.root.innerHTML,/解析完成|查看模拟差异|模拟资料|模拟门诊记录.pdf/);p.run("openSubview('medicalReview')");assert.match(p.root.innerHTML,/正在分析/);assert.doesNotMatch(p.root.innerHTML,/暂无可确认候选/);
});
test('desktop failed document retry keeps the requested source and does not redirect after navigation',async()=>{
 const p=page();p.data.medical={source_id:'doc',review_state:'exceptions',name:'病历',original:'原文',analysis:'failed',proposals:[]};p.data.documents=[p.data.medical];p.run("openSubview('medicalReview');let retried,release;native.retryEntry=async id=>{retried=id;return {run_id:'retry'}};native.wait=()=>new Promise(resolve=>release=resolve)");assert.match(p.root.innerHTML,/重试分析/);const pending=p.run("doAction('retry-medical',{dataset:{id:'doc'}})");await new Promise(resolve=>setImmediate(resolve));p.run("open('home');release({})");await pending;assert.equal(p.run('retried'),'doc');assert.equal(p.run('subview'),'');
});
test('desktop candidate review shows literal onset as event time',()=>{
 const p=page();p.data.medical={source_id:'doc',review_state:'exceptions',name:'病历',original:'原文',analysis:'complete',proposals:[{id:'p',value:'胃部不适',health_observations:[{dimension:'onset',value:'今天早饭后'}]}]};p.run("openSubview('medicalReview')");assert.match(p.root.innerHTML,/<span>事件时间<\/span><strong>今天早饭后/);assert.doesNotMatch(p.root.innerHTML,/原文时间/);
});
test('desktop home counts deferred medical candidates and routes the review entry to that document',async()=>{
 const p=page();p.data.documents=[{source_id:'doc',review_state:'exceptions',name:'待继续核对的病历',original:'原文',proposals:[{id:'deferred',proposal_status:'deferred',value:'过敏信息'}]}];p.run('render()');assert.match(p.root.innerHTML,/1 项/);assert.doesNotMatch(p.root.innerHTML,/当前没有待核对事项/);await p.run("doAction('review',{dataset:{}})");assert.equal(p.run('subview'),'medicalReview');assert.equal(p.run('reviewSourceId'),'doc');assert.match(p.root.innerHTML,/待继续核对的病历/);
});
test('desktop care task list shows the active explanation run instead of an empty result',()=>{
 const p=page();p.run("native.client.state.runs={care:{workflow:'care_plan',status:'running'}};open('records')");assert.match(p.root.innerHTML,/正在整理医嘱解释与诊后建议/);assert.doesNotMatch(p.root.innerHTML,/暂无诊后事项/);
});
test('desktop failed care generation exposes retry bound to its run and blocks duplicate clicks',async()=>{
 const p=page();p.run("native.client.state.runs={care:{id:'care',document_id:'doc',workflow:'care_plan',status:'failed'}};open('records');let calls=0,release;native.retryCarePlan=async id=>{calls++;if(id!=='care')throw new Error('wrong run');return new Promise(resolve=>release=resolve)};native.wait=async()=>({})");assert.match(p.root.innerHTML,/医嘱解释未完成/);assert.doesNotMatch(p.root.innerHTML,/暂无诊后事项/);const pending=p.run("doAction('retry-care-plan',{dataset:{id:'care'}})");await p.run("doAction('retry-care-plan',{dataset:{id:'care'}})");assert.equal(p.run('calls'),1);p.run("open('home');release({run_id:'next'})");await pending;assert.equal(p.run('page'),'home');
});
test('desktop restored history retries the exact failed run without changing the active chat',async()=>{
 const p=page();p.data.sessions=[{id:'history',title:'失败对话',updatedAt:'2026-10-13',messages:[{role:'user',text:'原问题'},{role:'assistant',text:'回复未完成',run_id:'failed',chat_retry_run_id:'failed'}]}];p.run("selectedSessionId='history';openSubview('conversations');let calls=0,release;native.retryChatRun=async id=>{if(id!=='failed')throw new Error('wrong run');calls++;return new Promise(resolve=>release=resolve)}");assert.match(p.root.innerHTML,/data-act="retry-chat-run"/);const pending=p.run("doAction('retry-chat-run',{dataset:{id:'failed'}})");await p.run("doAction('retry-chat-run',{dataset:{id:'failed'}})");assert.equal(p.run('calls'),1);p.run('release({})');await pending;assert.equal(p.run('subview'),'conversations');
});
test('desktop profile image conflict resolves transcript evidence to its original document',async()=>{const p=page();p.data.documents=[{source_id:'image',analysis_source_id:'ocr',name:'影像病历',original:'识别文字',review_state:'exceptions'}];p.run("openSubview('healthProfile')");await p.run("doAction('profile-review',{dataset:{id:'ocr'}})");assert.equal(p.run('subview'),'medicalReview');assert.equal(p.run('reviewSourceId'),'image');assert.match(p.root.innerHTML,/识别文字/);});
test('desktop generic image and transcript sources retain document context and uncertainty',async()=>{const p=page();p.data.documents=[{source_id:'image',analysis_source_id:'ocr',name:'影像病历',original:'完整识别文字',transcript:{status:'partial',uncertainties:['药名不清']},original_url:'/api/documents/doc/original'}];p.run("native.sources=new Map([['ocr',{id:'ocr',kind:'medical_document',input_kind:'image_transcript',text:'完整识别文字'}],['image',{id:'image',kind:'medical_document',text:''}]])");for(const id of ['ocr','image']){await p.run(`doAction('source',{dataset:{id:'${id}'}})`);assert.match(p.root.innerHTML,/病历识别文字/);assert.match(p.root.innerHTML,/药名不清/);assert.match(p.root.innerHTML,/\/api\/documents\/doc\/original/);assert.match(p.root.innerHTML,/data-act="medical-review" data-id="image"/);}});
test('desktop overview keeps expanded source sections through a background update',async()=>{const p=page();p.data.healthProfile={overview:{status:'current',regions:[{id:'abdomen',label:'腹部',summary:'原有描述',source_ids:[]}]}};p.run("openSubview('healthProfile')");let nodes=[{dataset:{disclosure:'abdomen'},open:true}];p.root.querySelectorAll=()=>nodes;const original=Object.getOwnPropertyDescriptor(p.root,'innerHTML');Object.defineProperty(p.root,'innerHTML',{get:original.get,set(value){original.set.call(this,value);nodes=[{dataset:{disclosure:'abdomen'},open:false}];}});await p.sync();assert.equal(nodes[0].open,true);});
test('completed whole-record editor closes back to its parent without reopening the stale form',async()=>{const p=page();p.data.records=[{id:'r',record_thread_id:'thread',record_version:2,status:'patient_report',summary:'原记录',proposals:[]}];p.run("selectedRecord='r';openSubview('record');native.editRecord=async()=>({run_id:'edit',record_thread_id:'thread'});native.wait=async()=>({status:'completed'})");await p.run("doAction('correct',{dataset:{id:'r'}})");p.input({id:'edit-text',value:'修订记录',dataset:{}});await p.run("doAction('submit-correction',{dataset:{}})");assert.equal(p.run('subview'),'record');p.run('closeSubview()');assert.equal(p.run('subview'),'');assert.doesNotMatch(p.root.innerHTML,/id="edit-text"/);});
test('desktop failed record has exact accepted text and one guarded run retry',async()=>{const p=page();p.data.records=[{id:'r',record_thread_id:'thread',record_version:3,summary:'已接受的修订',edit_pending:true,edit_recovery:{state:'failed',retryable:true,run_id:'failed-edit',source_id:'edited-source',text:'已接受的修订'},proposals:[]}];p.run("selectedRecord='r';openSubview('record');let calls=0,release;native.retryRecovery=async id=>{calls++;globalThis.retried=id;return new Promise(resolve=>release=resolve)};native.wait=async()=>({status:'completed'})");assert.match(p.root.innerHTML,/重试整理记录/);assert.doesNotMatch(p.root.innerHTML,/正在更新记录/);const pending=p.run("doAction('retry-recovery',{dataset:{id:'failed-edit'}})");await p.run("doAction('retry-recovery',{dataset:{id:'failed-edit'}})");assert.equal(p.run('calls'),1);p.run("open('home');release({run_id:'next'})");await pending;assert.equal(p.run('retried'),'failed-edit');assert.equal(p.run('subview'),'');});
test('desktop conflict result separately waits on overview refresh without reconfirming',async()=>{const p=page();p.data.records=[{id:'r',review_state:'exceptions',proposals:[]}];p.run("let confirmations=0,waited=[];native.confirm=async()=>{confirmations++;return {overview_refresh_run_id:'overview-run',continuation_run_id:'care-run'}};native.wait=async id=>{waited.push(id);if(id==='overview-run')throw new Error('refresh failed');}");await p.run("openReview('r')");p.run("selectedForReview.add('p-r')");await p.run('confirmReview()');assert.equal(p.run('confirmations'),1);assert.deepEqual(Array.from(p.run('waited')).sort(),['care-run','overview-run']);assert.match(p.root.innerHTML,/差异处理已保存/);});
test('accepted desktop edit failure leaves recovery detail instead of a resubmittable stale editor',async()=>{const p=page();p.data.records=[{id:'r',record_thread_id:'thread',record_version:2,summary:'原记录',proposals:[]}];p.run("selectedRecord='r';openSubview('record');let patches=0;native.editRecord=async()=>{patches++;return {run_id:'edit'}};native.wait=async()=>{throw new Error('failed')}");await p.run("doAction('correct',{dataset:{id:'r'}})");p.input({id:'edit-text',value:'完整修订',dataset:{}});await p.run("doAction('submit-correction',{dataset:{}})");assert.equal(p.run('patches'),1);assert.equal(p.run('subview'),'record');assert.doesNotMatch(p.root.innerHTML,/id="edit-text"/);assert.match(p.root.innerHTML,/修改原文已保存，整理未完成/);});

test('desktop source identity survives a fresh page reload and keeps OCR ownership',async()=>{const options={data:{documents:[{source_id:'image',analysis_source_id:'ocr/id',name:'目标病历',original:'完整目标识别文字',transcript:{uncertainties:['药名不清']},original_url:'/api/documents/owned/original'},{source_id:'other',name:'另一份资料',original:'不能串用'}]}};const p=page(options);await p.run("doAction('source',{dataset:{id:'ocr/id'}})");assert.match(p.location.hash,/ocr%2Fid/);assert.doesNotMatch(p.location.hash,/完整目标/);const reloaded=page({...options,hash:p.location.hash});assert.match(reloaded.root.innerHTML,/完整目标识别文字/);assert.match(reloaded.root.innerHTML,/药名不清/);assert.match(reloaded.root.innerHTML,/owned\/original/);const foreign=page({hash:p.location.hash});assert.match(foreign.root.innerHTML,/原始记录已不可查看/);assert.doesNotMatch(foreign.root.innerHTML,/完整目标识别文字/);});
test('desktop source reload reads only the current account cache and clears removed content on sync',async()=>{const p=page({hash:'#home/source/source-one',sources:[['source-one',{id:'source-one',kind:'self_report',text:'该账号原文'}]]});assert.match(p.root.innerHTML,/该账号原文/);p.run('native.sources.clear()');await p.sync();assert.doesNotMatch(p.root.innerHTML,/该账号原文/);assert.match(p.root.innerHTML,/原始记录已不可查看/);const invalid=page({hash:'#home/source/%zz'});assert.match(invalid.root.innerHTML,/原始记录已不可查看/);});
