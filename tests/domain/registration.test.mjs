import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {createApp} from '../../services/api/domain-server.mjs';
import {request,login} from '../fixtures/http-handler.mjs';

const credentials={username:'new_patient',password:'synthetic-password'};
function storeFixture(t){const dir=mkdtempSync(join(tmpdir(),'ht-signup-store-')),dbPath=join(dir,'test.sqlite');let store=new DomainStore({dbPath});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return{get store(){return store;},restart(){store.close();store=new DomainStore({dbPath});}};}
async function appFixture(t,options={}){const app=createApp({dbPath:':memory:',...options});await app.jobs.close();t.after(()=>app.close());return app;}
const authHeaders=response=>({cookie:response.headers['set-cookie'].split(';')[0],'x-csrf-token':response.body.csrf_token,'x-healththread-epoch':String(response.body.scope_epoch)});

test('registration persists a distinct consent-off account and protected session across restart',t=>{
  const f=storeFixture(t),first=f.store.register(credentials),uid=first.user.id;
  assert.equal(first.user.username,'new_patient');assert.equal(first.profile_revision,1);assert.equal(first.scope_epoch,1);assert.equal(first.all_clear_epoch,0);
  assert.equal(f.store.session(first.token).user.id,uid);assert.equal(f.store.consent(uid).granted,false);
  assert.equal(f.store.timeline(uid).entries.length,0);assert.equal(f.store.profile(uid).facts.length,0);assert.equal(f.store.careTasks(uid).tasks.length,0);
  assert.throws(()=>f.store.accept(uid,'entry',{text:'未授权的合成记录。'},'signup-not-authorized-01'),{code:'CONSENT_REQUIRED'});
  const row=f.store.db.prepare('SELECT * FROM users WHERE id=?').get(uid);assert.notEqual(row.password,credentials.password);assert.equal(row.password.length,128);
  assert.ok(!JSON.stringify(f.store.exportData(uid)).includes(credentials.password));
  f.restart();assert.equal(f.store.login(credentials.username,credentials.password).user.id,uid);assert.equal(f.store.session(first.token).user.id,uid);
  const second=f.store.register({username:'another_patient',password:'different-password'});assert.notEqual(second.user.id,uid);assert.equal(f.store.consent(second.user.id).granted,false);
});

test('duplicate registration cannot change the existing password, consent, session or health data',t=>{
  const f=storeFixture(t),first=f.store.register(credentials),uid=first.user.id;f.store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
  const saved=f.store.accept(uid,'entry',{text:'合成账号的独立记录。'},'signup-original-entry-001');
  assert.throws(()=>f.store.register({username:'  new_patient  ',password:'replacement-password'}),{status:409,code:'ACCOUNT_EXISTS'});
  assert.equal(f.store.login(credentials.username,credentials.password).user.id,uid);assert.throws(()=>f.store.login(credentials.username,'replacement-password'),{code:'AUTH_FAILED'});
  assert.equal(f.store.consent(uid).granted,true);assert.equal(f.store.session(first.token).user.id,uid);assert.equal(f.store.get(uid,'source',saved.source_id).text,'合成账号的独立记录。');
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM users').get().count,1);
});

test('registration validates credential bounds and rejects extra fields before creating any account',t=>{
  const f=storeFixture(t);
  for(const body of [null,[],{}, {...credentials,username:'ab'}, {...credentials,username:'x'.repeat(33)}, {...credentials,username:'bad name'}, {...credentials,username:12}, {...credentials,password:'short'}, {...credentials,password:'x'.repeat(129)}, {...credentials,password:' '.repeat(10)}, {...credentials,password:1234567890}, {...credentials,consent:true}, {...credentials,owner:'admin'}, {...credentials,password_confirmation:credentials.password}]){
    assert.throws(()=>f.store.register(body),{status:400});assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM users').get().count,0);
  }
  const lower=f.store.register({username:'a.b',password:'x'.repeat(10)});assert.equal(lower.user.username,'a.b');
  const upper=f.store.register({username:'x'.repeat(32),password:'y'.repeat(128)});assert.equal(f.store.login(upper.user.username,'y'.repeat(128)).user.id,upper.user.id);
});

test('failed session creation rolls back the new account and consent atomically',t=>{
  const f=storeFixture(t);f.store.db.exec("CREATE TRIGGER fail_signup_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT,'injected'); END");
  assert.throws(()=>f.store.register(credentials),/injected/);assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM users').get().count,0);assert.equal(f.store.all('consent').length,0);
});

test('registration rejects fewer than ten Unicode password code points even when UTF-16 length is ten',t=>{
  const f=storeFixture(t);
  for(const password of ['😀'.repeat(5),'x'.repeat(8)+'😀'])assert.throws(()=>f.store.register({...credentials,password}),{status:400,code:'INVALID_PASSWORD'});
  assert.equal(f.store.db.prepare('SELECT count(*) AS count FROM users').get().count,0);
  const password='😀'.repeat(10),registered=f.store.register({...credentials,password});assert.equal(f.store.login(credentials.username,password).user.id,registered.user.id);
});

