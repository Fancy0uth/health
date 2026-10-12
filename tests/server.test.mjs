import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let createHealthThreadServer;
try { ({ createHealthThreadServer } = await import('../services/api/server.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

async function fixture(t, agent) {
  assert.ok(createHealthThreadServer, 'shared backend must be implemented');
  const directory = await mkdtemp(join(tmpdir(), 'healththread-test-'));
  const options = { databasePath: join(directory, 'state.sqlite'), agent };
  let app = createHealthThreadServer(options);
  await app.listen(0, '127.0.0.1');
  const base = () => `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    base,
    async request(path, body, method = body ? 'POST' : 'GET') {
      const response = await fetch(base() + path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
      return { status: response.status, body: await response.json() };
    },
    async restart() { await app.close(); app = createHealthThreadServer(options); await app.listen(0, '127.0.0.1'); },
  };
}

test('both independent apps and their shared modules are reachable', async t => {
  const f = await fixture(t);
  for (const path of ['/web/', '/mobile/', '/web/src/app.js', '/mobile/app.js', '/packages/client/data.js', '/packages/client/chat.js', '/web/assets/healththread-logo.svg', '/mobile/assets/mark.png']) {
    const response = await fetch(f.base() + path);
    assert.equal(response.status, 200, path);
    assert.ok((await response.arrayBuffer()).byteLength > 0, path);
  }
  assert.equal((await fetch(f.base() + '/services/api/server.mjs')).status, 404);
  assert.equal((await fetch(f.base() + '/.env')).status, 404);
});

test('one client saves a record and another reads it after a server restart', async t => {
  const f = await fixture(t);
  const before = await f.request('/api/state');
  const state = before.body.state;
  state.records.push({ id: 'record-cross-device', text: '合成记录', date: null, status: 'pending' });
  const saved = await f.request('/api/state', { state, expected_revision: before.body.revision }, 'PUT');
  assert.equal(saved.status, 200);
  await f.restart();
  const after = await f.request('/api/state');
  assert.ok(after.body.state.records.some(item => item.id === 'record-cross-device'));
  assert.equal(after.body.revision, before.body.revision + 1);
});

test('an outdated frontend cannot overwrite a newer state revision', async t => {
  const f = await fixture(t);
  const original = (await f.request('/api/state')).body;
  const next = structuredClone(original.state);
  next.currentConcern = '来自手机的新内容';
  assert.equal((await f.request('/api/state', { state: next, expected_revision: original.revision }, 'PUT')).status, 200);
  const stale = await f.request('/api/state', { state: original.state, expected_revision: original.revision }, 'PUT');
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'REVISION_CONFLICT');
  assert.equal((await f.request('/api/state')).body.state.currentConcern, '来自手机的新内容');
});

test('a shared deletion remains empty after restart', async t => {
  const f = await fixture(t);
  const original = (await f.request('/api/state')).body;
  const state = { ...original.state, records: [], sessions: [], medical: null, cardRecords: [], selectedHistory: [], cardVersion: 0, factVersion: 0, deleteResult: '2026-10-12T00:00:00Z' };
  assert.equal((await f.request('/api/state', { state, expected_revision: original.revision }, 'PUT')).status, 200);
  await f.restart();
  const after = (await f.request('/api/state')).body.state;
  assert.deepEqual(after.records, []);
  assert.deepEqual(after.sessions, []);
  assert.equal(after.medical, null);
});

test('AI endpoints fail explicitly when Agnes Harness is not configured', async t => {
  const f = await fixture(t);
  const reply = await f.request('/api/health-assistant', { question: '合成测试' });
  assert.equal(reply.status, 503);
  assert.equal(reply.body.error.code, 'AGENT_NOT_CONFIGURED');
});

test('AI jobs expose real result references and do not trust browser history', async t => {
  const received = [];
  const f = await fixture(t, { async run(task) { received.push(task); return { answer: '合成测试结果', action: 'timeline' }; } });
  const reply = await f.request('/api/health-assistant', { question: '查看记录', records: [{ id: 'forged', text: '伪造历史' }] });
  assert.equal(reply.status, 202);
  let run;
  for (let i = 0; i < 30; i++) {
    run = (await f.request(`/api/runs/${reply.body.run_id}`)).body;
    if (run.status === 'completed') break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.equal(run.status, 'completed');
  assert.ok(run.result_ref);
  assert.equal((await f.request(`/api/results/${run.result_ref}`)).body.answer, '合成测试结果');
  assert.ok(!received[0].context.records.some(item => item.id === 'forged'));
});

test('malformed state and cross-origin mutations are rejected', async t => {
  const f = await fixture(t);
  assert.equal((await f.request('/api/state', { state: {}, expected_revision: 1 }, 'PUT')).status, 400);
  const response = await fetch(f.base() + '/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', Origin: 'https://unrelated.example' }, body: '{}' });
  assert.equal(response.status, 403);
});

test('deleting shared data cancels outstanding jobs and discards their late results', async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const f = await fixture(t, { run: async () => pending });
  const accepted = (await f.request('/api/visit-preparations', { current_concern: '合成描述' })).body;
  const current = (await f.request('/api/state')).body;
  await f.request('/api/state', { state: { ...current.state, records: [], sessions: [], medical: null, deleteResult: '2026-10-12T01:00:00Z' }, expected_revision: current.revision }, 'PUT');
  release({ speech: '过时的生成内容', questions: [] });
  await new Promise(resolve => setTimeout(resolve, 10));
  const run = (await f.request(`/api/runs/${accepted.run_id}`)).body;
  assert.equal(run.status, 'cancelled');
  assert.equal(run.result_ref, null);
});
