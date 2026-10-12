import test from 'node:test';
import assert from 'node:assert/strict';
let SharedStateClient;
try { ({ SharedStateClient } = await import('../packages/client/state-client.js')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
const initial = { records: [], sessions: [], consent: { organize: true } };
function fixture() {
  assert.ok(SharedStateClient, 'shared state client must be implemented');
  let remote = { revision: 1, state: structuredClone(initial) };
  let failure = null;
  const writes = [];
  const client = new SharedStateClient(initial, async (path, options = {}) => {
    if (failure) throw failure;
    if (options.method === 'PUT') {
      writes.push(structuredClone(options.body));
      if (options.body.expected_revision !== remote.revision) { const error = new Error('conflict'); error.code = 'REVISION_CONFLICT'; throw error; }
      remote = { revision: remote.revision + 1, state: structuredClone(options.body.state) };
    }
    return structuredClone(remote);
  });
  return { client, writes, setFailure(value) { failure = value; }, remoteUpdate(state) { remote = { revision: remote.revision + 1, state }; } };
}

test('serial saves carry the latest committed revision without dropping the newer edit', async () => {
  const f = fixture(); await f.client.initialize();
  const one = { ...initial, currentConcern: '第一次编辑' };
  const two = { ...initial, currentConcern: '第二次编辑' };
  await Promise.all([f.client.save(one), f.client.save(two)]);
  assert.deepEqual(f.writes.map(write => write.expected_revision), [1, 2]);
  assert.equal(f.client.snapshot().currentConcern, '第二次编辑');
});

test('failed persistence retains the local draft and prevents polling from replacing it', async () => {
  const f = fixture(); await f.client.initialize();
  f.setFailure(new Error('offline'));
  await assert.rejects(f.client.save({ ...initial, currentConcern: '尚未同步的草稿' }));
  f.setFailure(null);
  f.remoteUpdate({ ...initial, currentConcern: '远端内容' });
  await f.client.refresh();
  assert.equal(f.client.snapshot().currentConcern, '尚未同步的草稿');
  await f.client.reload();
  assert.equal(f.client.snapshot().currentConcern, '远端内容');
});

test('a revision conflict never replays a stale draft on top of remote changes', async () => {
  const f = fixture(); await f.client.initialize();
  f.remoteUpdate({ ...initial, currentConcern: '另一端更新' });
  await assert.rejects(f.client.save({ ...initial, currentConcern: '本地待核对' }), { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.client.save({ ...initial, currentConcern: '继续编辑' }), { code: 'REVISION_CONFLICT' });
  assert.equal(f.writes.length, 1);
  assert.equal(f.client.snapshot().currentConcern, '继续编辑');
});

test('idle refresh replaces an outdated view with the other client update', async () => {
  const f = fixture(); await f.client.initialize();
  f.remoteUpdate({ ...initial, currentConcern: '手机保存的内容' });
  assert.equal(await f.client.refresh(), true);
  assert.equal(f.client.snapshot().currentConcern, '手机保存的内容');
});

test('refresh cannot apply remote data when an editor becomes dirty during the read', async () => {
  const f = fixture(); await f.client.initialize();
  f.remoteUpdate({ ...initial, currentConcern: '远端更新' });
  assert.equal(await f.client.refresh({ canApply: () => false }), false);
  assert.equal(f.client.snapshot().currentConcern, undefined);
});

test('recovering an unsynced draft exposes it without replaying over the current server revision', async () => {
  const f = fixture(); await f.client.initialize();
  assert.equal(typeof f.client.restoreDraft, 'function');
  f.client.restoreDraft({ ...initial, currentConcern: '刷新前未同步的编辑' });
  assert.equal(f.client.snapshot().currentConcern, '刷新前未同步的编辑');
  await assert.rejects(f.client.flush(), { code: 'UNSYNCED_DRAFT' });
  assert.equal(f.writes.length, 0);
  await f.client.reload();
  assert.equal(f.client.snapshot().currentConcern, undefined);
});
