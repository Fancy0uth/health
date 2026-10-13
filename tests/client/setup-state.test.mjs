import test from 'node:test';
import assert from 'node:assert/strict';
import {SetupSession, consumeLaunchToken, safeError} from '../../apps/setup/state.js';

test('editing a tested key invalidates model selection and prevents saving', async () => {
  const s = new SetupSession();
  s.setKey('secret');
  await s.test(async () => ({ticket:'verified',models:[{id:'model-a',name:'A'}]}));
  assert.equal(s.canSave, true);
  s.setKey('different');
  assert.equal(s.canSave, false);
  assert.equal(s.ticket, null);
  assert.deepEqual(s.models, []);
});
test('pending connection test cannot restore a ticket for a changed key', async () => {
  const s = new SetupSession();s.setKey('first');let finish;
  const request = s.test(() => new Promise(resolve => {finish=resolve;}));
  s.setKey('second');finish({ticket:'old',models:[{id:'a'}]});await request;
  assert.equal(s.canSave,false);
});
test('only a returned model can be selected and duplicate requests are suppressed', async () => {
  const s = new SetupSession();s.setKey('first');let finish;let count=0;
  const request=s.test(()=>{count++;return new Promise(resolve=>{finish=resolve;});});
  await s.test(()=>{count++;});assert.equal(count,1);
  finish({ticket:'ok',models:[{id:'a'}]});await request;
  s.selectModel('unverified');assert.equal(s.canSave,false);
});
test('launch token is removed from URL immediately and unknown errors stay generic', () => {
  let clean;
  assert.equal(consumeLaunchToken({hash:'#launch=private',pathname:'/setup/',search:''},{replaceState:(_a,_b,url)=>clean=url}),'private');
  assert.equal(clean,'/setup/');
  assert.equal(safeError({code:'server private secret',message:'secret'}),'暂时无法完成操作，请稍后重试。');
});

test('mobile return is allowlisted and arbitrary redirect values stay on desktop', async () => {
  const {projectDestination} = await import('../../apps/setup/state.js');
  assert.equal(projectDestination('?return=mobile'), '/mobile/');
  assert.equal(projectDestination(''), '/web/');
  assert.equal(projectDestination('?return=https://evil.example'), '/web/');
  assert.equal(projectDestination('?return=//evil.example'), '/web/');
});
test('stale configuration revision gives an explicit refresh instruction', () => {
  assert.match(safeError({code:'CONFIG_REVISION_CONFLICT'}), /请刷新后重新测试连接/);
});
