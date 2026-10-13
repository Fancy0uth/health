import {isRecordConfirmation} from '../../packages/client/record-dialogue.js';
import {assertionLabel,scopeLabel} from '../../packages/client/presentation.js';
import {nativeBridge} from '../../packages/client/native-bridge.js';
const native=nativeBridge();
import { requestAgent } from '../../packages/client/api.js';
import { flushData } from '../../packages/client/data.js';
import { askAssistant, appendAssistantReply, executionLabel } from '../../packages/client/chat.js';
import * as store from './store.js';

const app = document.getElementById('app');
const overlays = document.getElementById('overlays');
const toastNode = document.getElementById('toast');
const d = () => store.data;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dateLabel = value => value ? `${Number(value.slice(5, 7))}月${Number(value.slice(8, 10))}日` : '未记录';
const lines = value => escape(value).replaceAll('\n', '<br>');
const MAIN = ['home', 'timeline', 'card', 'settings'];
const titles = { home: '首页', timeline: '健康时间线', card: '医生沟通卡', settings: '设置与数据', chat: '健康助手', conversations: '对话记录', conversation: '完整对话', review: '提取结果核对', analysis: '整理这条记录', visit: '就诊准备', history: '选择相关历史', reference: '就诊入口参考', transcript: '语音转写校对', correct: '更正事实', versions: '事实版本', upload: '上传病历', parsing: '解析病历', medicalReview: '病历差异核对', editCard: '编辑沟通卡', print: '分享与打印', consent: '授权管理', export: '数据导出', exporting: '生成导出文件', exportResult: '导出结果', delete: '删除数据', deleting: '删除处理中', result: '处理结果' };
let route = parseRoute();
let sheet = null;
let sheetTrigger = null;
let conversationQuery = '';
let inputMode = 'ask';
const drafts={ask:'',record:native.client.getDraft('record',''),transcript:''};
const filters = { issue: 'all', time: 'all', status: 'all', task: 'all' };
const checked = new Set();
let reviewSnapshot=null;
let medicalReviewSnapshot=null;
let confirmBusy=false;
const capturedReview=(item,medical=false)=>{const snapshot=medical?medicalReviewSnapshot:reviewSnapshot;return snapshot?.source_ids.includes(medical?item?.source_id:item?.id)?snapshot:null;};
const exportRanges = new Set(['records', 'sessions', 'medical', 'card']);
const medicalChecked = new Set();
let medicalChoice = 'keep';
let deleteAcknowledged = false;
let busySession = null;
let requestSequence = 0;
let jobSequence = 0;
let jobController = null;
let voice = null;
let voiceText = '';
let voiceCancelled = false;
let file=null;
let selectedTask=null;
let exportFile = null;
let lastTab = MAIN.indexOf(route.page);
const scrollPositions = new Map();
const routeKey = value => `${value.page}/${value.view}/${value.id || ''}`;
const activeRecord = () => store.record(route.id) || d().records.find(r => r.status !== 'confirmed') || d().records[0];
const activeChat = () => store.session(route.id || d().activeSessionId);
const reduceMotion = () => store.preferences.reduceMotion || matchMedia('(prefers-reduced-motion: reduce)').matches;
const hasFooter = () => ['review', 'visit', 'history', 'reference', 'transcript', 'correct', 'versions', 'upload', 'medicalReview', 'editCard', 'print', 'export', 'delete'].includes(route.view) || route.page === 'card' && !route.view && store.cardExists();
const hasComposer = () => route.page === 'home' && (!route.view || route.view === 'chat');
const hasNav = () => !route.view || ['conversations', 'consent', 'result'].includes(route.view) || route.page === 'timeline' && route.view === 'medical';
const nodeId = () => ({ home: '64:1580', timeline: '64:1849', card: '64:1937', settings: '64:1983' })[route.page];

