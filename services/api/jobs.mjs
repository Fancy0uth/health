import { randomUUID } from 'node:crypto';

export class AgentJobs {
  constructor(store, agent) { this.store = store; this.agent = agent; this.active = new Map(); this.pending = new Set(); }
  start(workflow, payload) {
    const run = { run_id: 'run_' + randomUUID(), workflow, status: 'queued', phase: 'queued', result_ref: null, error: null, created_at: new Date().toISOString() };
    this.store.saveRun(run);
    const controller = new AbortController();
    this.active.set(run.run_id, controller);
    const work = Promise.resolve().then(async () => {
      try {
        if (controller.signal.aborted) return;
        this.store.saveRun({ ...run, status: 'running', phase: 'agnes_execution' });
        const snapshot = this.store.read();
        const result = await this.agent.run({ workflow, payload, context: { records: snapshot.state.records, profile_revision: snapshot.revision }, signal: controller.signal });
        if (controller.signal.aborted) return;
        const resultRef = 'result_' + randomUUID();
        this.store.saveResult(resultRef, result);
        this.store.saveRun({ ...run, status: 'completed', phase: 'completed', result_ref: resultRef, finished_at: new Date().toISOString() });
      } catch (error) {
        if (!controller.signal.aborted) this.store.saveRun({ ...run, status: 'failed', phase: 'failed', error: { code: error.code || 'AGENT_FAILED', message: error.publicMessage || 'AGH 执行失败，请检查服务端配置或重试。' } });
      } finally { this.active.delete(run.run_id); }
    });
    this.pending.add(work);
    work.finally(() => this.pending.delete(work));
    return run;
  }
  cancel(id) {
    const run = this.store.getRun(id);
    if (!run) return null;
    if (!['queued', 'running'].includes(run.status)) return run;
    this.active.get(id)?.abort();
    const cancelled = { ...run, status: 'cancelled', phase: 'cancelled', error: null };
    this.store.saveRun(cancelled);
    return cancelled;
  }
  cancelAll() { for (const id of this.active.keys()) this.cancel(id); }
  async close() { for (const id of this.active.keys()) this.cancel(id); await Promise.allSettled(this.pending); await this.agent?.close?.(); }
}
