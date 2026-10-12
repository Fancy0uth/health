import { INITIAL, NAV, DEMO_SESSIONS } from './demo-data.js';
import { SharedStateClient } from './state-client.js';
import { requestJson } from './api.js';
export { INITIAL, NAV, DEMO_SESSIONS };
const KEY = 'healththread-demo-v1';
const DRAFT_KEY = 'healththread-unsynced-draft-v1';
const shared = typeof window !== 'undefined' && window.HEALTHTHREAD_CONFIG?.storageMode === 'shared';
let cache;
try { cache = JSON.parse(localStorage.getItem(KEY)); } catch { /* Cache is optional. */ }
if (!Array.isArray(cache?.records) || !Array.isArray(cache?.sessions)) cache = structuredClone(INITIAL);
const client = shared ? new SharedStateClient(cache, requestJson) : null;
let synchronizationError = null;
let profileGeneration = 0;
let savedDraft = null;
try { savedDraft = JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch {}
if (!Array.isArray(savedDraft?.records) || !Array.isArray(savedDraft?.sessions)) savedDraft = null;
function writeCache(value) { try { localStorage.setItem(KEY, JSON.stringify(value)); return true; } catch { return false; } }
function notify(type, detail) { if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(type, { detail })); }
if (client) {
  try { cache = await client.initialize(); }
  catch (error) { synchronizationError = error; client.error = error; }
  if (savedDraft) { client.restoreDraft(savedDraft); cache = client.snapshot(); synchronizationError = client.error; }
  writeCache(cache);
}
export function loadData() { return client ? client.snapshot() : structuredClone(cache); }
export function getProfileGeneration() { return profileGeneration; }
export function saveData(value) {
  if (value.deleteResult && value.deleteResult !== cache.deleteResult) profileGeneration++;
  cache = structuredClone(value);
  const saved = writeCache(cache);
  if (client) {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(cache)); } catch { /* Keep in-memory draft. */ }
    notify('healththread:sync', { status: 'saving' });
    client.save(cache).then(() => {
      if (!client.pending) { synchronizationError = null; try { localStorage.removeItem(DRAFT_KEY); } catch {} notify('healththread:sync', { status: 'saved' }); }
    }).catch(error => { synchronizationError = error; notify('healththread:sync', { status: 'failed', message: error.message }); });
  }
  return saved;
}
export function resetData() { try { localStorage.removeItem(KEY); } catch {} }
export async function flushData() { if (client) await client.flush(); }
export async function reloadData() {
  if (!client) return;
  const previousDeletion = cache.deleteResult;
  cache = await client.reload(); if (cache.deleteResult !== previousDeletion) profileGeneration++; synchronizationError = null; writeCache(cache);
  notify('healththread:state', { state: loadData() }); notify('healththread:sync', { status: 'saved' });
}
export function createEmptyState() {
  return { ...structuredClone(INITIAL), records: [], sessions: [], activeSessionId: null, selectedHistory: [], factHistory: [], cardArchive: [], cardRecords: [], factVersion: 0, cardVersion: 0, cardDraft: '', cardStartDate: null, symptomStart: '', currentConcern: '', cardConcern: '', impact: '', questions: [], uploadedName: '', uploadState: 'empty', medical: null, taskStatus: 'pending', recordReviewed: false, consent: { organize: false, parse: false, voice: false }, exportAt: '', deleteResult: new Date().toISOString(), cardSourceDeleted: false };
}
if (client) {
  const hasDraft = () => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return true;
    return [...document.querySelectorAll('input,textarea,select')].some(field => {
      if (field.disabled || field.readOnly || field.type === 'hidden') return false;
      if (['checkbox', 'radio'].includes(field.type)) return field.checked !== field.defaultChecked;
      if (field.tagName === 'SELECT') return [...field.options].some(option => option.selected !== option.defaultSelected);
      return field.value !== field.defaultValue;
    });
  };
  const refresh = async () => {
    if (document.visibilityState === 'hidden') return;
    if (hasDraft()) return;
    try { if (await client.refresh({ canApply: () => !hasDraft() })) { const previousDeletion = cache.deleteResult; cache = client.snapshot(); if (cache.deleteResult !== previousDeletion) profileGeneration++; writeCache(cache); notify('healththread:state', { state: loadData() }); } }
    catch (error) { notify('healththread:sync', { status: 'failed', message: '暂时无法同步，本地草稿仍保留。' }); }
  };
  setInterval(refresh, 2500);
  window.addEventListener('focus', refresh);
  document.addEventListener('visibilitychange', refresh);
  const bar = document.createElement('div');
  bar.setAttribute('role', 'status'); bar.style.cssText = 'position:fixed;z-index:10000;bottom:8px;left:50%;transform:translateX(-50%);max-width:90vw;padding:8px 12px;background:#fff9e8;border:1px solid #e4c87a;border-radius:8px;font:13px system-ui;display:none';
  document.body.append(bar);
  window.addEventListener('healththread:sync', event => {
    if (event.detail.status === 'failed') {
      bar.replaceChildren(document.createTextNode(event.detail.message || '同步失败，草稿已保留。'));
      const button = document.createElement('button'); button.textContent = '读取服务器版本'; button.style.marginLeft = '8px';
      button.onclick = () => reloadData().catch(error => { bar.firstChild.textContent = error.message; });
      const download = document.createElement('button'); download.textContent = '下载未同步草稿'; download.style.marginLeft = '8px';
      download.onclick = () => {
        const raw = localStorage.getItem(DRAFT_KEY); if (!raw) return;
        const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'HealthThread-unsynced-draft.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      };
      bar.append(download, button); bar.style.display = 'block';
    } else if (event.detail.status === 'saved') bar.style.display = 'none';
  });
  if (synchronizationError) queueMicrotask(() => notify('healththread:sync', { status: 'failed', message: synchronizationError.message || '服务未连接，本地草稿已保留。' }));
}