function icon(name, size = 24) { return `<span class="icon" style="--icon-size:${size}px" aria-hidden="true"><img src="./assets/${name}.svg" alt="" loading="eager" /></span>`; }
function mark(size = 32) { return `<img class="brand-mark" src="./assets/mark.png" width="52" height="43" style="width:${size}px;height:${size * 36 / 44}px" alt="" />`; }
const wordmark = (width = 140) => `<img class="wordmark" src="./assets/wordmark.svg" width="156" height="19" style="width:${width}px;height:${width * 19 / 156}px" alt="HealthThread" />`;
const button = (label, action, tone = '', extra = '') => `<button type="button" class="button ${tone}" data-action="${action}" ${extra}>${escape(label)}</button>`;
const iconButton = (name, action, label, extra = '') => `<button type="button" class="icon-button" data-action="${action}" aria-label="${escape(label)}" ${extra}>${icon(name)}</button>`;
const badge = (value, label) => `<span class="badge ${value}">${escape(label || ({ confirmed: '已核对', reference:'就诊描述', pending: '待核对', stale: '已过期', conflict: '有冲突', done: '已完成', paused: '已暂停' })[value])}</span>`;
const section = (title, content, className = '') => `<section class="card ${className}">${title ? `<h2>${escape(title)}</h2>` : ''}${content}</section>`;
const heading = (title, side = '') => `<div class="section-heading"><h2>${escape(title)}</h2>${side}</div>`;
const notice = (title, text, tone = '') => `<aside class="notice ${tone}"><strong>${escape(title)}</strong><p>${escape(text)}</p></aside>`;
const fact = (label, value) => `<div class="fact"><span>${escape(label)}</span><span>${escape(value || '未记录')}</span></div>`;
const source = (id = 'r1', label = '用户自述') => `<button type="button" class="source" data-action="source" data-id="${escape(id)}">${icon('document', 18)}<span>${escape(label)} · 查看来源</span></button>`;
const actionRow = (title, subtitle, glyph, action, extra = '') => `<button type="button" class="action-row" data-action="${action}" ${extra}>${icon(glyph)}<span class="row-copy"><strong>${escape(title)}</strong><small>${escape(subtitle)}</small></span>${icon('chevron')}</button>`;
const checkRow = (title, subtitle, name, value, selected) => `<label class="check-row"><input type="checkbox" name="${name}" value="${escape(value)}" ${selected ? 'checked' : ''}/><span class="check-box">${icon('check', 16)}</span><span class="row-copy"><strong>${escape(title)}</strong><small>${escape(subtitle)}</small></span></label>`;
const field = (label, name, value, type = 'text', extra = '') => `<label class="field"><span>${escape(label)}</span><input name="${name}" type="${type}" value="${escape(value)}" ${extra}/></label>`;
const textarea = (label, name, value, rows = 3, extra = '') => `<label class="field"><span>${escape(label)}</span><textarea name="${name}" rows="${rows}" ${extra}>${escape(value)}</textarea></label>`;
const empty = (title, text, action = '') => `<section class="empty">${mark(52)}<h2>${escape(title)}</h2><p>${escape(text)}</p>${action}</section>`;
function sessionTime(chat) {
  const date = new Date(chat.updatedAt);
  const label = date.toDateString() === new Date().toDateString() ? '今天' : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${label} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} · ${chat.messages.length} 条消息`;
}

function parseRoute() {
  const parts = location.hash.slice(1).split('/');
  const page = MAIN.includes(parts[0]) ? parts[0] : 'home';
  const view = parts[1] === 'medical' && page === 'timeline' || titles[parts[1]] ? parts[1] || '' : '';
  return { page, view, id: parts[2] ? decodeURIComponent(parts[2]) : '' };
}
function go(page, view = '', id = '', replace = false) {
  scrollPositions.set(routeKey(route), document.querySelector('.screen-body')?.scrollTop || 0);
  closeSheet(false);
  route = { page, view, id };
  const hash = `#${page}${view ? '/' + view : ''}${id ? '/' + encodeURIComponent(id) : ''}`;
  history[replace ? 'replaceState' : 'pushState']({ healththread: true }, '', hash);
  render(true);
}
function back() {
  if (sheet) return closeSheet();
  if (history.state?.healththread) history.back();
  else go(route.page, route.page === 'timeline' && ['upload', 'medicalReview', 'parsing'].includes(route.view) ? 'medical' : '', '', true);
}
function notify(message) {
  toastNode.textContent=message;
  if(native.client.pendingOperations().length){const recover=document.createElement('button');recover.className='button secondary';recover.dataset.action='recover-original';recover.textContent='恢复原请求';toastNode.append(recover);}
  toastNode.classList.add('visible');
  clearTimeout(notify.timer);
  if(!native.client.pendingOperations().length)notify.timer=setTimeout(()=>toastNode.classList.remove('visible'),3400);
}
function save() {
  const success = store.persist();
  if (!success) notify('浏览器未保存这些修改，请导出资料后再关闭页面。');
  return success;
}
function render(animate = false) {
  const focus = document.activeElement;
  const focusName = app.contains(focus) ? focus.name : '';
  const selection = focusName && 'selectionStart' in focus ? [focus.selectionStart, focus.selectionEnd] : null;
  const scroll = document.querySelector('.screen-body')?.scrollTop || 0;
  document.documentElement.classList.toggle('reduce-motion', reduceMotion());
  const body = content();
  const headerTitle = titles[route.view] || titles[route.page];
  const core = !route.view || route.view === 'medical';
  const header = route.page === 'home' && !route.view ? `<div class="brand">${mark()}${wordmark()}</div>${iconButton('chat', 'conversations', '查看全部对话')}` : `${core ? '' : iconButton('back', 'back', '返回上一页')}<h1>${escape(headerTitle)}</h1>${headerAction(core)}`;
  const time = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  app.innerHTML = `<div class="phone ${hasNav() ? 'with-nav' : ''} ${hasFooter() ? 'with-footer' : ''} ${hasComposer() ? 'with-composer' : ''}" data-node-id="${nodeId()}"><div class="status-bar" aria-hidden="true"><span>${time}</span><span>${navigator.onLine ? '在线' : '离线'} ▰</span></div><header class="app-header">${header}</header><main class="screen-body ${animate ? 'entering' : ''}" id="main"><div class="content ${route.view === 'chat' || route.view === 'conversation' ? 'chat-content' : ''}">${body}</div></main>${hasComposer() ? composer() : ''}${hasFooter() ? `<footer class="sticky-actions">${footer()}</footer>` : ''}${hasNav() ? navigation() : '<div class="safe-bottom"></div>'}</div>`;
  document.title = `${headerTitle} · HealthThread 手机端`;
  const scroller = document.querySelector('.screen-body');
  scroller.scrollTop = animate ? scrollPositions.get(routeKey(route)) || 0 : scroll;
  const target = focusName && app.querySelector(`[name="${CSS.escape(focusName)}"]`);
  if (target && !animate) { target.focus({ preventScroll: true }); if (selection && target.setSelectionRange && !['date', 'checkbox'].includes(target.type)) target.setSelectionRange(...selection); }
  const tab = MAIN.indexOf(route.page);
  const indicator = document.querySelector('.nav-indicator');
  if (indicator && lastTab !== tab && !reduceMotion()) indicator.animate([{ transform: `translateX(${lastTab * 100}%)` }, { transform: `translateX(${tab * 100}%)` }], { duration: 260, easing: 'cubic-bezier(.2,.8,.2,1)' });
  lastTab = tab;
  app.querySelector('input[type="file"]')?.addEventListener('change', onFile);
}
function headerAction(core) {
  if (route.view === 'chat' || route.view === 'conversations') return iconButton('plus', 'new-chat', '开始新对话');
  if (core && route.page === 'timeline') return iconButton(route.view === 'medical' ? 'upload' : 'plus', route.view === 'medical' ? 'upload' : 'record-change', route.view === 'medical' ? '上传病历' : '记录新变化');
  if (core && route.page === 'card') return iconButton('copy', 'copy-card', '复制沟通卡', store.cardExists() ? '' : 'disabled');
  if (core && route.page === 'settings') return iconButton('shield', 'consent', '授权管理');
  return iconButton('close', 'return-parent', '返回所属主页面');
}
function navigation() {
  return `<nav class="bottom-navigation" aria-label="主导航"><div class="nav-track"><span class="nav-indicator" style="transform:translateX(${MAIN.indexOf(route.page) * 100}%)"></span>${MAIN.map((page, i) => `<button type="button" class="nav-item ${route.page === page ? 'selected' : ''}" data-action="nav" data-page="${page}" ${route.page === page ? 'aria-current="page"' : ''}>${icon(page)}<span>${['首页', '时间线', '沟通卡', '设置'][i]}</span></button>`).join('')}</div><div class="home-indicator" aria-hidden="true"></div></nav>`;
}
function composer() {
  const ask = inputMode === 'ask';
  return `<form id="composer" class="composer"><div class="input-modes" role="group" aria-label="输入用途"><button type="button" data-action="mode-ask" class="${ask ? 'active' : ''}" aria-pressed="${ask}">向助手提问</button><button type="button" data-action="mode-record" class="${ask ? '' : 'active'}" aria-pressed="${!ask}">记录身体感受</button></div><div class="input-controls"><label class="sr-only" for="message-input">${ask ? '向助手提问' : '记录身体感受'}</label><textarea id="message-input" name="message" rows="1" placeholder="想聊什么，或记录身体感受…">${escape(drafts[inputMode])}</textarea>${iconButton('mic', 'voice', voice ? '停止录音' : '语音输入', (window.SpeechRecognition || window.webkitSpeechRecognition) ? '' : 'disabled title="当前浏览器不支持语音转写"')}${iconButton('send', 'send', ask ? '发送问题' : '发送记录', busySession ? 'disabled' : '')}</div></form>`;
}

