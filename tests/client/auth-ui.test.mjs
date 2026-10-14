import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source=(await readFile(new URL('../../packages/client/auth-ui.js',import.meta.url),'utf8')).replace('export async function','async function');
// A small DOM boundary keeps these event tests portable; server/client integration is real HTTP.
function page(client,pathname='/web/'){
  const app={inert:false},styles=[],screens=[];let activeElement=null;
  function node(attributes={}){const listeners={};return{...attributes,value:'',textContent:'',hidden:Object.hasOwn(attributes,'hidden'),disabled:false,dataset:{},setAttribute(key,value){this[key]=value;},removeAttribute(key){delete this[key];},focus(){activeElement=this;},addEventListener(type,fn){listeners[type]=fn;},async fire(type){return listeners[type]?.({preventDefault(){}});}};}
  const form=node();form.elements={};const selectors=new Map();let html='';
  const screen=node();screen.remove=()=>screens.splice(screens.indexOf(screen),1);screen.querySelector=selector=>selector==='form'?form:selectors.get(selector)||null;form.querySelector=selector=>selectors.get(selector)||null;
  Object.defineProperty(screen,'innerHTML',{get:()=>html,set(value){html=value;for(const match of value.matchAll(/<(input|button|p|span|h2|label)\b([^>]*)>/g)){
    const attributes={};for(const attr of match[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g))attributes[attr[1]]=attr[2]??'';
    const element=node(attributes);if(attributes.maxlength)element.maxLength=Number(attributes.maxlength);if(attributes.name)form.elements[attributes.name]=element;
    for(const className of (attributes.class||'').split(' ').filter(Boolean))selectors.set('.'+className,element);
    if(attributes.role)selectors.set('[role='+attributes.role+']',element);
    if(attributes.type)selectors.set('[type='+attributes.type+']',element);
    for(const key of Object.keys(attributes).filter(key=>key.startsWith('data-')))selectors.set('['+key+']',element);
    if(match[1]==='button'&&!selectors.has('button'))selectors.set('button',element);
  }}});
  const document={get activeElement(){return activeElement;},querySelector:()=>styles[0]||null,createElement:tag=>tag==='section'?screen:node(),head:{append:element=>styles.push(element)},body:{append:element=>screens.push(element)},getElementById:()=>app};
  const context=vm.createContext({document,location:{pathname}});vm.runInContext(source,context);const completed=context.openLogin(client);
  return{app,screen,form,styles,screens,completed,get activeElement(){return activeElement;},node:selector=>selectors.get(selector),switch:()=>selectors.get('[data-auth-switch]'),submit:()=>form.fire('submit')};
}
const clientFixture=()=>({state:{user:null},calls:[],async login(username,password){this.calls.push({kind:'login',username,password});this.state.user={id:'existing'};},async register(username,password){this.calls.push({kind:'register',username,password});this.state.user={id:'created'};}});

test('web and mobile show a working registration switch, then return to existing-account login',async()=>{
  for(const pathname of ['/web/','/mobile/']){
    const client=clientFixture(),p=page(client,pathname);assert.ok(p.switch(),'registration must be reachable from the login screen');assert.equal(p.app.inert,true);
    p.form.elements.username.value='existing';p.form.elements.password.value='old secret';await p.switch().fire('click');
    assert.equal(p.node('.ht-auth-confirm').hidden,false);assert.equal(p.form.elements.password.autocomplete,'new-password');assert.equal(p.form.elements.password.value,'');
    await p.switch().fire('click');assert.equal(p.node('.ht-auth-confirm').hidden,true);assert.equal(p.form.elements.password.autocomplete,'current-password');
    p.form.elements.password.value='existing-password';await p.submit();await p.completed;assert.equal(client.calls[0].kind,'login');assert.equal(client.calls[0].username,'existing');assert.equal(p.app.inert,false);assert.equal(p.screens.length,0);
  }
});

test('registration validates username, password and confirmation without sending invalid credentials',async()=>{
  const client=clientFixture(),p=page(client);assert.ok(p.switch());await p.switch().fire('click');
  for(const [username,password,confirm,focus]of [['ab','long-password','long-password','username'],['new patient','long-password','long-password','username'],['patient','short','short','password'],['patient',' '.repeat(10),' '.repeat(10),'password'],['patient','long-password','other-password','confirm_password']]){
    p.form.elements.username.value=username;p.form.elements.password.value=password;p.form.elements.confirm_password.value=confirm;await p.submit();
    assert.equal(client.calls.length,0);assert.ok(p.node('.ht-auth-status').textContent);assert.equal(p.activeElement,p.form.elements[focus]);
  }
  p.form.elements.username.value='  patient  ';p.form.elements.password.value='long-password';p.form.elements.confirm_password.value='long-password';await p.submit();await p.completed;
  assert.equal(client.calls.length,1);assert.equal(client.calls[0].kind,'register');assert.equal(client.calls[0].username,'patient');assert.equal(p.form.elements.password.value,'');assert.equal(p.form.elements.confirm_password.value,'');assert.equal(p.app.inert,false);
});

test('pending signup cannot be submitted twice or switched, and duplicate failures offer login with secrets cleared',async()=>{
  const client=clientFixture();let reject,attempts=0;client.register=()=>{attempts++;return new Promise((_,fail)=>reject=fail);};const p=page(client);assert.ok(p.switch());await p.switch().fire('click');
  p.form.elements.username.value='patient';p.form.elements.password.value='long-password';p.form.elements.confirm_password.value='long-password';const pending=p.submit();
  assert.equal(p.node('[type=submit]').disabled,true);assert.equal(p.switch().disabled,true);await p.submit();await p.switch().fire('click');assert.equal(attempts,1);assert.equal(p.node('.ht-auth-confirm').hidden,false);
  reject(Object.assign(new Error('此账号已存在，请登录。'),{code:'ACCOUNT_EXISTS'}));await pending;assert.match(p.node('.ht-auth-status').textContent,/登录/);assert.equal(p.screens.length,1);assert.equal(p.node('[type=submit]').disabled,false);
  await p.switch().fire('click');assert.equal(p.form.elements.username.value,'patient');assert.equal(p.form.elements.password.value,'');assert.equal(p.form.elements.confirm_password.value,'');
});

test('signup UI counts non-BMP password characters rather than their UTF-16 units',async()=>{
  const client=clientFixture(),p=page(client);await p.switch().fire('click');p.form.elements.username.value='unicode_patient';
  for(const password of ['😀'.repeat(5),'x'.repeat(8)+'😀','😀'.repeat(129)]){
    p.form.elements.password.value=password;p.form.elements.confirm_password.value=password;await p.submit();assert.equal(client.calls.length,0);assert.equal(p.activeElement,p.form.elements.password);
  }
  const password='😀'.repeat(65);p.form.elements.password.value=password;p.form.elements.confirm_password.value=password;await p.submit();await p.completed;
  assert.equal(client.calls.length,1);assert.equal(client.calls[0].password,password);
});

test('both signup password controls permit typing 128 emoji without truncation',async()=>{
  for(const pathname of ['/web/','/mobile/']){
    const client=clientFixture(),p=page(client,pathname);await p.switch().fire('click');p.form.elements.username.value='unicode_patient';
    const password='😀'.repeat(128);
    // HTML maxlength counts UTF-16 units; simulate its input boundary for both controls.
    for(const name of ['password','confirm_password']){const field=p.form.elements[name];field.value=password.slice(0,field.maxLength);}
    await p.submit();assert.equal(client.calls.length,1);assert.equal(client.calls[0].password,password);await p.completed;
  }
});
