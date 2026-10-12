import test from 'node:test';
import assert from 'node:assert/strict';
let AgnesAgent;
try { ({ AgnesAgent } = await import('../services/api/agnes-agent.mjs')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }
function fixture({ reason = 'completed', stopReason = 'end_turn', answer = '{"description":"合成描述","date":null}', provider = 'agnes-ai' } = {}) {
  assert.ok(AgnesAgent, 'Agnes SDK adapter must be implemented');
  const calls = [];
  const session = {
    id: 'session-fixture',
    onPermissionRequest(fn) { this.permission = fn; },
    async setModel(model) { calls.push(['model', model]); },
    async prompt(text, { signal }) { calls.push(['prompt', text]); signal?.throwIfAborted(); return { reason, stopReason, lastSeq: 3 }; },
    async projectUI() { return { sessionId: this.id, upto: 3, generation: 1, opState: 'idle', turns: [], nodes: [{ kind: 'assistant', id: 'assistant-1', seq: 3, text: answer }] }; },
    async cancel() { calls.push(['cancel']); },
  };
  const client = { initialize: async () => {}, config: { get: async () => ({ configured: true, provider: { id: provider, model: 'agnes-3.0-flash', route: provider, credentialConfigured: true } }) }, session: { new: async options => { calls.push(['session', options]); return session; } }, close: async () => {} };
  const agent = new AgnesAgent({ createClient: () => client, connectionOptions: { transport: { kind: 'unix', path: '/fixture/daemon.sock' }, auth: { kind: 'local' } }, cwd: '/fixture/workspace' });
  return { agent, session, calls };
}

test('only a committed completed Agnes turn produces a normalized candidate', async () => {
  const f = fixture();
  const result = await f.agent.run({ workflow: 'daily_record', payload: { text: '合成描述' }, context: { records: [] } });
  assert.equal(result.description, '合成描述');
  assert.equal(result.date, null);
  assert.equal(result.agh.session_id, 'session-fixture');
  assert.equal(result.agh.last_seq, 3);
  assert.ok(f.calls.some(([kind]) => kind === 'model'));
  assert.deepEqual(await f.session.permission({ options: [] }), { verdict: 'rejected' });
});

test('an interrupted or truncated turn cannot be returned as successful output', async () => {
  for (const options of [{ reason: 'parked' }, { stopReason: 'max_tokens' }]) {
    const f = fixture(options);
    await assert.rejects(f.agent.run({ workflow: 'daily_record', payload: { text: '合成描述' }, context: {} }), { code: 'AGH_TURN_INCOMPLETE' });
  }
});

test('the SDK adapter refuses a configured provider other than Agnes', async () => {
  const f = fixture({ provider: 'another-provider' });
  await assert.rejects(f.agent.run({ workflow: 'assistant', payload: { text: '合成描述' }, context: {} }), { code: 'AGNES_PROVIDER_REQUIRED' });
  assert.ok(!f.calls.some(([kind]) => kind === 'prompt'));
});

test('invalid model JSON or a fabricated calendar date is rejected', async () => {
  for (const answer of ['没有 JSON', '{"description":"合成描述","date":"2026-02-31"}']) {
    const f = fixture({ answer });
    await assert.rejects(f.agent.run({ workflow: 'daily_record', payload: { text: '合成描述' }, context: {} }), { code: 'INVALID_AGENT_OUTPUT' });
  }
});

test('medical text keeps original input as authoritative even if model rewrites it', async () => {
  const f = fixture({ answer: '{"original":"被模型改写","date":null,"onset":null,"task":null}' });
  const result = await f.agent.run({ workflow: 'medical_document', payload: { text: '合成病历原文' }, context: {} });
  assert.equal(result.original, '合成病历原文');
});
