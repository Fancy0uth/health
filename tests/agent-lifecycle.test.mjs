import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../packages/client/api.js';

test('a completed result arriving after profile deletion cannot reach either frontend handler', async () => {
  assert.equal(typeof api.createAgentRequester, 'function');
  let generation = 1;
  const cancelled = [];
  const request = api.createAgentRequester({
    flush: async () => {}, getGeneration: () => generation,
    request: async path => {
      if (path === '/api/visit-preparations') return { run_id: 'run_fixture', workflow: 'visit_preparation', status: 'queued', phase: 'queued', result_ref: null, error: null };
      if (path === '/api/runs/run_fixture') return { run_id: 'run_fixture', status: 'completed', phase: 'completed', result_ref: 'result_fixture', error: null };
      if (path === '/api/results/result_fixture') { generation++; return { speech: '删除前的旧结果', questions: [] }; }
      if (path === '/api/runs/run_fixture/cancel') { cancelled.push(path); return { status: 'completed' }; }
      throw new Error('unexpected route');
    },
  });
  await assert.rejects(request('/api/visit-preparations', { current_concern: '合成测试' }), { code: 'PROFILE_CHANGED' });
  assert.equal(cancelled.length, 1);
});
