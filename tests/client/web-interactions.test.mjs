import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source=(await readFile(new URL('../../apps/web/src/app.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function page() {
  let html='',nodes={};const listeners={};
  const root={addEventListener(){},querySelector:s=>nodes[s]||null,querySelectorAll:()=>[],contains:()=>false,
    get innerHTML(){return html;},set innerHTML(value){html=value;nodes={'#chat-thread':{scrollTop:0,scrollHeight:1200,clientHeight:400},'.history-transcript':{scrollTop:0},'.detail-drawer':{scrollTop:0}};}};
  const data={sessions:[],records:[],tasks:[],documents:[],consent:{},symptomStart:'',selectedHistory:[]};
  const native={client:{state:{user:{},runs:{}},getDraft:()=>'',pendingOperations:()=>[]},review:async id=>({id:'change-'+id,source_ids:[id],review_revision:0,proposals:[{id:'p-'+id,value:'合成记录'}]})};
  const window={scrollX:0,scrollY:0,scrollTo(x,y){this.scrollY=y;},addEventListener:(type,fn)=>listeners[type]=fn};
  const context=vm.createContext({nativeBridge:()=>native,loadData:()=>data,saveData(){},NAV:[{id:'home',label:'首页'},{id:'timeline',label:'时间线'}],window,document:{getElementById:id=>id==='app'?root:nodes['#'+id],activeElement:null},location:{hash:'#home'},history:{pushState(){}},setTimeout:()=>0,clearTimeout(){},matchMedia:()=>({matches:true}),assertionLabel:()=>'',scopeLabel:()=>''});
  vm.runInContext(source,context);
  return {root,nodes:()=>nodes,context,window,data,sync:()=>listeners['healththread:state'](),run:code=>vm.runInContext(code,context)};
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
