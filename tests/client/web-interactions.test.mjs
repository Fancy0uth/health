import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../../apps/web/src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function page() {
  let html='',nodes={};const listeners={},appListeners={};
  const root={addEventListener:(type,fn)=>appListeners[type]=fn,querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],contains:()=>false,
    get innerHTML(){return html;},set innerHTML(value){html=value;nodes={'#chat-thread':{scrollTop:0,scrollHeight:1200,clientHeight:400},'.history-transcript':{scrollTop:0},'.detail-drawer':{scrollTop:0}};}};
  const data={sessions:[],records:[],tasks:[],documents:[],consent:{},symptomStart:'',selectedHistory:[]};
  const native={client:{state:{user:{},runs:{}},getDraft:()=>'',pendingOperations:()=>[]},review:async id=>({id:'change-'+id,source_ids:[id],review_revision:0,proposals:[{id:'p-'+id,value:'合成记录'}]})};
  const window={scrollX:0,scrollY:0,scrollTo(x,y){this.scrollY=y;},addEventListener:(type,fn)=>listeners[type]=fn};
  const context=vm.createContext({nativeBridge:()=>native,loadData:()=>data,saveData(){},NAV:[{id:'home',label:'首页'},{id:'timeline',label:'时间线'}],window,document:{getElementById:id=>id==='app'?root:nodes['#'+id],activeElement:null},location:{hash:'#home'},history:{pushState(){}},setTimeout:()=>0,clearTimeout(){},matchMedia:()=>({matches:true}),assertionLabel:()=>'',scopeLabel:()=>''});
  vm.runInContext(source,context);
  return {root,nodes:()=>nodes,context,window,data,input:target=>appListeners.input({target}),sync:()=>listeners['healththread:state'](),run:code=>vm.runInContext(code,context)};
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

test('home offers one conversation generation action regardless of how many replies prepare a visit',()=>{
  const p=page();p.data.sessions=[{id:'chat-one',title:'Chat',updatedAt:'2026-10-13',messages:[{role:'user',text:'question'},{role:'assistant',text:'reply',action:'visit'},{role:'user',text:'followup'},{role:'assistant',text:'another reply',action:'visit'}]}];p.data.activeSessionId='chat-one';p.run('render()');
  assert.match(p.root.innerHTML,/<button[^>]*data-act="generate-card"[^>]*data-id="chat-one"/);assert.equal((p.root.innerHTML.match(/>生成医生沟通卡<\/button>/g)||[]).length,1);assert.doesNotMatch(p.root.innerHTML,/data-act="go-visit"/);
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
  assert.equal(JSON.stringify(p.run('savedCard')),JSON.stringify(['card','new speech',['new question'],3]));
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
