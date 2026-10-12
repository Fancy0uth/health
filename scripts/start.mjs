import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { createHealthThreadServer } from '../services/api/server.mjs';
import { AgnesAgent } from '../services/api/agnes-agent.mjs';
import { buildSdk } from './build-agh-sdk.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
let agent = null;
if (process.env.AGENT_MODE === 'agnes') {
  const path = await buildSdk();
  const sdk = await import(pathToFileURL(path).href);
  let options;
  if (process.env.AGH_SDK_OPTIONS_JSON) options = JSON.parse(process.env.AGH_SDK_OPTIONS_JSON);
  else {
    let socket = process.env.AGH_SOCKET_PATH;
    if (!socket && process.env.AGH_HOME) socket = JSON.parse(await readFile(resolve(process.env.AGH_HOME, 'data/daemon/owner.json'), 'utf8')).socketPath;
    if (!socket) throw new Error('请设置 AGH_SOCKET_PATH 或与 AGH 一致的 AGH_HOME。');
    options = { transport: { kind: 'unix', path: socket }, auth: { kind: 'local' } };
  }
  agent = new AgnesAgent({ createClient: sdk.createClient, journal: sdk.memoryJournal, connectionOptions: options, cwd: root, preset: process.env.AGH_PRESET });
}
let demoAccounts = [];
if (process.env.HEALTHTHREAD_DEMO_AUTH === '1') {
  if (!process.env.HEALTHTHREAD_DEMO_USERNAME || !process.env.HEALTHTHREAD_DEMO_PASSWORD) throw new Error('Explicit demo username and password are required.');
  demoAccounts = [{ username: process.env.HEALTHTHREAD_DEMO_USERNAME, password: process.env.HEALTHTHREAD_DEMO_PASSWORD }];
}
const app = createHealthThreadServer({ demoAccounts, databasePath: resolve(root, process.env.HEALTHTHREAD_DB_PATH || '.runtime/healththread-domain.sqlite'), agent });
const host = process.env.HOST || '127.0.0.1'; const port = Number(process.env.PORT || 4173);
await app.listen(port, host);
console.log(`HealthThread: http://${host}:${port}/\n电脑版：/web/\n手机版：/mobile/\nAGH：${agent ? 'SDK 接入已启用；首次调用将检查 Agnes 配置' : '未配置，AI 请求会明确失败'}`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await app.close(); process.exit(0); });
