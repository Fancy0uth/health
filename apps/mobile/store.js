import { loadData, INITIAL, saveData, createEmptyState } from '../../packages/client/data.js';

export const KEY = 'healththread-demo-v1';
export const PREFS_KEY = 'healththread-mobile-preferences-v1';
export const MEDICAL_TEXT = '自述10月1日起饭后腹胀，偶有反酸。建议整理近期症状记录，复诊时携带。用药：未记载。';
export const day = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
export const id = prefix => prefix + '-' + crypto.randomUUID();
export let data = hydrate(loadData());
export let preferences = readPreferences();

function readPreferences() {
  try { return { reduceMotion: false, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') }; }
  catch { return { reduceMotion: false }; }
}
function hydrate(value) {
  value.records = Array.isArray(value.records) ? value.records : [];
  value.sessions = Array.isArray(value.sessions) ? value.sessions : [];
  value.factHistory ||= [];
  value.cardArchive ||= [];
  value.cardGeneratedAt ||= '2026-10-08';
  value.consent = { organize: true, parse: true, voice: false, ...value.consent };
  value.medical ||= (value.deleteResult || window.HEALTHTHREAD_CONFIG?.storageMode === 'shared') ? null : { name: value.uploadedName || '模拟门诊记录.pdf', original: MEDICAL_TEXT, date: '2026-10-08', onset: '2026-10-01', task: '整理近期症状记录，复诊时携带。', status: value.uploadState === 'reviewed' ? 'confirmed' : 'pending', demo: true, checkedFields: value.uploadState === 'reviewed' ? ['date', 'task'] : [] };
  return value;
}
export function reload() { data = hydrate(loadData()); preferences = readPreferences(); }
export function persist() { return saveData(data); }

export function setPreference(key, value) {
  preferences[key] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(preferences)); } catch { /* Preference still applies in memory. */ }
}
export const record = value => data.records.find(r => r.id === value);
export const session = value => data.sessions.find(s => s.id === value);
export const sessions = () => [...data.sessions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
export const stale = () => !!data.cardSourceDeleted || data.cardVersion < data.factVersion;
export const cardExists = () => data.cardVersion > 0;
export const pending = () => data.records.filter(r => r.status !== 'confirmed').reduce((n, r) => n + 2 - (r.confirmedFields?.length || 0), 0);
export function ensureSession(text, currentId) {
  let result = session(currentId);
  if (!result) {
    result = { id: id('c'), title: /胃|腹|反酸/.test(text) ? '胃部不适与就诊准备' : text.slice(0, 24), updatedAt: new Date().toISOString(), messages: [] };
    data.sessions.unshift(result);
  }
  data.activeSessionId = result.id;
  return result;
}
export function addRecord(text, currentId) {
  const created = new Date();
  const item = { id: id('r'), created: `${day(created)} ${created.toTimeString().slice(0, 5)}`, date: null, text, status: 'pending', analysis: 'saved', source: '用户自述', issue: /胃|腹|反酸/.test(text) ? '胃部不适' : '身体感受', confirmedFields: [] };
  data.records.unshift(item);
  const chat = ensureSession(text, currentId);
  chat.messages.push({ role: 'user', text, kind: 'record', recordId: item.id }, { role: 'assistant', text: '原文已保存。请核对症状描述和事件日期。', action: 'review', recordId: item.id });
  chat.updatedAt = created.toISOString();
  persist();
  return { item, chat };
}
export function candidateDate(text) {
  const iso = text.match(/(20\d{2})[-年/](\d{1,2})[-月/](\d{1,2})日?/);
  const chinese = text.match(/(\d{1,2})月(\d{1,2})日/);
  const y = iso ? +iso[1] : new Date().getFullYear();
  const m = iso ? +iso[2] : chinese ? +chinese[1] : null;
  const d = iso ? +iso[3] : chinese ? +chinese[2] : null;
  if (!m || !d) return null;
  const parsed = new Date(y, m - 1, d);
  if (parsed.getMonth() !== m - 1 || parsed.getDate() !== d) return null;
  return day(parsed);
}
export function correctDate(item, newValue, reason) {
  const previous = item.date;
  const version = ++data.factVersion;
  data.factHistory.push({ recordId: item.id, version, oldValue: previous, newValue, reason, changedAt: new Date().toISOString() });
  item.date = newValue;
  item.correction = reason;
  item.version = version;
  item.confirmedFields = [...new Set([...(item.confirmedFields || (item.status === 'confirmed' ? ['description', 'date'] : [])), 'date'])];
  item.status = item.confirmedFields.length === 2 ? 'confirmed' : 'pending';
  if (item.id === 'r1') data.symptomStart = newValue;
  persist();
}
export function prepareVisit(chatId) {
  const chat = session(chatId);
  const concern = [...(chat?.messages || [])].reverse().find(m => m.role === 'user' && /不舒服|不适|痛|胀|反酸|发热|头晕|咳/.test(m.text));
  data.visitSessionId = chat?.id || null;
  if (concern) {
    data.currentConcern = concern.text;
    data.visitHasRelevantHistory = /胃|腹|反酸/.test(concern.text);
    if (!data.visitHasRelevantHistory) { data.selectedHistory = []; data.impact = ''; data.visitStartDate = null; }
  }
  persist();
}
export function speech() {
  if (data.cardDraft) return data.cardDraft;
  if (!cardExists()) return '';
  if (data.cardConcern === INITIAL.cardConcern) {
    const start = data.cardStartDate ? `${Number(data.cardStartDate.slice(5, 7))}月${Number(data.cardStartDate.slice(8, 10))}日` : '开始时间未记录';
    return `${start}${data.cardStartDate ? '起，' : '。'}饭后腹胀，偶尔反酸。10月6日有所缓解。近期用药和过敏情况还没记录。`;
  }
  return `本次情况：${data.cardConcern || '未记录'}\n开始时间：${data.cardStartDate || '未记录'}。\n用药与过敏情况：未记录。`;
}
export function generateCard() {
  if (cardExists()) data.cardArchive.push({ version: data.cardVersion, startDate: data.cardStartDate, generatedAt: data.cardGeneratedAt, text: speech(), questions: [...data.questions], records: structuredClone(data.cardRecords || []), stale: stale() });
  data.cardSourceDeleted = false;
  data.factVersion = Math.max(1, data.factVersion);
  data.cardVersion = data.factVersion;
  data.cardStartDate = data.visitHasRelevantHistory === false ? data.visitStartDate || null : data.symptomStart || null;
  data.cardConcern = data.currentConcern;
  data.cardConversationId = data.visitSessionId || null;
  data.cardGeneratedAt = day();
  data.cardRecords = (data.selectedHistory || []).map(record).filter(Boolean).map(r => ({ id: r.id, date: r.date, text: r.summary || r.text, source: r.source, status: r.status, version: r.version || 1 }));
  data.cardDraft = '';
  data.cardConfirmed = false;
  persist();
}
export function removeConversation(value) {
  if (data.cardConversationId === value) data.cardSourceDeleted = true;
  data.sessions = data.sessions.filter(s => s.id !== value);
  if (data.activeSessionId === value) data.activeSessionId = null;
  persist();
}
export function exportPayload(ranges) {
  const result = { product: 'HealthThread', schemaVersion: 3, exportedAt: new Date().toISOString(), dataOrigin: '本浏览器资料，可能包含初始合成示例与用户输入' };
  if (ranges.has('records')) Object.assign(result, { records: data.records, facts: { symptomStart: data.symptomStart, version: data.factVersion }, factHistory: data.factHistory });
  if (ranges.has('sessions')) result.sessions = data.sessions;
  if (ranges.has('medical')) Object.assign(result, { medical: data.medical, task: data.medical?.status === 'confirmed' ? { text: data.medical.task, status: data.taskStatus, source: data.medical.name } : null });
  if (ranges.has('card')) result.communicationCards = { current: cardExists() ? { text: speech(), version: data.cardVersion, startDate: data.cardStartDate, questions: data.questions, generatedAt: data.cardGeneratedAt, stale: stale(), sources: data.cardRecords } : null, archive: data.cardArchive.map(c => ({ ...c, stale: true })) };
  return result;
}
export function deleteLocalData() {
  data = createEmptyState();
  saveData(data);
  return data.deleteResult;
}
