import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { INITIAL } from '../../packages/client/demo-data.js';

export class StateStore {
  constructor(path) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS prototype_state (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, json TEXT NOT NULL); CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, json TEXT NOT NULL)');
    this.db.prepare('INSERT OR IGNORE INTO prototype_state VALUES (1, 1, ?)').run(JSON.stringify(INITIAL));
    for (const row of this.db.prepare('SELECT id, json FROM runs').all()) {
      const run = JSON.parse(row.json);
      if (['queued', 'running'].includes(run.status)) this.saveRun({ ...run, status: 'interrupted', phase: 'interrupted', error: { code: 'PROCESS_INTERRUPTED', message: '服务已重启，请检查已有结果后重试。' } });
    }
  }
  read() {
    const row = this.db.prepare('SELECT revision, json FROM prototype_state WHERE id = 1').get();
    return { revision: row.revision, state: JSON.parse(row.json) };
  }
  write(state, revision) {
    const result = this.db.prepare('UPDATE prototype_state SET revision = revision + 1, json = ? WHERE id = 1 AND revision = ?').run(JSON.stringify(state), revision);
    return result.changes === 1 ? this.read() : null;
  }
  saveRun(run) { this.db.prepare('INSERT OR REPLACE INTO runs VALUES (?, ?)').run(run.run_id, JSON.stringify(run)); }
  getRun(id) { const row = this.db.prepare('SELECT json FROM runs WHERE id = ?').get(id); return row ? JSON.parse(row.json) : null; }
  saveResult(id, result) { this.db.prepare('INSERT INTO results VALUES (?, ?)').run(id, JSON.stringify(result)); }
  getResult(id) { const row = this.db.prepare('SELECT json FROM results WHERE id = ?').get(id); return row ? JSON.parse(row.json) : null; }
  close() { this.db.close(); }
}
