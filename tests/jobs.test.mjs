import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentJobs } from '../services/api/jobs.mjs';
import { StateStore } from '../services/api/state-store.mjs';

test('cancelling a queued task keeps it cancelled when its worker starts later', async () => {
  const store = new StateStore(':memory:');
  const jobs = new AgentJobs(store, { async run() { return { answer: '合成结果' }; } });
  try {
    const run = jobs.start('assistant', { text: '合成输入' });
    jobs.cancel(run.run_id);
    await jobs.close();
    assert.equal(store.getRun(run.run_id).status, 'cancelled');
    assert.equal(store.getRun(run.run_id).result_ref, null);
  } finally { store.close(); }
});