function content() {
  if (!route.view) return ({ home: home, timeline: timeline, card: communicationCard, settings })[route.page]();
  switch (route.view) {
    case 'chat': return chat();
    case 'conversations': return conversations();
    case 'conversation': return conversation();
    case 'analysis': return analysis();
    case 'review': return review();
    case 'visit': return visit();
    case 'history': return historySelection();
    case 'reference': return reference();
    case 'transcript': return `<h2>先检查，再保存</h2><p class="muted">核对时间、数字、药名与否定词。</p>${textarea('转写文本', 'transcript', drafts.transcript, 6)}${notice('可直接修改文字', '确认后保存原文，再核对候选事实。')}`;
    case 'correct': return correction();
    case 'versions': return versions();
    case 'medical': return medical();
    case 'upload': return upload();
    case 'parsing': return `<h2>正在解析病历</h2>${progress('正在提取候选字段', '原文已保存在当前演示档案，核对后才更新资料。')}${button('取消解析', 'cancel-job', 'secondary')}`;
    case 'medicalReview': return medicalReview();
    case 'editCard': return editCard();
    case 'print': return printCard();
    case 'consent': return consent();
    case 'export': return exportPage();
    case 'exporting': return progress('正在生成资料包', '保留原文、来源与版本标记。');
    case 'exportResult': return section('资料包已生成', `${badge('confirmed', '已生成')}${fact('生成时间', d().exportAt)}${fact('文件格式', 'JSON · schema v3')}${button('下载文件', 'download-export')}`);
    case 'delete': return deletePage();
    case 'deleting': return progress('正在清除当前演示档案资料', '完成后显示实际处理结果。');
    case 'result': return resultPage();
    default: return home();
  }
}
function home() {
  const recent = store.sessions()[0];
  return `<h2 class="greeting">你好，${escape(native.client.state.user?.username||'')}</h2><p class="muted">今天想聊些什么？</p><section class="assistant-hero"><div class="assistant-heading">${mark(52)}<div><h2>AI 健康助手</h2><small>聊聊近况，也能整理就诊资料</small></div></div>${button('饭后腹胀，想准备就诊', 'suggest', 'secondary')}</section>${heading('最近对话', '<button class="text-button" type="button" data-action="conversations">查看全部</button>')}${recent ? actionRow(recent.title, sessionTime(recent), 'chat', 'conversation', `data-id="${escape(recent.id)}"`) : actionRow('还没有对话记录', '开始新对话', 'chat', 'new-chat')}${actionRow(store.pending() ? `${store.pending()} 项待核对` : '当前没有待核对事项', store.pending() ? '开始时间、症状描述' : '记录身体感受后可在这里核对', 'document', store.pending() ? 'review' : 'record-change')}`;
}
function messageMarkup(messages) {
  return messages.map(m => `<article class="message ${m.role === 'user' ? 'user' : 'assistant'} ${m.error ? 'error' : ''}">${m.role === 'assistant' ? `<div class="assistant-label">${mark(24)}<span>健康助手</span></div>` : ''}<p>${lines(m.text)}</p>${m.run_id?`<small class="muted" title="${escape(m.run_id)}">${escape(executionLabel(native.client.state.runs[m.run_id]))}</small>`:''}${m.error ? button('重试回复', 'retry-chat', 'secondary') : m.action ? button(({ visit: '查看就诊准备', timeline: '查看健康时间线', review: '核对这条记录', home: '继续记录' })[m.action] || '继续', m.action === 'review' ? 'review' : 'message-' + m.action, 'secondary', `data-id="${escape(m.recordId || '')}"`) : ''}</article>`).join('');
}
function chat() {
  const current = activeChat();
  return `${window.HEALTHTHREAD_API_URL ? '' : '<p class="demo-label">演示回复 · 尚未接入 AI 服务</p>'}${current?.messages.length ? messageMarkup(current.messages) : empty('今天想聊点什么？', '描述不适、整理记录，或准备就诊。', button('饭后腹胀，想准备就诊', 'suggest', 'secondary'))}${busySession === current?.id ? `<article class="message assistant" role="status"><div class="assistant-label">${mark(24)}<span>健康助手</span></div><div class="loading-dots"><i></i><i></i><i></i></div><small>正在通过 AGH 生成回复…</small></article>` : ''}`;
}
function conversations() {
  const all = store.sessions();
  const query = conversationQuery.trim().toLowerCase();
  const found = all.filter(c => [c.title, ...c.messages.map(m => m.text)].join('\n').toLowerCase().includes(query));
  return `${field('搜索对话', 'search', conversationQuery, 'search', 'placeholder="搜索标题或完整消息…"')}<p class="muted small" role="status">${query ? `找到 ${found.length} 个对话` : `${all.length} 个对话`}</p>${found.map(c => actionRow(c.title, sessionTime(c), 'chat', 'conversation', `data-id="${escape(c.id)}"`)).join('') || empty(all.length ? '没有找到相关对话' : '还没有对话', all.length ? '试试其他关键词。' : '从一条问题开始。', button(all.length ? '清除搜索' : '开始新对话', all.length ? 'clear-search' : 'new-chat', 'secondary'))}`;
}
function conversation() {
  const current = activeChat();
  if (!current) return empty('这段对话已删除', '已保存的健康记录仍可在时间线查看。', button('返回对话记录', 'conversations', 'secondary'));
  return `<div class="section-heading"><h2>${escape(current.title)}</h2>${iconButton('trash', 'delete-conversation', '删除这段对话', `data-id="${escape(current.id)}"`)}</div><p class="muted small">${sessionTime(current)}</p>${messageMarkup(current.messages)}${button('继续对话', 'continue-chat', '', `data-id="${escape(current.id)}"`)}${button('查看就诊准备', 'prepare', 'secondary', `data-id="${escape(current.id)}"`)}`;
}
function timelineTabs() {
  return `<div class="segmented" aria-label="时间线内容"><button type="button" data-action="health-tab" class="${route.view !== 'medical' ? 'selected' : ''}" aria-pressed="${route.view !== 'medical'}">健康记录</button><button type="button" data-action="medical-tab" class="${route.view === 'medical' ? 'selected' : ''}" aria-pressed="${route.view === 'medical'}">病历与事项</button></div>`;
}
function timeline() {
  const records = d().records.filter(r => (filters.issue === 'all' || r.issue === filters.issue) && (filters.status === 'all' || r.status === filters.status) && (filters.time === 'all' || r.date && new Date(r.date) >= new Date(Date.now() - 7 * 86400000)));
  const isFiltered = Object.values(filters).slice(0, 3).some(v => v !== 'all');
  return `${timelineTabs()}<div class="filter-row">${[['issue', filters.issue === 'all' ? '全部问题' : filters.issue], ['time', filters.time === 'all' ? '全部时间' : '最近 7 天'], ['status', ({ all: '全部状态', pending: '待核对', confirmed: '已核对' })[filters.status]]].map(([name, label]) => `<button type="button" data-action="filters" data-filter="${name}">${escape(label)} ⌄</button>`).join('')}</div>${records.length ? `<div class="issue-group"><h2>${filters.issue === 'all' && records.every(r => r.issue === '胃部不适') ? '胃部不适' : filters.issue === 'all' ? '健康记录' : escape(filters.issue)}</h2><small>${records.length} 条记录 · 用户自述</small></div><div class="timeline-events">${records.map(r => `<article class="timeline-event ${r.status}"><section class="fact-card"><button class="record-open" type="button" data-action="record-detail" data-id="${escape(r.id)}"><div class="fact-card-heading"><strong>${dateLabel(r.date)}${r.id === 'r1' ? ' · 开始时间' : r.id === 'r2' ? ' · 最近一次' : ''}</strong>${badge(r.status)}</div><p>${escape(r.summary || r.text)}</p></button>${source(r.id, r.source)}</section></article>`).join('')}</div>${d().records.some(r => r.id === 'r1') ? button('更正开始时间', 'correct', 'secondary', 'data-id="r1"') : ''}${actionRow('版本与冲突', `当前 v${d().factVersion} · 查看来源与更改`, 'document', 'versions')}${store.stale() && store.cardExists() ? notice('相关沟通卡已过期', '重新生成后会使用更正后的信息。', 'warning') + button('查看沟通卡', 'nav-card', 'secondary') : ''}` : empty(isFiltered ? '当前筛选下没有记录' : '还没有健康记录', isFiltered ? '调整筛选条件后再查看。' : '记录身体感受，原文会先保存。', button(isFiltered ? '清除筛选' : '记录新变化', isFiltered ? 'clear-filters' : 'record-change', 'secondary'))}`;
}
function analysis() {
  const item = activeRecord();
  if (!item) return empty('没有找到记录', '返回首页重新查看。');
  return `<h2>原文已保存</h2>${section('用户原文', `<blockquote>${escape(item.text)}</blockquote>`)}${item.analysis === 'failed' ? notice('分析未完成', '原文仍然保留，可以重试或手动核对。', 'warning') + button('重试分析', 'retry-analysis') + button('手动核对', 'review', 'secondary', `data-id="${escape(item.id)}"`) : progress('正在整理候选事实', '分析完成后由你核对。')}`;
}
async function openReview(value,preserve=false,medical=false) {
  const item=medical?d().medical:store.record(value)||d().records.find(r=>r.change_id)||activeRecord();
  if(!item)return notify('当前没有这条记录。');
  const selection=medical?medicalChecked:checked;if(!preserve)selection.clear();
  let snapshot=null;try{snapshot=await native.review(medical?item.source_id:item.id);store.reload();const valid=new Set(snapshot.proposals.map(p=>p.id));for(const id of selection)if(!valid.has(id))selection.delete(id);}
  catch(error){if(error.code!=='NO_PENDING_CANDIDATES')throw error;store.reload();selection.clear();}
  if(medical){medicalReviewSnapshot=snapshot;go('timeline','medicalReview');}else{reviewSnapshot=snapshot;go('home','review',item.id);}
}
async function confirmReview(medical=false) {
  const item=medical?d().medical:activeRecord(),selection=medical?medicalChecked:checked,snapshot=capturedReview(item,medical);
  if(confirmBusy||!item||!selection.size||!snapshot)return notify('请读取候选并选择要确认的字段。');
  confirmBusy=true;render();
  try{const receipt=await native.confirm(medical?item.source_id:item.id,[...selection],snapshot.review_revision,snapshot.id);store.reload();selection.clear();go('timeline',medical?'medical':'');notify('所选事实已确认。');if(receipt.continuation_run_id){try{await native.wait(receipt.continuation_run_id);}catch(error){notify('病历信息已确认；诊后事项整理未完成，原文与确认结果已保留。');}store.reload();render();}}
  catch(error){notify(error.code==='REVISION_CONFLICT'?'核对版本已变化，勾选已保留。请刷新核对内容，重新检查后提交。':error.message||'确认未完成，请恢复原请求。');}
  finally{confirmBusy=false;render();}
}
function review() {
  const current=activeRecord(),item=capturedReview(current)?{...current,proposals:reviewSnapshot.proposals}:current;if(!item)return empty('没有找到记录','请返回时间线。');
  return `<p class="muted">原文已保存 · 等待核对</p>${section('用户原文',`<blockquote>${escape(item.text)}</blockquote>`)}${heading('候选事实')}${(item.proposals||[]).map(p=>checkRow(p.value,`${assertionLabel(p.assertion)} · ${scopeLabel(p.temporal_scope)} · 时间：${p.effective_time?.raw||'未记录'}`,'review-field',p.id,checked.has(p.id))).join('')||notice('暂无可确认候选',item.analysis==='failed'?'分析未完成，原文保留。':'当前没有可确认候选；可重新整理原文或查看已确认的信息。')}${button('刷新核对内容','refresh-review','secondary')}${button(item.record_kind==='visit_context'?'整理为记录':'重新分析原文',item.record_kind==='visit_context'?'convert-record':'retry-analysis','secondary')}`;
}
function visit() {
  return `<h2>把这次情况理清楚</h2>${textarea('当前困扰', 'currentConcern', d().currentConcern || '', 3)}${section('', fact('开始时间', d().visitHasRelevantHistory === false ? d().visitStartDate : d().symptomStart) + fact('近期变化', d().recentChange || '未记录') + fact('进食影响', d().impact || '未记录'))}${field('补充开始时间', 'visitStartDate', d().visitHasRelevantHistory === false ? d().visitStartDate || '' : d().symptomStart, 'date')}${field('对日常活动或进食的影响', 'impact', d().impact || '', 'text', 'placeholder="不确定可留空"')}${heading('相关历史', `<small>已选 ${(d().selectedHistory || []).length} 条</small>`)}${(d().selectedHistory || []).map(value => store.record(value)).filter(Boolean).map(r => `<div class="selected-history">${actionRow(`${dateLabel(r.date)} · ${r.issue}`, `${r.source} · ${r.status === 'confirmed' ? '已核对' : '待核对'}`, 'timeline', 'source', `data-id="${escape(r.id)}"`)}${iconButton('close', 'remove-history', '移除这条历史', `data-id="${escape(r.id)}"`)}</div>`).join('')}${button('选择相关历史', 'history', 'secondary')}${notice('还可以补充', '近期用药、过敏史与既往检查尚未记录。', 'warning')}${actionRow('就诊入口参考', '查看适用范围与依据', 'document', 'reference')}`;
}
function historySelection() {
  return `<h2>与本次困扰相关</h2>${d().records.length ? d().records.map(r => checkRow(`${dateLabel(r.date)} · ${r.issue}`, `${r.source} · ${r.status === 'confirmed' ? '已核对' : '待核对'}`, 'history-field', r.id, (d().selectedHistory || []).includes(r.id))).join('') : empty('还没有历史记录', '可以先描述本次情况。')}<p class="muted small">历史记录与本次描述分别保留。</p>`;
}
function reference() {
  return `${notice('科室推荐与观察分级未配置','本页保留原文与就诊资料，相关判断请向医疗机构确认。','warning')}${section('参考依据', `<p>本次描述：${escape(d().currentConcern || '未记录')}</p><p>相关历史：${(d().selectedHistory || []).length} 条用户自述。</p>${source((d().selectedHistory || [])[0] || 'r1')}`)}${section('适用范围', '<p>用于整理就诊资料，不提供诊断或用药结论。</p>')}`;
}
function correction() {
  const item = activeRecord();
  if (!item) return empty('没有找到事实', '请返回时间线。');
  return `<h2>更正${item.id === 'r1' ? '开始时间' : '事件日期'}</h2>${field('原值', 'previousDate', item.date || '未记录', 'text', 'readonly')}${field('新值', 'editDate', drafts.editDate ?? item.date ?? '', 'date')}${textarea('修改原因', 'editReason', drafts.editReason || '', 3)}${notice('这次更正会影响', '时间线生成新版本；旧沟通卡将标记过期。', 'warning')}`;
}
function versions() {
  const history = [...d().factHistory].reverse();
  return `${notice(`当前使用 v${d().factVersion}`, '旧版本与原文仍可查看。')}${history.map(h => section(`v${h.version} · 用户更正`, fact('原值', h.oldValue) + fact('新值', h.newValue) + fact('修改原因', h.reason) + fact('更正时间', h.changedAt?.slice(0, 16).replace('T', ' ')) + source(h.recordId || 'r1'))).join('') || section('尚无更正记录', '<p>用户原文与病历候选分别保留，不自动覆盖。</p>')}${d().medical && d().medical.onset && d().symptomStart !== d().medical.onset && !d().medical.resolvedDate ? notice('病历候选与当前日期不同', `当前：${d().symptomStart || '未记录'}；病历候选：${d().medical.onset}。`, 'warning') + button('前往核对病历', 'medical-review', 'secondary') : ''}`;
}
function medical() {
  const tasks=(d().tasks||[]).filter(t=>filters.task==='all'||t.status===filters.task);
  return `${timelineTabs()}${heading('病历资料')}${(d().documents||[]).map(doc=>actionRow(doc.name,doc.status==='confirmed'?'已核对':'待核对','document','medical-review',`data-id="${escape(doc.source_id)}"`)).join('')||empty('还没有病历资料','上传后逐项核对。')}${button('上传资料','upload','secondary')}${heading('诊后事项')}<div class="task-filters">${[['all','全部'],['pending','待完成'],['done','已完成'],['paused','已暂停']].map(([value,label])=>`<button type="button" data-action="task-filter" data-value="${value}" class="${filters.task===value?'selected':''}">${label}</button>`).join('')}</div>${tasks.map(t=>actionRow(t.text,`${t.schedule||'未记录明确时间'} · ${{pending:'待完成',done:'已完成',paused:'已暂停'}[t.status]}${t.validity!=='current'?' · 已过期':''}`,'document','task',`data-id="${escape(t.id)}"`)).join('')||'<p class="muted">暂无诊后事项。</p>'}${button('记录新变化','record-change','secondary')}`;
}
function upload() {
  return `<h2>上传并核对病历</h2><button class="upload-zone" type="button" data-action="choose-file">${icon('upload', 40)}<strong>选择文件或病历文字</strong><small>文字 / 可复制文本的 PDF · 最大 5 MB</small></button><input type="file" id="medical-file" accept=".txt,.pdf,text/plain,application/pdf" hidden/>${file ? notice('文件仍在本机', `${file.name}；未上传，刷新后需重新选择。`) : ''}${d().uploadState === 'failed' ? notice('文件尚未解析', d().uploadError || '请查看已保存原文和运行状态，或重新选择原文件恢复请求。', 'warning') : ''}${textarea('也可以粘贴病历文字', 'medicalText', drafts.medicalText || '', 5, 'placeholder="粘贴可核对的病历原文"')}${button('解析这段文字', 'parse-text', 'secondary')}${notice('核对后才更新资料', window.HEALTHTHREAD_PARSE_URL ? '选中的文件将发送到项目配置的解析服务；授权可在设置中撤回。' : '病历文字保存在当前演示档案；当前仅演示字段提取。')}${actionRow('使用模拟门诊记录', '用于演示解析与差异核对', 'document', 'sample-file')}`;
}
function medicalReview() {
  const current=d().medical,item=capturedReview(current,true)?{...current,proposals:medicalReviewSnapshot.proposals}:current;if(!item)return empty('还没有病历','请先上传资料。',button('上传资料','upload'));
  return `<h2>原文与字段分别核对</h2>${section(item.name,`<blockquote>${escape(item.original)}</blockquote>`)}${heading('提取字段')}${(item.proposals||[]).map(p=>checkRow(p.value,`${assertionLabel(p.assertion)} · ${scopeLabel(p.temporal_scope)} · 时间：${p.effective_time?.raw||'未记录'}`,'medical-field',p.id,medicalChecked.has(p.id))).join('')||notice('暂无可确认候选',item.status==='confirmed'?'所选候选已核对。':'原文保留，请查看分析状态。')}${button('刷新核对内容','refresh-medical','secondary')}`;
}
function communicationCard() {
  if (!store.cardExists()) return empty('还没有沟通卡', '在首页整理本次情况，选择相关历史后生成。', button('准备就诊', 'prepare'));
  const stale = store.stale();
  return `<div class="section-heading"><h2 class="greeting">${/胃|腹|反酸/.test(d().cardConcern || '') ? '胃部不适' : escape(d().cardConcern || '就诊沟通')}</h2>${badge(stale ? 'stale' : d().cardConfirmed ? 'confirmed' : 'pending')}</div><p class="small muted">林悦 · ${dateLabel(d().cardGeneratedAt)}生成 · v${d().cardVersion}</p>${stale ? notice('内容已过期', d().cardSourceDeleted ? '引用的对话已删除；已保存的健康记录仍保留。' : '关联事实已更正，请核对后重新生成。', 'warning') : ''}${section('一分钟表达稿', `<p>${lines(store.speech())}</p>${source(d().cardConversationId||(d().cardRecords||[])[0]?.id||d().records[0]?.id)}`)}${section('本次情况', `<button class="fact fact-button" type="button" data-action="source" data-id="r1"><span>开始时间</span><span>${escape(d().cardStartDate || '未记录')}</span></button>${fact('用药情况', '未记录')}${fact('过敏情况', '未记录')}`)}${section('想问医生', `<ol>${d().questions.map(q => `<li>${escape(q)}</li>`).join('')}</ol>`)}${section('相关记录', (d().cardRecords || []).map(r => `<div class="card-source-record"><p>${dateLabel(r.date)} · ${escape(r.text)}</p>${source(r.id, r.source)}</div>`).join('') || '<p class="muted">未选择相关历史。</p>')}${notice('尚未确认的信息', '用药、过敏与日常影响仍需核对。')}`;
}
function editCard() {
  return `${textarea('一分钟表达稿', 'speech', drafts.speech ?? store.speech(), 6)}${textarea('想问医生（每行一个问题）', 'questions', drafts.questions ?? d().questions.join('\n'), 4)}${heading('固定事实与来源')}${section('', fact('开始时间', d().cardStartDate) + source(d().cardConversationId||d().records[0]?.id) + '<p class="muted small">用药与过敏情况：未记录</p>')}`;
}
function printCard() {
  return `<article class="print-sheet"><h2 class="print-title">医生沟通卡</h2><p class="small muted">林悦 · ${escape(d().cardGeneratedAt)} · v${d().cardVersion}${store.stale() ? ' · 内容已过期' : ''}</p><hr/><h2>一分钟表达稿</h2><p>${lines(store.speech())}</p><h2>本次情况</h2><p>开始时间：${escape(d().cardStartDate || '未记录')}<br>用药情况：未记录<br>过敏情况：未记录</p><h2>想问医生</h2><ol>${d().questions.map(q => `<li>${escape(q)}</li>`).join('')}</ol><hr/><p class="small muted">来源：用户自述。未核对字段请在就诊时说明。</p>${(d().cardRecords || []).map(r => `<p class="small muted">${dateLabel(r.date)} · ${escape(r.text)}</p>`).join('')}</article>${button('复制内容', 'copy-card', 'secondary')}`;
}
function settings() {
  return `<section class="profile"><span class="avatar">${escape((native.client.state.user?.username||'账号').slice(0,1))}</span><div><h2>${escape(native.client.state.user?.username||'账号')}</h2><small>个人健康资料</small></div></section>${actionRow('退出登录', '手机和电脑共享登录状态', 'shield', 'logout')}${heading('授权与隐私')}${actionRow('授权管理', '记录整理、病历解析与语音', 'shield', 'consent')}${heading('我的数据')}${actionRow('数据导出', '记录、对话与沟通卡', 'download', 'export')}${actionRow('删除数据', '查看范围并确认处理', 'trash', 'delete', 'class="danger-row"')}${actionRow('处理结果', '查看最近一次数据操作', 'document', 'result')}<label class="switch-row"><span class="row-copy"><strong>减少动态效果</strong><small>保留操作反馈，减少移动与波形</small></span><input type="checkbox" name="reduceMotion" role="switch" ${store.preferences.reduceMotion ? 'checked' : ''}/><span class="switch-track"></span></label><div class="settings-brand">${wordmark(156)}<small>HealthThread · 个人健康管家</small><a href="../index.html">查看网页端</a></div>`;
}
function consent() {
  const endpoint = window.HEALTHTHREAD_API_URL;
  return `<h2>决定哪些内容可以处理</h2>${[['organize', '健康记录整理', '记录原文与候选字段', endpoint ? '项目配置的 AI 服务' : '当前演示档案演示处理'], ['parse', '病历解析', '你选择的病历资料', window.HEALTHTHREAD_PARSE_URL ? '项目配置的解析服务' : '当前演示档案演示处理'], ['voice', '语音处理', '用于转写校对的音频', '浏览器 / 系统语音服务']].map(([key, title, use, destination]) => section('', `<label class="switch-row"><span class="row-copy"><strong>${title}</strong></span><input type="checkbox" name="consent" value="${key}" role="switch" ${d().consent[key] ? 'checked' : ''}/><span class="switch-track"></span></label><p class="small muted">用途：${use}</p><p class="small muted">数据去向：${destination}</p>${key === 'voice' ? '<p class="small muted">音频不会保存在此应用；语音服务的处理方式取决于浏览器。</p>' : ''}`)).join('')}<p class="small muted">撤回后停止新的处理请求。已保存内容可在数据设置中管理。</p>`;
}
function exportPage() {
  return `<h2>选择导出范围</h2>${[['records', '健康记录与事实', '包含原文、来源与版本'], ['sessions', '完整对话记录', '包含每段会话的全部消息'], ['medical', '病历与诊后事项', '包含核对结果与事项状态'], ['card', '医生沟通卡', '包含生成版本与过期标记']].map(([key, title, subtitle]) => checkRow(title, subtitle, 'export-range', key, exportRanges.has(key))).join('')}${notice('版本会一并保留', '旧沟通卡不会被当作最新内容导出。')}`;
}
function deletePage() {
  return `<h2>确认删除这些资料？</h2><p class="muted">操作完成后无法在此恢复。</p>${section('本次删除范围', '<p>健康记录与完整对话<br>病历、事实与版本<br>沟通卡与诊后事项</p>')}${notice('删除当前演示档案的资料', '网页端与手机端共享本地资料，两端会一起清除。模型轨迹、备份和存储残留未认证擦除，结果如实报告partial。', 'warning')}${checkRow('我已了解删除范围', '确认后开始处理', 'delete-ack', 'yes', deleteAcknowledged)}`;
}
function resultPage() {
  return `${d().deleteResult ? section('删除处理结果', `${badge('pending', '部分删除')}${fact('当前演示档案资料', '已清除')}${fact('处理时间', d().deleteResult.slice(0, 16).replace('T', ' '))}<p class="muted small">活动资料已清除；轨迹、备份和存储残留未认证擦除。</p>`) : notice('尚未发起删除', '发起删除后，这里会显示实际处理结果。')}${d().exportAt ? section('最近导出', fact('生成时间', d().exportAt) + '<p class="muted small">下载的文件由你自行保管。</p>') : ''}${button('返回首页', 'home', 'secondary')}`;
}
function progress(title, text) { return `<section class="progress-card" role="status"><div class="indeterminate"><span></span></div><h2>${escape(title)}</h2><p class="muted">${escape(text)}</p></section>`; }
function footer() {
  switch (route.view) {
    case 'review': return button('确认所选字段', 'confirm-review', '', checked.size&&capturedReview(activeRecord())&&!confirmBusy ? '' : 'disabled');
    case 'visit': return button('生成医生沟通卡', 'generate-card');
    case 'history': return button(`确认选择 · ${(d().selectedHistory || []).length} 条`, 'confirm-history');
    case 'reference': return button('继续生成沟通卡', 'generate-card');
    case 'transcript': return button('确认并保存', 'save-transcript');
    case 'correct': return button('确认更正', 'confirm-correction');
    case 'versions': return button('返回时间线', 'health-tab');
    case 'upload': return button('选择文件', 'choose-file');
    case 'medicalReview': return button('确认核对结果', 'confirm-medical', '', medicalChecked.size&&capturedReview(d().medical,true)&&!confirmBusy ? '' : 'disabled');
    case 'editCard': return button('保存草稿', 'save-card', 'secondary') + button('确认内容', 'confirm-card');
    case 'print': return button('系统分享 / 打印', 'share-card');
    case 'export': return button('生成导出文件', 'generate-export');
    case 'delete': return button('确认删除', 'confirm-delete', 'danger', deleteAcknowledged ? '' : 'disabled');
    default: return store.stale() ? button('核对并重新生成', 'regenerate-card') : button('编辑', 'edit-card', 'secondary') + button('分享 / 打印', 'print');
  }
}