test('registration accepts 128 non-BMP password code points and rejects the 129th without normalizing the password',t=>{
  const f=storeFixture(t),password='😀'.repeat(128),registered=f.store.register({...credentials,password});
  assert.equal(f.store.login(credentials.username,password).user.id,registered.user.id);
  assert.throws(()=>f.store.register({username:'too_long',password:'😀'.repeat(129)}),{status:400,code:'INVALID_PASSWORD'});
  const exact='e\u0301'.repeat(5),raw=f.store.register({username:'raw_password',password:exact});assert.equal(f.store.login('raw_password',exact).user.id,raw.user.id);
  assert.throws(()=>f.store.login('raw_password','é'.repeat(5)),{code:'AUTH_FAILED'});
});

test('HTTP signup returns the same protected identity flow and never grants model ownership or health access',async t=>{
  const modelConfiguration={getStatus:async()=>({configured:false,model:null,revision:0,runtime_status:'unavailable'}),close:async()=>{}};
  const app=await appFixture(t,{demoAccounts:[{username:'config_owner',password:'owner-password'}],modelConfiguration,modelConfigOwnerUsername:'config_owner'});
  const owner=await login(app,'config_owner','owner-password');app.store.setConsent(owner.uid,{purpose:'analysis',granted:true,expected_version:1});const privateSource=app.store.accept(owner.uid,'entry',{text:'另一个合成账号的资料。'},'owner-private-signup-test');
  const response=await request(app,'/api/auth/register',{method:'POST',body:credentials});assert.equal(response.status,201);
  assert.match(response.headers['set-cookie'],/HttpOnly/);assert.match(response.headers['set-cookie'],/SameSite=Strict/);assert.equal(response.headers['x-healththread-epoch'],'1');
  assert.equal(response.body.token,undefined);assert.ok(!JSON.stringify(response.body).includes(credentials.password));
  const headers=authHeaders(response);assert.equal((await request(app,'/api/me',{headers})).body.user.id,response.body.user.id);
  assert.equal((await request(app,'/api/consents',{headers})).body.consents[0].granted,false);assert.equal((await request(app,'/api/model-config',{headers})).body.can_manage,false);
  assert.equal((await request(app,'/api/model-config/test',{method:'POST',headers,body:{api_key:'synthetic-key'}})).status,403);
  for(const [path,id]of [['sources',privateSource.source_id],['runs',privateSource.run_id],['operations',privateSource.operation_id]])assert.equal((await request(app,'/api/'+path+'/'+id,{headers})).status,404);
  assert.equal((await request(app,'/api/export',{headers})).body.sources.length,0);
  assert.equal((await request(app,'/api/entries',{method:'POST',headers,body:{text:'未授权。'}})).body.error.code,'CONSENT_REQUIRED');
  assert.equal((await request(app,'/api/auth/logout',{method:'POST',headers:{...headers,'x-csrf-token':'wrong'},body:{}})).status,403);
  assert.equal((await request(app,'/api/auth/logout',{method:'POST',headers,body:{}})).status,200);
  assert.equal((await request(app,'/api/me',{headers})).body.user,null);
  const again=await login(app,credentials.username,credentials.password);assert.equal(again.uid,response.body.user.id);
});

test('signup requires same origin, strict fields and bounded JSON before persistence',async t=>{
  const app=await appFixture(t);
  for(const origin of ['https://attacker.example','null',undefined]){
    const r=await request(app,'/api/auth/register',{method:'POST',body:credentials,headers:{origin}});assert.equal(r.status,403);assert.equal(r.body.error.code,'ORIGIN_DENIED');
  }
  const extra=await request(app,'/api/auth/register',{method:'POST',body:{...credentials,granted:true}});assert.equal(extra.status,400);
  assert.equal((await request(app,'/api/auth/register',{method:'POST',body:'{'})).body.error.code,'INVALID_JSON');
  assert.equal((await request(app,'/api/auth/register',{method:'POST',body:{...credentials,password:'x'.repeat(5000)}})).status,413);
  assert.equal(app.store.db.prepare('SELECT count(*) AS count FROM users').get().count,0);
});

test('signup cannot claim a configured model owner that has not been provisioned',async t=>{
  const app=await appFixture(t,{modelConfigOwnerUsername:'config_owner'});
  const r=await request(app,'/api/auth/register',{method:'POST',body:{...credentials,username:'config_owner'}});assert.equal(r.status,409);assert.equal(r.body.error.code,'ACCOUNT_EXISTS');
  assert.equal(app.store.db.prepare('SELECT count(*) AS count FROM users').get().count,0);
});

test('signup is rate limited together with login and does not create accounts after the limit',async t=>{
  const app=await appFixture(t,{limits:{loginAttempts:2}});
  assert.equal((await request(app,'/api/auth/register',{method:'POST',body:{...credentials,password:'short'}})).status,400);
  assert.equal((await request(app,'/api/auth/login',{method:'POST',body:credentials})).status,401);
  const limited=await request(app,'/api/auth/register',{method:'POST',body:credentials});assert.equal(limited.status,429);assert.equal(limited.body.error.code,'RATE_LIMITED');assert.ok(limited.headers['retry-after']);
  assert.equal(app.store.db.prepare('SELECT count(*) AS count FROM users').get().count,0);
});
