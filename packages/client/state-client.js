export class SharedStateClient {
  constructor(initial, request) {
    this.state = structuredClone(initial); this.request = request; this.revision = 0;
    this.pending = 0; this.sequence = 0; this.error = null; this.queue = Promise.resolve();
  }
  snapshot() { return structuredClone(this.state); }
  restoreDraft(state) {
    this.state = structuredClone(state);
    this.error = new Error('有未同步的本地草稿，已恢复供你核对；请下载草稿后读取服务器版本。');
    this.error.code = 'UNSYNCED_DRAFT';
  }
  async initialize() { return this.reload(); }
  async reload() {
    await this.queue;
    const value = await this.request('/api/state');
    if (!Number.isSafeInteger(value.revision) || value.revision < 1 || !Array.isArray(value.state?.records) || !Array.isArray(value.state?.sessions)) throw new Error('共享资料格式有误。');
    this.state = structuredClone(value.state); this.revision = value.revision; this.error = null;
    return this.snapshot();
  }
  save(state) {
    this.state = structuredClone(state);
    const snapshot = this.snapshot(); const sequence = ++this.sequence; this.pending++;
    const work = this.queue.then(async () => {
      if (this.error) throw this.error;
      const value = await this.request('/api/state', { method: 'PUT', body: { state: snapshot, expected_revision: this.revision } });
      this.revision = value.revision;
      if (sequence === this.sequence) this.state = structuredClone(value.state);
      return value;
    }).catch(error => { this.error = error; throw error; }).finally(() => { this.pending--; });
    this.queue = work.catch(() => undefined);
    return work;
  }
  async flush() { await this.queue; if (this.error) throw this.error; }
  async refresh({ canApply = () => true } = {}) {
    if (this.pending || this.error) return false;
    const sequence = this.sequence; const value = await this.request('/api/state');
    if (this.pending || this.error || this.sequence !== sequence || value.revision === this.revision || !canApply()) return false;
    this.state = structuredClone(value.state); this.revision = value.revision; return true;
  }
}