function openSheet(kind, value = '') {
  sheetTrigger = document.activeElement;
  sheet = { kind, value };
  renderSheet();
}
function renderSheet() {
  if (!sheet) return;
  const { kind, value } = sheet;
  let title = '', html = '';
  const item = store.record(value);
  if (kind === 'source' || kind === 'record') {
    title = kind === 'source' ? '事实来源' : '记录详情';
    if (!item) html = notice('原始记录已不存在', '沟通卡保留了生成时的来源快照，请重新核对后生成。', 'warning');
    else html = `<p class="muted">${escape(item.source)} · 症状与事件日期</p>${section('用户原文', `<blockquote>“${escape(item.text)}”</blockquote>`)}${fact('记录时间', item.created)}${fact('事件日期', item.date || '未记录')}${fact('确认状态', `${item.status === 'confirmed' ? '已核对' : '待核对'} · v${item.version || 1}`)}${item.correction ? notice('用户已更正日期', `原因：${item.correction}。原文与旧版本保留。`) : ''}${kind === 'source' ? button('查看原始记录', 'sheet-record', 'secondary', `data-id="${escape(item.id)}"`) : button(item.record_kind==='visit_context'?'整理为记录':'核对这条记录', 'review', '', `data-id="${escape(item.id)}"`)}${button('更正事件日期', 'correct', 'secondary', `data-id="${escape(item.id)}"`)}`;
  } else if (kind === 'filters') {
    title = '筛选健康记录';
    html = `<label class="field"><span>问题</span><select name="filter-issue"><option value="all">全部问题</option>${[...new Set(d().records.map(r => r.issue))].map(v => `<option value="${escape(v)}" ${filters.issue === v ? 'selected' : ''}>${escape(v)}</option>`).join('')}</select></label><label class="field"><span>时间</span><select name="filter-time"><option value="all">全部时间</option><option value="recent" ${filters.time === 'recent' ? 'selected' : ''}>最近 7 天</option></select></label><label class="field"><span>确认状态</span><select name="filter-status">${[['all', '全部状态'], ['pending', '待核对'], ['confirmed', '已核对']].map(([key, label]) => `<option value="${key}" ${filters.status === key ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${button('应用筛选', 'apply-filters')}${button('清除筛选', 'clear-filters', 'secondary')}`;
  } else if (kind === 'deleteConversation') {
    title = '删除这段对话？';
    const chat = store.session(value);
    html = `<p>${escape(chat?.title || '这段对话')}</p><p>全部消息将从当前演示档案的对话记录中删除，无法恢复。已保存到健康时间线的记录会保留。</p>${d().cardConversationId === value ? '<p class="muted">引用这段对话的旧沟通卡会标记过期。</p>' : ''}${button('删除对话', 'confirm-delete-conversation', 'danger', `data-id="${escape(value)}"`)}${button('保留对话', 'close-sheet', 'secondary')}`;
  } else if(kind==='task') {
    title='事项详情';const task=d().tasks?.find(t=>t.id===selectedTask);html=task?`<h2>${escape(task.text)}</h2>${fact('原文时间',task.schedule)}${fact('状态',({pending:'待处理',done:'已完成',paused:'已暂停'})[task.status])}${fact('依赖',task.validity==='current'?'当前':'已过期')}<p class="muted small">完成事项不代表已康复。</p>${task.validity==='current'?button('标记完成','task-done','',`data-version="${task.version}"`)+button('暂停事项','task-pause','secondary',`data-version="${task.version}"`)+button('重新打开','task-resume','secondary',`data-version="${task.version}"`):notice('依赖已过期','请核对当前医嘱。')}`:notice('没有找到事项','请返回病历与事项。');
  } else if (kind === 'medicalSource') {
    title = '病历原文';
    html = `<p class="muted">${escape(d().medical?.name || '未记录')}</p>${section('', `<p>${lines(d().medical?.original || '原文未记录')}</p>`)}${fact('来源类型', '病历记载')}${fact('就诊日期', d().medical?.date)}${button('对照提取字段', 'medical-review', 'secondary')}`;
  } else if (kind === 'voiceConsent') {
    title = '开启语音输入';
    html = '<p>麦克风音频交给浏览器或系统语音服务转写，转写后可以校对。</p><p class="muted small">此应用不保存音频。具体处理方式取决于浏览器；可在设置中撤回授权。</p>' + button('同意并开始', 'allow-voice') + button('使用文字输入', 'close-sheet', 'secondary');
  } else if (kind === 'listening') {
    title = '正在聆听';
    html = `<div class="voice-visual"><div class="voice-wave" aria-hidden="true">${[18, 30, 45, 24, 52, 34, 22, 43, 30, 17].map((height, i) => `<span style="--bar:${height}px;--delay:${i * -80}ms"></span>`).join('')}</div></div><p id="live-transcript" class="muted">${escape(voiceText || '说完后点完成，下一步可校对文字。')}</p>${button('完成并校对', 'finish-voice')}${button('取消录音', 'cancel-voice', 'secondary')}`;
  } else if (kind === 'deleteConfirm') {
    title = '最后确认删除';
    html = `<p>将清除网页端与手机端共享的本地健康资料、完整对话、病历和沟通卡。</p><p class="muted">此操作不能撤销。导出的文件不会被清除。</p>${button('删除本地资料', 'delete-local', 'danger')}${button('保留资料', 'close-sheet', 'secondary')}`;
  } else if (kind === 'share') {
    title = '分享与打印';
    html = `${button('系统分享', 'system-share', '', navigator.share ? '' : 'disabled')}${button('浏览器打印', 'system-print', 'secondary')}${button('复制内容', 'copy-card', 'secondary')}<p class="muted small">分享与打印使用当前卡片的生成版本。</p>`;
  } else if (kind === 'safety') {
    title = '先获取线下帮助';
    html = notice('停止普通就诊准备', '当前描述需要及时联系线下医疗机构或当地急救服务。', 'warning') + button('返回对话', 'close-sheet', 'secondary');
  }
  overlays.innerHTML = `<dialog class="sheet-dialog" aria-labelledby="sheet-title"><div class="sheet-handle" aria-hidden="true"></div><div class="sheet-heading"><h2 id="sheet-title">${escape(title)}</h2>${iconButton('close', 'close-sheet', kind === 'listening' ? '取消录音并关闭' : '关闭弹层')}</div><div class="sheet-content">${html}</div></dialog>`;
  const dialog = overlays.querySelector('dialog');
  dialog.showModal();
  dialog.addEventListener('cancel', event => { event.preventDefault(); closeSheet(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) { const rect = dialog.getBoundingClientRect(); if (event.clientY < rect.top || event.clientX < rect.left || event.clientX > rect.right) closeSheet(); } });
}
function closeSheet(restore = true) {
  if (sheet?.kind === 'listening' && voice) { voiceCancelled = true; voice.abort(); voice = null; }
  overlays.querySelector('dialog')?.close();
  overlays.innerHTML = '';
  sheet = null;
  if (restore && sheetTrigger?.isConnected) sheetTrigger.focus({ preventScroll: true });
}

function scrollChat() {
  requestAnimationFrame(() => { const body = document.querySelector('.screen-body'); if (body) body.scrollTo({ top: body.scrollHeight, behavior: reduceMotion() ? 'auto' : 'smooth' }); });
}
async function sendChat(retry = false) {
  if (busySession) return;
  const question = (retry ? activeChat()?.failedQuestion : drafts.ask).trim();
  if (!question) return notify('先输入想问的问题。');
  if (!d().consent.organize) { openSheet('source', ''); go('settings', 'consent'); return notify('请先授权健康记录整理。'); }
  const current = store.ensureSession(question, route.view === 'chat' ? route.id : null);
  if (retry) current.messages = current.messages.filter(m => !m.error);
  else current.messages.push({ role: 'user', text: question });
  current.updatedAt = new Date().toISOString();
  drafts.ask = '';
  busySession = current.id;
  const request = ++requestSequence;
  save();
  go('home', 'chat', current.id, route.view === 'chat');
  scrollChat();
  try {
    const response = await askAssistant(question, { messages: current.messages.map(({ role, text,source_id }) => ({ role, text,source_id })), records: d().records });
    const stillPresent = store.session(current.id);
    if (request !== requestSequence || !stillPresent) return;
    const userMessage=[...stillPresent.messages].reverse().find(m=>m.role==='user');if(userMessage)userMessage.source_id=response.source_id;
    appendAssistantReply(d().sessions,current.id,{text:response.answer,action:response.action,demo:response.demo,run_id:response.run_id,runtime:response.runtime,execution_error:response.execution_error});
  } catch (error) {
    const stillPresent = store.session(current.id);
    if (request !== requestSequence || !stillPresent) return;
    stillPresent.failedQuestion = question;
    stillPresent.messages.push({ role: 'assistant', text: error.name === 'TimeoutError' ? '回复超时，原话已保留。' : error.message||'回复失败，原话已保留。可以重试。', error: true });
  } finally {
    if (request === requestSequence) {
      busySession = null;
      save(); render();
      if (route.view === 'chat' && route.id === current.id) scrollChat();
      else notify('对话已更新。');
    }
  }
}
async function saveRecord(text = drafts.record,existingSourceId=null) {
  if(busySession)return;
  text=text.trim();if(!text)return notify('先填写身体感受。');
  if(!d().consent.organize){go('settings','consent');return notify('请先授权健康记录整理。');}
  const session=activeChat();const continuing=!existingSourceId&&session?.record_thread_id&&!['confirmed','partially_confirmed'].includes(session.record_status);
  const confirmation=isRecordConfirmation(text),review=session?.messages.findLast(m=>m.record_review)?.record_review;
  if(confirmation&&!continuing)return notify('请先查看待确认的模型汇总；已确认记录不需要重复提交。');
  native.client.setDraft('record',text);busySession=session?.id||'record';render();
  try{
    if(confirmation){await native.confirmRecord(session.record_thread_id,text,review);store.reload();}
    else{
      const receipt=await native.recordTurn(text,continuing?session.record_thread_id:null,continuing?session.record_version:undefined,existingSourceId);store.reload();d().activeSessionId=receipt.record_thread_id;save();go('home','chat',receipt.record_thread_id,route.view==='chat');
      if(drafts.record.trim()===text)drafts.record='';if(drafts.ask.trim()===text)drafts.ask='';drafts.transcript='';native.client.clearDraftIf('record',text);
      await native.wait(receipt.run_id);store.reload();
    }
    if(drafts.record.trim()===text)drafts.record='';if(drafts.ask.trim()===text)drafts.ask='';native.client.clearDraftIf('record',text);
  }catch(error){store.reload();notify(error.code==='REVISION_CONFLICT'?'记录或核对版本已变化，输入已保留。请阅读最新汇总后再提交。':error.message||'模型整理未完成，原文仍然保留。');}
  finally{busySession=null;render();scrollChat();}
}
function submitMessage(){const session=activeChat(),text=drafts[inputMode];return inputMode==='record'||session?.record_thread_id&&(!['confirmed','partially_confirmed'].includes(session.record_status)||isRecordConfirmation(text))?saveRecord(text):sendChat();}
async function analyzeRecord(item) {
  if(!item)return;const job=++jobSequence;jobController?.abort();jobController=new AbortController();
  try{if(!item.run_id)throw new Error('请读取已保存记录的运行状态。');await native.wait(item.run_id,{signal:jobController.signal});if(job!==jobSequence)return;store.reload();openReview(item.id);render();}
  catch(error){if(job!==jobSequence)return;store.reload();render();notify(error.message||'分析未完成，已保存原文仍保留。');}
}
function prepare(value) {
  const chat = store.session(value || route.id || d().activeSessionId);
  const last = [...(chat?.messages || [])].reverse().find(m => m.role === 'user')?.text || d().currentConcern;
  store.prepareVisit(chat?.id);
  go('home', 'visit');
}
function startVoice() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return notify('当前浏览器不支持语音转写，请输入文字。');
  if (!d().consent.voice) return openSheet('voiceConsent');
  voiceCancelled = false;
  voiceText = '';
  const recognition = new Recognition();
  voice = recognition;
  recognition.lang = 'zh-CN';
  recognition.interimResults = true;
  recognition.continuous = false;
  recognition.onresult = event => {
    if (voiceCancelled) return;
    voiceText = Array.from(event.results).map(r => r[0]?.transcript || '').join(' ').trim();
    document.getElementById('live-transcript')?.replaceChildren(document.createTextNode(voiceText));
  };
  recognition.onerror = event => {
    voiceCancelled = true;
    const messages = { 'not-allowed': '麦克风权限未开启，请在浏览器中允许后重试。', 'no-speech': '没有听到语音，请重试或输入文字。', network: '语音服务暂时不可用，请输入文字。' };
    closeSheet(); notify(messages[event.error] || '转写失败，请输入文字或重试。');
  };
  recognition.onend = () => {
    if (voice === recognition) voice = null;
    if (voiceCancelled) return;
    closeSheet(false);
    if (!voiceText) return notify('没有收到转写文字，请重试。');
    drafts.transcript = voiceText;
    go('home', 'transcript');
  };
  try { recognition.start(); openSheet('listening'); }
  catch { voice = null; closeSheet(); notify('无法启动语音转写，请输入文字。'); }
}
async function onFile(event) {
  const chosen = event.target.files?.[0];
  if (!chosen) return;
  if (chosen.size > (native.client.state.capabilities?.limits?.upload_bytes||5000000)) return notify('文件超过 10 MB，请选择较小文件或粘贴文字。');
  if (!/\.(pdf|txt)$/i.test(chosen.name)) return notify('请选择 TXT 或 PDF 文件。');
  file = chosen;
  if (!d().consent.parse) { render(); return notify('请先在设置中授权病历解析。'); }
  if (/\.txt$/i.test(file.name)) { drafts.medicalText = await file.text(); render(); return notify('已读取文字，请点击解析并核对。'); }
  if (window.HEALTHTHREAD_PARSE_URL) return parseMedical(null, chosen);
  d().uploadedName = file.name;
  d().uploadState = 'failed';
  d().uploadError = '尚未接入 PDF 解析服务。可以粘贴可复制的病历文字，或使用模拟资料。';
  save(); render();
}
async function parseMedical(original,selectedFile=null,demo=false) {
  if(!d().consent.parse){go('settings','consent');return notify('请先授权病历解析。');}
  const job=++jobSequence;jobController?.abort();jobController=new AbortController();
  try{const receipt=await native.createDocument(selectedFile?{file:selectedFile}:{text:original,name:demo?'合成医嘱示例':file?.name||'粘贴的病历文字'});store.reload();go('timeline','parsing');await native.wait(receipt.run_id,{signal:jobController.signal});if(job!==jobSequence)return;store.reload();await openReview(d().medical?.source_id,false,true);}
  catch(error){if(job!==jobSequence)return;store.reload();go('timeline','upload');notify(error.message||'解析未完成；已接收的原文仍保留。');}
}
function cardText(){return native.copyText();}
async function copyCard() {
  if (!store.cardExists()) return notify('还没有沟通卡。');
  try { await navigator.clipboard.writeText(cardText()); notify('沟通卡已复制。'); }
  catch { openSheet('share'); notify('无法读取剪贴板权限，可以使用分享或打印。'); }
}
async function action(name, el) {
  const value = el.dataset.id;
  switch (name) {
    case 'nav': return go(el.dataset.page);
    case 'nav-card': return go('card');
    case 'home': return go('home');
    case 'back': return back();
    case 'return-parent': return go(route.page, route.page === 'timeline' && ['upload', 'medicalReview', 'parsing'].includes(route.view) ? 'medical' : '');
    case 'new-chat': d().activeSessionId = null; drafts.ask = ''; inputMode = 'ask'; save(); return go('home', 'chat');
    case 'mode-ask': case 'mode-record': inputMode = name === 'mode-ask' ? 'ask' : 'record'; render(); return document.querySelector('#message-input')?.focus();
    case 'logout': return native.client.logout();
    case 'send': return submitMessage();
    case 'retry-chat': return sendChat(true);
    case 'suggest': inputMode = 'ask'; drafts.ask = '饭后总腹胀，偶尔反酸，去医院前该准备什么？'; return sendChat();
    case 'message-visit': case 'prepare': return prepare(value);
    case 'message-timeline': case 'health-tab': return go('timeline');
    case 'message-home': case 'record-change': d().activeSessionId=null;save();inputMode='record';return go('home','chat');
    case 'conversations': return go('home', 'conversations');
    case 'clear-search': conversationQuery = ''; render(); return document.querySelector('[name="search"]')?.focus();
    case 'conversation': return go('home', 'conversation', value);
    case 'continue-chat': inputMode = 'ask'; d().activeSessionId = value; save(); go('home', 'chat', value); return scrollChat();
    case 'delete-conversation': return openSheet('deleteConversation', value);
    case 'confirm-delete-conversation': {
      if (busySession === value) { ++requestSequence; busySession = null; }
      store.removeConversation(value);
      closeSheet(false); go('home', 'conversations', '', true); return notify('对话已删除，健康记录仍保留。');
    }
    case 'source': return openSheet('source', value || 'r1');
    case 'record-detail': case 'sheet-record': return openSheet('record', value);
    case 'close-sheet': return closeSheet();
    case 'filters': return openSheet('filters');
    case 'apply-filters': for (const key of ['issue', 'time', 'status']) filters[key] = overlays.querySelector(`[name="filter-${key}"]`).value; closeSheet(); return render();
    case 'clear-filters': filters.issue = filters.status = filters.time = 'all'; closeSheet(); return render();
    case 'review': return openReview(value);
    case 'recover-original': await native.recover(file);store.reload();render();return notify('原请求已恢复，没有重复创建资料。');
    case 'retry-analysis': {const item=activeRecord();if(!item)return;const receipt=await native.retryEntry(item.id);store.reload();go('home','analysis',item.id);await native.wait(receipt.run_id);store.reload();return openReview(item.id);}
    case 'confirm-review': return confirmReview();
    case 'refresh-review': return openReview(route.id,true);
    case 'refresh-medical': return openReview(d().medical?.source_id,true,true);
    case 'convert-record': {const item=activeRecord();if(item)return saveRecord(item.text,item.id);return;}
    case 'correct': { const item = store.record(value) || activeRecord(); if (!item) return; drafts.editDate = item.date || ''; drafts.editReason = ''; return go('timeline', 'correct', item.id); }
    case 'confirm-correction': {
      const item=activeRecord();if(!item)return;if(!drafts.editDate||!drafts.editReason?.trim())return notify('请填写更正日期和原因。');const receipt=await native.correct(item.id,drafts.editDate,drafts.editReason.trim());store.reload();await openReview(receipt.source_id);return notify('更正原文已保存，请核对新候选后提交。');
    }
    case 'versions': return go('timeline', 'versions');
    case 'history': return go('home', 'history');
    case 'remove-history': d().selectedHistory = d().selectedHistory.filter(v => v !== value); save(); return render();
    case 'confirm-history': return go('home', 'visit');
    case 'reference': return go('home', 'reference');
    case 'generate-card': {if(!d().currentConcern?.trim())return notify('请先填写当前困扰。');save();await requestAgent('/api/visit-preparations',{current_concern:d().currentConcern,selected_record_ids:d().selectedHistory});store.reload();return go('card');}
    case 'regenerate-card': return prepare(d().visitSessionId);
    case 'edit-card': drafts.speech = store.speech(); drafts.questions = d().questions.join('\n'); return go('card', 'editCard');
    case 'save-card': case 'confirm-card': d().cardEdit={result_id:d().cardResultId,speech:(drafts.speech||'').trim(),questions:(drafts.questions||'').split('\n').filter(Boolean)};save();store.reload();go('card');return notify('用户编辑草稿已保存，正式事实未改变。');
    case 'print': return go('card', 'print');
    case 'share-card': return openSheet('share');
    case 'system-print': closeSheet(); return window.print();
    case 'system-share': try { await navigator.share({ title: '医生沟通卡 · HealthThread', text: cardText() }); closeSheet(); } catch (error) { if (error.name !== 'AbortError') notify('分享未完成，可以复制或打印。'); } return;
    case 'copy-card': return copyCard();
    case 'medical-tab': return go('timeline', 'medical');
    case 'upload': return go('timeline', 'upload');
    case 'choose-file': if (!d().consent.parse) { go('settings', 'consent'); return notify('请先授权病历解析。'); } return document.getElementById('medical-file')?.click();
    case 'sample-file': return parseMedical(store.MEDICAL_TEXT, null, true);
    case 'parse-text': return parseMedical(drafts.medicalText);
    case 'cancel-job': jobController?.abort(); ++jobSequence; if (d().medical) d().uploadState = 'ready'; save(); return go('timeline', 'medical');
    case 'medical-review': if(value){d().selectedDocumentId=value;save();store.reload();}return openReview(d().medical?.source_id,false,true);
    case 'medical-source': return openSheet('medicalSource');
    case 'confirm-medical': return confirmReview(true);
    case 'task': selectedTask=value||d().tasks?.[0]?.id;return openSheet('task',selectedTask);
    case 'task-done': case 'task-pause': case 'task-resume': await native.updateTask(selectedTask,({ 'task-done':'done','task-pause':'paused','task-resume':'pending'})[name],Number(el.dataset.version));store.reload();closeSheet();render();return notify('事项执行状态已更新。');
    case 'task-filter': filters.task = el.dataset.value; return render();
    case 'voice': return startVoice();
    case 'allow-voice': d().voiceConsent=true;d().consent.voice=true;save(); closeSheet(); return startVoice();
    case 'finish-voice': return voice?.stop();
    case 'cancel-voice': return closeSheet();
    case 'save-transcript': return saveRecord(drafts.transcript);
    case 'consent': return go('settings', 'consent');
    case 'export': return go('settings', 'export');
    case 'generate-export': if(!exportRanges.size)return notify('先选择导出范围。');exportFile=JSON.stringify(await native.client.exportData(),null,2);d().exportAt=new Date().toISOString();save();return go('settings','exportResult');
    case 'download-export': {
      if (!exportFile) exportFile = JSON.stringify(store.exportPayload(exportRanges), null, 2);
      const url = URL.createObjectURL(new Blob([exportFile], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = `HealthThread-${store.day()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); return notify('下载已交给浏览器，请查看下载列表。');
    }
    case 'delete': deleteAcknowledged = false; return go('settings', 'delete');
    case 'confirm-delete': if (deleteAcknowledged) return openSheet('deleteConfirm'); return;
    case 'delete-local': {if(!deleteAcknowledged)return;await native.deleteAll();store.reload();file=null;exportFile=null;for(const key of Object.keys(drafts))delete drafts[key];drafts.ask=drafts.record=drafts.transcript='';checked.clear();medicalChecked.clear();deleteAcknowledged=false;closeSheet(false);go('settings','result','',true);return notify('活动资料已删除；轨迹、备份和残留未认证擦除，结果为partial。');}
    case 'result': return go('settings', 'result');
  }
}

