import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../../services/api/domain-server.mjs';
import {DomainClient,MemoryStorage} from '../../packages/client/domain-client.js';

const credentials={username:'new_patient',password:'synthetic-signup-secret'};
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'ht-signup-client-'));const app=createApp({dbPath:join(dir,'test.sqlite'),demoAccounts:[{username:'alice',password:'alice-password'},{username:'bob',password:'bob-password'}]});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});await app.listen(0);const base=`http://127.0.0.1:${app.server.address().port}`,jar={cookie:''};
  const transport=async(path,options={})=>{const r=await fetch(base+path,{...options,headers:{...options.headers,Origin:base,Cookie:jar.cookie}});if(r.headers.has('set-cookie'))jar.cookie=r.headers.get('set-cookie').split(';')[0];return r;};
  function make(fetchImpl=transport,storage=new MemoryStorage()){const client=new DomainClient({fetchImpl,storage,channel:null});t.after(()=>client.dispose());return client;}
  return{app,jar,transport,make};
}
const storageText=storage=>Array.from({length:storage.length},(_,index)=>storage.getItem(storage.key(index))).join('\n');

test('registration switches identity, refreshes canonical empty data and quarantines the previous account requests',async t=>{
  const f=await fixture(t),storage=new MemoryStorage();let loseEntry=true;
  const client=f.make(async(path,options)=>{const r=await f.transport(path,options);if(path==='/api/entries'&&loseEntry){loseEntry=false;throw new TypeError('synthetic lost entry response');}return r;},storage);
  await client.login('alice','alice-password');await client.setConsent(true);const oldUser=client.state.user.id;client.setDraft('record','旧账号的合成草稿。');
  await assert.rejects(client.createEntry('旧账号的合成原文。'),{code:'OUTCOME_UNKNOWN'});const oldOperation=client.pendingOperations()[0];
  await client.register(credentials.username,credentials.password);assert.notEqual(client.state.user.id,oldUser);assert.equal(client.state.user.username,'new_patient');
  assert.equal(client.state.timeline.entries.length,0);assert.equal(client.state.profile.facts.length,0);assert.equal(client.state.tasks.tasks.length,0);assert.equal(client.state.consents.consents[0].granted,false);
  assert.equal(client.getDraft('record'),'');assert.equal(client.pendingOperations().length,0);assert.equal(client.scopeEpoch,1);assert.ok(client.csrf&&client.sessionEpoch);
  await assert.rejects(client.retryOperation(oldOperation.id),{code:'OPERATION_MISSING'});const oldSource=f.app.store.timeline(oldUser).entries[0].source_id;await assert.rejects(client.source(oldSource),{code:'NOT_FOUND'});
  assert.ok(!storageText(storage).includes(credentials.password));assert.ok(!storageText(storage).includes('旧账号的合成草稿。'));
  const second=f.make();await second.initialize();assert.equal(second.state.user.id,client.state.user.id);assert.equal(second.state.consents.consents[0].granted,false);
  const uid=client.state.user.id;await client.logout();assert.equal(client.state.user,null);await second.initialize();assert.equal(second.state.user,null);
  await second.login(credentials.username,credentials.password);assert.equal(second.state.user.id,uid);
});

test('a lost signup response offers existing-account login, does not retry or journal the password',async t=>{
  const f=await fixture(t),storage=new MemoryStorage();let registrationRequests=0;
  const client=f.make(async(path,options)=>{const r=await f.transport(path,options);if(path==='/api/auth/register'){registrationRequests++;if(registrationRequests===1)throw new TypeError('synthetic connection loss after signup');}return r;},storage);
  await assert.rejects(client.register(credentials.username,credentials.password),error=>error.code==='REGISTRATION_UNCERTAIN'&&error.message.includes('登录'));
  assert.equal(registrationRequests,1);assert.equal(client.state.user,null);assert.equal(client.pendingOperations().length,0);assert.ok(!storageText(storage).includes(credentials.password));
  const uid=f.app.store.db.prepare('SELECT id FROM users WHERE username=?').get(credentials.username).id;
  await assert.rejects(client.register(credentials.username,'replacement-signup-secret'),{status:409,code:'ACCOUNT_EXISTS'});assert.equal(registrationRequests,2);
  await client.login(credentials.username,credentials.password);assert.equal(client.state.user.id,uid);assert.equal(client.state.consents.consents[0].granted,false);
  assert.equal(f.app.store.db.prepare('SELECT count(*) AS count FROM users WHERE username=?').get(credentials.username).count,1);assert.ok(!storageText(storage).includes(credentials.password));
});

test('a late signup response cannot replace the newer login identity',async t=>{
  const f=await fixture(t);let arrived,release;const ready=new Promise(resolve=>arrived=resolve),hold=new Promise(resolve=>release=resolve);
  const client=f.make(async(path,options)=>{const r=await f.transport(path,options);if(path==='/api/auth/register'){arrived();await hold;}return r;});
  const pending=client.register(credentials.username,credentials.password).catch(error=>error);await ready;await client.login('bob','bob-password');const bob=client.state.user.id;
  release();assert.equal((await pending).code,'SESSION_CHANGED');assert.equal(client.state.user.id,bob);assert.equal(client.state.user.username,'bob');assert.equal(client.state.timeline.entries.length,0);
});
