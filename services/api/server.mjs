import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StateStore } from './state-store.mjs';
import { AgentJobs } from './jobs.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json; charset=utf-8' };
class HttpError extends Error { constructor(status, code, message) { super(message); this.status = status; this.code = code; } }
const fail = (status, code, message) => { throw new HttpError(status, code, message); };
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) fail(415, 'JSON_REQUIRED', '请提交 JSON；本期真实病历接口支持文字，PDF 解析待接入。');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 2 * 1024 * 1024) fail(413, 'PAYLOAD_TOO_LARGE', '请求超过大小限制。'); chunks.push(chunk); }
  try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { fail(400, 'INVALID_JSON', '请求内容不是有效 JSON 对象。'); }
}
function validateState(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.records) || !Array.isArray(value.sessions) || !value.consent || typeof value.consent !== 'object' || value.records.length > 10000 || value.sessions.length > 1000) fail(400, 'INVALID_STATE', '共享资料格式不正确。');
  if (value.records.some(record => !record || typeof record.id !== 'string' || typeof record.text !== 'string')) fail(400, 'INVALID_STATE', '记录必须包含编号和原文。');
}
function sameOrigin(req) {
  if (!req.headers.origin) return;
  let host; try { host = new URL(req.headers.origin).host; } catch { fail(403, 'ORIGIN_DENIED', '请求来源不受信任。'); }
  if (host !== req.headers.host) fail(403, 'ORIGIN_DENIED', '请从同一业务服务访问。');
}

export function createHealthThreadServer({ databasePath = resolve(root, '.runtime/healththread.sqlite'), agent = null } = {}) {
  const store = new StateStore(databasePath);
  const jobs = new AgentJobs(store, agent);
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/api/')) {
        if (!['GET', 'HEAD'].includes(req.method)) sameOrigin(req);
        if (pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, storage: 'sqlite', profile: 'synthetic-demo', agent: agent ? 'agnes-harness' : 'not-configured' });
        if (pathname === '/api/state' && req.method === 'GET') return json(res, 200, store.read());
        if (pathname === '/api/state' && req.method === 'PUT') {
          const value = await body(req); validateState(value.state);
          if (!Number.isSafeInteger(value.expected_revision) || value.expected_revision < 1) fail(400, 'INVALID_REVISION', '缺少有效资料版本。');
          const previous = store.read();
          const saved = store.write(value.state, value.expected_revision);
          if (!saved) fail(409, 'REVISION_CONFLICT', '另一端已更新资料；本地草稿已保留，请重新读取后核对。');
          if (saved.state.deleteResult && saved.state.deleteResult !== previous.state.deleteResult) jobs.cancelAll();
          return json(res, 200, saved);
        }
        const run = pathname.match(/^\/api\/runs\/([^/]+)(\/cancel)?$/);
        if (run && (req.method === 'GET' && !run[2] || req.method === 'POST' && run[2])) {
          const result = run[2] ? jobs.cancel(run[1]) : store.getRun(run[1]);
          if (!result) fail(404, 'RUN_NOT_FOUND', '没有找到对应任务。');
          return json(res, 200, result);
        }
        const result = pathname.match(/^\/api\/results\/([^/]+)$/);
        if (result && req.method === 'GET') {
          const value = store.getResult(result[1]); if (!value) fail(404, 'RESULT_NOT_FOUND', '没有找到对应结果。');
          return json(res, 200, value);
        }
        const workflows = { '/api/health-assistant': 'assistant', '/api/health-record': 'daily_record', '/api/medical-document': 'medical_document', '/api/visit-preparations': 'visit_preparation' };
        if (workflows[pathname] && req.method === 'POST') {
          if (!agent) fail(503, 'AGENT_NOT_CONFIGURED', 'Agnes Harness 尚未连接；原文和草稿仍可保存。');
          const value = await body(req);
          const text = value.question || value.text || value.current_concern;
          if (typeof text !== 'string' || !text.trim() || text.length > 32000) fail(400, 'INVALID_INPUT', '请提供有效的文字输入。');
          if (!store.read().state.consent?.[workflows[pathname] === 'medical_document' ? 'parse' : 'organize']) fail(403, 'CONSENT_REQUIRED', '请先授权相应资料处理。');
          return json(res, 202, jobs.start(workflows[pathname], { text, selected_record_ids: value.selected_record_ids || [] }));
        }
        fail(404, 'API_NOT_FOUND', '接口不存在。');
      }
      if (pathname === '/runtime-config.js') {
        res.writeHead(200, { 'Content-Type': mime['.js'], 'Cache-Control': 'no-store' });
        return res.end(`window.HEALTHTHREAD_CONFIG=${JSON.stringify({ storageMode: 'shared', aiMode: agent ? 'agnes' : 'disabled', profile: 'synthetic-demo' })};window.HEALTHTHREAD_API_URL='/api/health-assistant';window.HEALTHTHREAD_RECORD_URL='/api/health-record';window.HEALTHTHREAD_PARSE_URL='/api/medical-document';`);
      }
      if (pathname === '/') {
        res.writeHead(200, { 'Content-Type': mime['.html'] });
        return res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>HealthThread</title><body style="font:18px system-ui;max-width:640px;margin:64px auto;padding:24px"><h1>HealthThread</h1><p>两套独立界面，共用一个资料后端。</p><p><a href="/web/">打开电脑版</a></p><p><a href="/mobile/">打开手机版</a></p><p>当前使用合成演示档案。</p></body></html>');
      }
      if (!['GET', 'HEAD'].includes(req.method)) fail(405, 'METHOD_NOT_ALLOWED', '请求方法不受支持。');
      const mounts = [['/web/', resolve(root, 'apps/web')], ['/mobile/', resolve(root, 'apps/mobile')], ['/packages/client/', resolve(root, 'packages/client')]];
      const mount = mounts.find(([prefix]) => pathname.startsWith(prefix));
      if (!mount) fail(404, 'NOT_FOUND', '页面不存在。');
      const relative = pathname.slice(mount[0].length) || 'index.html';
      const file = resolve(mount[1], relative);
      if (!file.startsWith(mount[1] + sep) || relative.includes('\0') || relative.split('/').some(part => part.startsWith('.'))) fail(403, 'PATH_DENIED', '路径不受支持。');
      let bytes; try { bytes = await readFile(file); } catch { fail(404, 'NOT_FOUND', '文件不存在。'); }
      res.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: { code: error.code || 'INTERNAL_ERROR', message: error.status ? error.message : '服务暂时不可用。' } });
      else res.end();
    }
  });
  return {
    server,
    listen: (port = 4173, host = '127.0.0.1') => new Promise((resolvePromise, reject) => { server.once('error', reject); server.listen(port, host, () => { server.off('error', reject); resolvePromise(); }); }),
    async close() { await jobs.close(); server.closeAllConnections(); await new Promise(resolvePromise => server.close(resolvePromise)); store.close(); },
  };
}