document.addEventListener('click', event => {
  const el = event.target.closest('[data-action]');
  if (!el || el.disabled) return;
  Promise.resolve(action(el.dataset.action, el)).catch(error => { console.error(error); notify(error.message||'操作未完成，请重试。'); });
});
document.addEventListener('submit', event => {
  if (event.target.id === 'composer') { event.preventDefault(); Promise.resolve(action('send', event.target)).catch(error => notify(error.message||'发送未完成，请恢复原请求。')); }
});
document.addEventListener('input', event => {
  const el = event.target;
  if (el.name === 'message') drafts[inputMode] = el.value;
  else if (el.name === 'search') { conversationQuery = el.value; render(); }
  else if (['currentConcern', 'impact', 'visitStartDate'].includes(el.name)) { d()[el.name] = el.value; save(); }
  else if (['reviewDescription', 'reviewDate', 'editDate', 'editReason', 'speech', 'questions', 'transcript', 'medicalText'].includes(el.name)) drafts[el.name] = el.value;
});
document.addEventListener('change', event => {
  const el = event.target;
  const toggle = set => el.checked ? set.add(el.value) : set.delete(el.value);
  if (el.name === 'review-field') { toggle(checked); render(); }
  if (el.name === 'history-field') { const values = new Set(d().selectedHistory); toggle(values); d().selectedHistory = [...values]; save(); render(); }
  if (el.name === 'medical-field') { toggle(medicalChecked); render(); }
  if (el.name === 'medical-choice') medicalChoice = el.value;
  if (el.name === 'export-range') { toggle(exportRanges); render(); }
  if (el.name === 'delete-ack') { deleteAcknowledged = el.checked; render(); }
  if (el.name === 'consent') {
    if(el.value==='voice'){d().voiceConsent=el.checked;save();}else native.setConsent(el.checked).then(()=>{store.reload();render();}).catch(error=>notify(error.message));
    if (el.value === 'voice' && !el.checked && voice) closeSheet();
    notify(el.checked ? '授权已开启。' : '授权已撤回，停止新的处理请求。');
  }
  if (el.name === 'reduceMotion') { store.setPreference('reduceMotion', el.checked); render(); }
});
document.addEventListener('keydown', event => {
  if (event.target.id === 'message-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); action('send', event.target); }
});
window.addEventListener('popstate', () => { closeSheet(false); route = parseRoute(); render(true); });
window.addEventListener('hashchange', () => { const next = parseRoute(); if (routeKey(next) !== routeKey(route)) { closeSheet(false); route = next; render(true); } });
window.addEventListener('storage', event => { if ([store.KEY, store.PREFS_KEY].includes(event.key)) { store.reload(); render(); if (sheet) renderSheet(); } });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => render());
if (window.visualViewport) {
  const setHeight = () => { document.documentElement.style.setProperty('--viewport-height', window.visualViewport.height + 'px'); document.documentElement.classList.toggle('keyboard-open', window.innerHeight - window.visualViewport.height > 140); };
  window.visualViewport.addEventListener('resize', setHeight); setHeight();
}
history.replaceState(history.state, '', location.hash || '#home');
render();

window.addEventListener('healththread:state', () => { store.reload(); render(); });

window.addEventListener('healththread:sync',event=>notify(event.detail.message||'同步未完成，请恢复原请求。'));
