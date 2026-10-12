import { requestAgent } from '../../../packages/client/api.js';
import { createEmptyState, flushData } from '../../../packages/client/data.js';
import { NAV, INITIAL, loadData, saveData, resetData } from '../../../packages/client/data.js';
import { askAssistant } from '../../../packages/client/chat.js';

const app = document.getElementById('app');
let data = loadData();
let page = 'home';
let subview = '';
let returnPage = 'home';
let selectedRecord = 'r2';
let selectedMedicalSource = false;
let selectedChatSource = false;
let timelineFilter = 'all';
let timelineTime = 'all';
let timelineIssue = 'all';
let timelineTab = 'health';
let taskFilter = 'all';
let selectedSessionId = data.sessions[0]?.id || null;
let conversationQuery = '';
let pendingSessionDeletion = null;
let deletionReturnFocus = '';
let viewStack = [];
let chatRequestId = 0;
let chatRequestSessionId = null;
let recordDraft = '';
let chatDraft = '';
let inputMode = 'ask';
let voiceRecognition = null;
let voiceListening = false;
let editDate = data.symptomStart;
let editReason = '';
let reviewDescription = '饭后腹胀 · 偶有反酸';
let selectedForReview = new Set();
let chatBusy = false;
let notice = '';
let mobileMenu = false;
let deleteAcknowledged = false;
let fileInput;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const attr = esc;
const fmt = value => value ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}年${Number(m)}月${Number(d)}日`) : '未记录';
const routeTitle = () => NAV.find(x => x.id === page)?.label || '首页';
const record = id => data.records.find(x => x.id === id);
const latestRecord = () => data.records[0];
const hasPending = () => data.records.some(x => x.status === 'pending');
const isCardStale = () => data.cardSourceDeleted || data.cardVersion < data.factVersion;
const dateText = () => `${Number(data.symptomStart.slice(5, 7))}月${Number(data.symptomStart.slice(8, 10))}日`;
const activeSession = () => data.sessions.find(s => s.id === data.activeSessionId);
const sortedSessions = () => [...data.sessions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
const sessionDate = session => {
  const d = new Date(session.updatedAt);
  return d.toDateString() === new Date().toDateString() ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`;
};
const sessionTime = session => new Date(session.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const pendingCount = () => data.records.filter(r => r.status === 'pending').reduce((n, r) => n + 2 - (r.confirmedFields?.length || 0), 0);
const status = (kind, label) => `<span class="status status-${kind}">${esc(label)}</span>`;
const button = (label, act, variant = 'secondary', extra = '') => {
  const classes = extra.match(/class="([^"]*)"/)?.[1] || '';
  return `<button class="btn btn-${variant} ${classes}" type="button" data-act="${act}" ${extra.replace(/class="[^"]*"/, '')}>${esc(label)}</button>`;
};
const source = (label = '用户自述', id = 'r1') => `<button class="source-link" type="button" data-act="source" data-id="${attr(id)}">${esc(label)} · 查看来源</button>`;
const panel = (title, content, className = '') => `<section class="panel ${className}"><h2>${esc(title)}</h2>${content}</section>`;
const row = (label, value, action = '') => `<div class="info-row"><span>${esc(label)}</span><strong>${esc(value)}</strong>${action}</div>`;
const field = (label, id, value, type = 'text', extra = '') => `<label class="field"><span>${esc(label)}</span><input id="${id}" data-field="${id}" type="${type}" value="${attr(value)}" ${extra}/></label>`;
const hint = text => `<p class="hint">${esc(text)}</p>`;
const actionHeader = (title, actions = '') => `<div class="page-head"><h1>${esc(title)}</h1><div class="head-actions">${actions}</div></div>`;

function shell(content) {
  const nav = NAV.map(item => `<button class="nav-item ${page === item.id ? 'active' : ''}" type="button" data-act="nav" data-page="${item.id}" ${page === item.id ? 'aria-current="page"' : ''}><img src="./assets/${item.icon}" alt=""/><span>${item.label}</span></button>`).join('');
  return `<div class="app-shell">
    <aside class="sidebar ${mobileMenu ? 'is-open' : ''}" aria-label="主导航"><div class="brand"><img src="./assets/healththread-logo.svg" alt="HealthThread" width="176" height="121"/></div><nav>${nav}</nav></aside>
    <div class="main-shell"><header class="topbar"><button class="menu-toggle" data-act="toggle-menu" aria-label="打开菜单" type="button" aria-expanded="${mobileMenu}">☰</button><strong>${routeTitle()}</strong><div class="top-tools"><span class="search-mark" aria-hidden="true">⌕</span><span class="tool-divider"></span><span>林悦 ⌄</span></div></header><main id="main-content">${content}</main></div>
    ${mobileMenu ? '<button class="mobile-scrim" type="button" data-act="toggle-menu" aria-label="关闭菜单"></button>' : ''}
    ${sessionDeletionDialog()}
    ${notice ? `<div class="toast" role="status">${esc(notice)}</div>` : ''}
  </div>`;
}

function render() {
  const previousNavPage = app.querySelector('.nav-item.active')?.dataset.page;
  const core = { home: homePage, timeline: timelineTab === 'medical' ? recordsPage : timelinePage, card: cardPage, settings: settingsPage }[page]?.() || '';
  app.innerHTML = shell(subview ? renderSubview(core) : core);
  if (previousNavPage && previousNavPage !== page) app.querySelector('.nav-item.active')?.classList.add('is-entering');
  fileInput = document.getElementById('file-input');
  if (fileInput) fileInput.addEventListener('change', onFileChange);
  document.title = `${subview ? subviewTitle() + ' · ' : ''}${routeTitle()} · HealthThread`;
  const dialog = document.getElementById('delete-session-dialog');
  if (dialog) { dialog.showModal(); dialog.querySelector('[data-act="cancel-session-deletion"]')?.focus(); }
}

function open(pageName, secondary = '') {
  if (pageName === 'visit') { pageName = 'home'; secondary = 'visit'; }
  if (pageName === 'records') { pageName = 'timeline'; timelineTab = 'medical'; }
  if (pageName) page = pageName;
  subview = secondary;
  viewStack = [];
  mobileMenu = false;
  pushRoute();
  render();
  window.scrollTo(0, 0);
}
function routeHash() { return `#${page}${subview ? '/' + subview : page === 'timeline' && timelineTab === 'medical' ? '/medical' : ''}`; }
function pushRoute() { if (location.hash !== routeHash()) history.pushState(null, '', routeHash()); }
function readRoute() {
  const [host, step] = location.hash.slice(1).split('/');
  page = NAV.some(n => n.id === host) ? host : 'home';
  returnPage = page;
  subview = step && step !== 'medical' && SUBTITLES[step] ? step : '';
  timelineTab = host === 'timeline' && step === 'medical' ? 'medical' : 'health';
  viewStack = [];
}
function openSubview(name, host = page) {
  viewStack.push({ page, subview, scroll: window.scrollY });
  returnPage = page;
  page = host;
  subview = name;
  mobileMenu = false;
  pushRoute(); render(); window.scrollTo(0, 0);
}
function closeSubview() {
  const previous = viewStack.pop();
  subview = previous?.subview || '';
  page = previous?.page || returnPage;
  pushRoute(); render(); window.scrollTo(0, previous?.scroll || 0);
}
function flash(message) { notice = message; render(); clearTimeout(flash.timer); flash.timer = setTimeout(() => { notice = ''; render(); }, 3200); }
function persist() { saveData(data); render(); }

function chatMessages() {
  const messages = activeSession()?.messages || [];
  if (!messages.length) return `<div class="chat-empty"><h2>今天想聊点什么？</h2><p>描述不适、整理记录，或准备就诊。</p><div class="suggestions">${[['描述不适并准备就诊', '饭后总腹胀，偶尔反酸，去医院前该准备什么？'], ['整理最近记录', '帮我整理最近的身体记录。'], ['还要补充什么？', '还需要补充哪些信息？']].map(([label, question]) => `<button type="button" data-act="suggest" data-question="${attr(question)}">${label}</button>`).join('')}</div></div>`;
  return `<div class="chat-thread" id="chat-thread" aria-live="polite">${messages.map(item => `<div class="chat-bubble ${item.role === 'user' ? 'from-user' : 'from-assistant'}">${item.role === 'assistant' ? '<strong>HealthThread</strong>' : ''}<p>${esc(item.text).replaceAll('\n', '<br>')}</p>${item.error ? button('重试回复', 'retry-chat') : item.action ? button(item.action === 'visit' ? '查看就诊准备' : item.action === 'timeline' ? '查看时间线' : item.action === 'review' ? '核对这条记录' : '继续记录', item.action === 'review' ? 'review' : `go-${item.action}`, 'secondary', item.recordId ? `data-id="${attr(item.recordId)}"` : '') : ''}</div>`).join('')}${chatBusy ? '<div class="chat-bubble from-assistant"><span class="loading-dot"></span>正在整理回复…</div>' : ''}</div>`;
}
function homePage() {
  const recent = sortedSessions().slice(0, 3).map((s, i) => `<button class="recent-conversation" type="button" data-act="conversation" data-id="${attr(s.id)}"><span>${sessionDate(s)} · ${esc(s.title)}</span><span class="${i === 0 ? 'warning-text' : 'green-text'}">${s.messages.length} 条消息 · ${i === 0 ? '继续查看' : '已保存'}</span></button>`).join('');
  const isRecord = inputMode === 'record';
  const voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const voiceLabel = voiceListening ? '停止语音输入' : voiceSupported ? '开始语音输入' : '当前浏览器不支持语音输入';
  return `<div class="content home-content" data-node-id="4:63"><h1>你好，林悦</h1><div class="home-grid"><section class="chat-panel panel"><div class="chat-top"><h2>AI 健康助手</h2>${button('新对话', 'new-chat', 'quiet', activeSession() ? '' : 'disabled')}</div>${chatMessages()}<div class="composer-wrap"><form id="chat-form" class="chat-composer"><div class="composer-modes" role="group" aria-label="输入用途"><button type="button" class="composer-mode ${isRecord ? '' : 'active'}" data-act="mode-ask" aria-pressed="${!isRecord}">向助手提问</button><button type="button" class="composer-mode ${isRecord ? 'active' : ''}" data-act="mode-record" aria-pressed="${isRecord}">记录身体感受</button></div><label for="chat-input" class="sr-only">${isRecord ? '记录身体感受' : '向 AI 健康助手提问'}</label><textarea id="chat-input" rows="1" placeholder="${isRecord ? '例如：饭后有点腹胀…' : activeSession() ? '还需要补充哪些信息？' : '就诊前，我应该准备哪些资料？'}">${esc(isRecord ? recordDraft : chatDraft)}</textarea><div class="composer-bottom"><span class="composer-help">${voiceListening ? '正在听，请说话…' : isRecord ? '保存后可核对记录' : 'Enter 发送 · Shift + Enter 换行'}</span><div class="composer-actions"><button type="button" class="mic-button ${voiceListening ? 'is-listening' : ''}" data-act="voice" aria-label="${voiceLabel}" title="${voiceLabel}" aria-pressed="${voiceListening}" ${voiceSupported ? '' : 'disabled'}><img src="./assets/b8836.svg" alt="" width="22" height="22"/></button>${button(isRecord ? '保存记录' : chatBusy ? '回复中…' : '发送 ↑', isRecord ? 'save-record' : 'send-chat', 'primary', chatBusy ? 'disabled' : '')}</div></div></form><p class="chat-note">回答供参考；记录保存后需要你核对。</p></div></section><div class="home-rail">${panel('对话记录', (recent || hint('还没有对话。')) + button('查看全部对话', 'conversations', 'secondary', data.sessions.length ? 'class="full-width"' : 'class="full-width" disabled'), 'recent-panel')}<section class="panel pending-panel"><div class="between"><h2>待核对</h2><span class="small warning-text">${pendingCount()} 项</span></div><p class="small muted">${hasPending() ? '开始时间、症状描述' : '当前没有待核对事项'}</p>${button('去核对', 'review', 'primary', hasPending() ? '' : 'disabled')}</section></div></div></div>`;
}

function conversationPage() {
  const sessions = sortedSessions();
  const query = conversationQuery.trim().toLocaleLowerCase();
  const filtered = sessions.filter(s => !query || [s.title, ...s.messages.map(m => m.text)].join('\n').toLocaleLowerCase().includes(query));
  const selected = filtered.find(s => s.id === selectedSessionId) || filtered[0];
  const emptyTitle = sessions.length ? '没有找到相关对话' : '还没有对话';
  const emptyAction = sessions.length ? button('清除搜索', 'clear-conversation-search') : button('开始新对话', 'start-conversation', 'primary');
  return `<div class="content conversation-content">
    ${actionHeader('对话记录', button('返回首页', 'go-home'))}
    <div class="conversation-grid">
      <section class="panel conversation-list" aria-label="会话列表">
        <div class="conversation-list-title"><h2>全部对话</h2><span class="conversation-count">${sessions.length}</span></div>
        <label class="conversation-search"><span class="sr-only">搜索对话</span><img src="./assets/search.svg" alt="" width="20" height="20"/><input id="conversation-search" type="search" value="${attr(conversationQuery)}" placeholder="搜索标题或聊天内容"/></label>
        <p class="conversation-list-meta" role="status">${query ? `${filtered.length} 条搜索结果` : '最近更新'}</p>
        <div class="session-list">${filtered.map(s => `<div class="session-choice ${selected?.id === s.id ? 'selected' : ''}"><button class="session-open" type="button" data-act="select-session" data-id="${attr(s.id)}" aria-pressed="${selected?.id === s.id}" title="${attr(s.title)}"><strong>${esc(s.title)}</strong><span>${sessionDate(s)} ${sessionTime(s)} · ${s.messages.length} 条消息</span></button><button id="delete-session-${attr(s.id)}" class="session-delete" type="button" data-act="delete-session" data-id="${attr(s.id)}" aria-label="删除对话：${attr(s.title)}，${sessionDate(s)} ${sessionTime(s)}" title="删除对话"><img src="./assets/trash.svg" alt="" width="18" height="18"/></button></div>`).join('') || `<p class="conversation-list-empty">${emptyTitle}</p>`}</div>
      </section>
      <section class="panel conversation-detail" aria-label="完整聊天记录">${selected ? `
        <div class="conversation-detail-heading"><div><h2>${esc(selected.title)}</h2><p>${sessionDate(selected)} ${sessionTime(selected)} · ${selected.messages.length} 条消息</p></div><button id="delete-current-session" class="delete-conversation-button" type="button" data-act="delete-session" data-id="${attr(selected.id)}"><img src="./assets/trash.svg" alt="" width="18" height="18"/><span>删除对话</span></button></div>
        <div class="history-transcript">${selected.messages.map(m => `<div class="history-message ${m.role === 'user' ? 'from-user' : 'from-assistant'}"><strong>${m.role === 'user' ? '我' : '健康助手'}</strong><p>${esc(m.text).replaceAll('\n', '<br>')}</p></div>`).join('')}</div>
        <div class="button-row">${button('继续对话', 'continue-session', 'primary', `data-id="${attr(selected.id)}"`)}${selected.messages.some(m => m.action === 'visit') ? button('查看就诊准备', 'session-visit', 'secondary', `data-id="${attr(selected.id)}"`) : ''}</div>` : `
        <div class="conversation-empty"><div class="conversation-empty-symbol"><img src="./assets/conversation.svg" alt="" width="32" height="32"/></div><h2>${emptyTitle}</h2><p>${sessions.length ? '试试其他关键词，或清除搜索查看全部对话。' : '聊聊最近的身体感受，之后可以在这里继续。'}</p>${emptyAction}</div>`}
      </section>
    </div>
  </div>`;
}

function sessionDeletionDialog() {
  const session = data.sessions.find(s => s.id === pendingSessionDeletion);
  if (!session) return '';
  return `<dialog id="delete-session-dialog" class="confirmation-dialog" aria-labelledby="delete-session-title" aria-describedby="delete-session-description"><h2 id="delete-session-title">删除这条对话？</h2><div class="deletion-session-summary"><strong>${esc(session.title)}</strong><span>${sessionDate(session)} ${sessionTime(session)} · ${session.messages.length} 条消息</span></div><p id="delete-session-description">聊天消息将从当前演示档案删除，无法恢复。已保存到健康时间线的记录会保留。${data.cardConversationId === session.id ? '引用这条对话的沟通卡会标记过期。' : ''}</p><div class="button-row">${button('取消', 'cancel-session-deletion')}${button('确认删除', 'confirm-session-deletion', 'danger')}</div></dialog>`;
}

function cancelSessionDeletion() {
  pendingSessionDeletion = null;
  render();
  document.getElementById(deletionReturnFocus)?.focus();
}

function deleteConversation() {
  const targetId = pendingSessionDeletion;
  const sessions = sortedSessions();
  const index = sessions.findIndex(s => s.id === targetId);
  if (index < 0) return cancelSessionDeletion();
  const remaining = sessions.filter(s => s.id !== targetId);
  data.sessions = data.sessions.filter(s => s.id !== targetId);
  if (data.activeSessionId === targetId) { data.activeSessionId = null; chatDraft = ''; recordDraft = ''; }
  if (chatRequestSessionId === targetId) { chatRequestId += 1; chatBusy = false; chatRequestSessionId = null; }
  if (data.cardConversationId === targetId) data.cardSourceDeleted = true;
  if (data.visitSessionId === targetId) data.visitSessionId = null;
  if (selectedSessionId === targetId) selectedSessionId = remaining[Math.min(index, remaining.length - 1)]?.id || null;
  pendingSessionDeletion = null;
  saveData(data);
  flash('对话已删除。');
  (document.querySelector('.session-choice.selected .session-open') || document.querySelector('[data-act="start-conversation"]'))?.focus();
}

function timelineTabs() {
  return `<div class="page-tabs" role="tablist" aria-label="时间线内容"><button role="tab" type="button" class="${timelineTab === 'health' ? 'active' : ''}" aria-selected="${timelineTab === 'health'}" data-act="timeline-health">健康记录</button><button role="tab" type="button" class="${timelineTab === 'medical' ? 'active' : ''}" aria-selected="${timelineTab === 'medical'}" data-act="timeline-medical">病历与诊后事项</button></div>`;
}
function timelinePage() {
  const issues = [...new Set(data.records.map(r => r.issue || '胃部不适'))];
  const items = data.records.filter(r => (timelineFilter === 'all' || r.status === timelineFilter) && (timelineIssue === 'all' || (r.issue || '胃部不适') === timelineIssue) && (timelineTime === 'all' || new Date(r.date) >= new Date(Date.now() - 7 * 86400000)));
  const cards = items.map((r, i) => `<article class="panel fact-panel">${i === 0 ? `<h2>${esc(r.issue || '胃部不适')} · ${items.length} 条记录</h2>` : ''}<div class="fact-date"><h2>${esc(fmt(r.date))}</h2>${r.status === 'confirmed' ? status('confirmed', '已核对') : ''}</div><p>${esc(r.summary || r.text)}</p><div class="card-actions">${r.status === 'confirmed' ? button(r.source + ' · 来源', 'source', 'quiet', `data-id="${attr(r.id)}"`) + button('更正日期', 'correct', 'secondary', `data-id="${attr(r.id)}"`) + button('版本与冲突', 'conflict') : status('pending', '待核对') + button('查看记录', 'record', 'secondary', `data-id="${attr(r.id)}"`) + button('核对事实', 'review', 'secondary', `data-id="${attr(r.id)}"`)}</div></article>`).join('');
  return `<div class="content timeline-content" data-node-id="4:93">${actionHeader('健康时间线', button('病历与事项', 'timeline-medical', 'primary'))}${timelineTabs()}<div class="filter-row"><label><span class="sr-only">问题</span><select id="timeline-issue" aria-label="问题筛选"><option value="all">${issues.length === 1 ? esc(issues[0]) : '全部问题'}</option>${issues.length > 1 ? issues.map(issue => `<option value="${attr(issue)}" ${timelineIssue === issue ? 'selected' : ''}>${esc(issue)}</option>`).join('') : ''}</select></label><label><span class="sr-only">时间</span><select id="timeline-time" aria-label="时间筛选"><option value="all">全部时间</option><option value="week" ${timelineTime === 'week' ? 'selected' : ''}>最近 7 天</option></select></label><label><span class="sr-only">确认状态</span><select id="timeline-filter" aria-label="确认状态"><option value="all" ${timelineFilter === 'all' ? 'selected' : ''}>全部状态</option><option value="confirmed" ${timelineFilter === 'confirmed' ? 'selected' : ''}>已核对</option><option value="pending" ${timelineFilter === 'pending' ? 'selected' : ''}>待核对 ${pendingCount()}</option></select></label></div>${cards || panel('暂无记录', '<p class="muted">没有符合筛选条件的记录。</p>' + button('记录新变化', 'record-new-change'))}</div>`;
}

function visitPage() {
  const selected = data.selectedHistory.map(record).filter(Boolean);
  return `<div class="content visit-content" data-node-id="4:123">${actionHeader('就诊准备', button('返回首页', 'go-home'))}<div class="conversation-context">本次描述：${esc(data.currentConcern || '未记录')} · 来自首页对话，待你核对</div><div class="columns visit-columns"><div class="stack">${panel('当前困扰', `<label class="field"><span>本次描述</span><textarea data-field="currentConcern" rows="3">${esc(data.currentConcern)}</textarea></label>${row('开始时间', data.visitHasRelevantHistory === false ? '未记录' : data.symptomStart || '未记录')}${row('最近变化', data.visitHasRelevantHistory === false ? '未记录' : data.recentChange || '未记录')}`)}${panel('相关历史', `<div class="selected-history">${selected.map(r => `<div class="selected-history-line"><span>${esc(fmt(r.date))}　${esc(r.summary || r.text)}</span><button type="button" class="remove-history" data-act="remove-history" data-id="${attr(r.id)}" aria-label="移除 ${esc(fmt(r.date))} 记录">×</button></div>`).join('') || hint('尚未选择相关历史。')}</div>${button('选择历史', 'select-history', 'secondary')}`)}</div><div class="stack">${panel('待补充', `<label class="field"><span>对进食有影响吗？</span><select data-field="impact"><option value="" ${!data.impact ? 'selected' : ''}>暂不填写</option><option value="无明显影响" ${data.impact === '无明显影响' ? 'selected' : ''}>无明显影响</option><option value="有影响" ${data.impact === '有影响' ? 'selected' : ''}>有影响</option></select></label>`)}${panel('导医参考', `<p class="reference-status warning-text">待补充资料</p><p class="muted">既往检查 · 近期用药 · 体重变化</p>${button('查看参考范围', 'reference', 'secondary')}`)}${button('生成沟通卡', 'generate-card', 'primary', 'class="full-width"')}</div></div></div>`;
}

function generatedCardText() {
  if (data.cardDraft) return data.cardDraft;
  if (!data.cardConcern || data.cardConcern === '饭后腹胀，偶有反酸。') {
    const d = data.cardStartDate;
    const label = d ? `${Number(d.slice(5, 7))}月${Number(d.slice(8, 10))}日` : '开始时间未记录，';
    return `${label}开始饭后腹胀，偶有反酸。10月6日仍有不适，较前有所缓解。`;
  }
  return `本次描述：${data.cardConcern}\n开始时间：${data.cardStartDate || '未记录'}。`;
}
function cardPage() {
  if (!data.records.length) return `<div class="content">${actionHeader('医生沟通卡')}${panel('尚无沟通卡', `<p class="muted">先记录并核对健康信息，再准备就诊沟通卡。</p>${button('去记录', 'go-home', 'primary')}`)}</div>`;
  const stale = isCardStale();
  const cardSources = data.cardRecords || [];
  const unconfirmed = cardSources.some(r => r.status === 'pending') || !!data.cardConversationId || (!!data.cardStartDate && record('r1')?.status === 'pending');
  let sourceIndex = 0;
  const sourceButton = () => {
    const index = sourceIndex++;
    if (index === 0 && data.cardConversationId) return button('来源', 'chat-source');
    return button('来源', 'source', 'secondary', 'data-id="r1"' + ((index === 1 && !data.cardStartDate) || (index === 2 && !data.impact) ? ' disabled title="未记录"' : ''));
  };
  return `<div class="content card-content" data-node-id="4:153">${actionHeader('医生沟通卡', `${stale ? '' : button('编辑', 'edit-card')}${button('打印', 'print-preview')}${button('复制', 'copy-card')}`)}${stale ? `<div class="stale-banner">${status('stale', '内容已过期')}<span>${data.cardSourceDeleted ? '引用的对话已删除，请重新核对后生成。' : '开始时间已更正，重新生成后使用新值。'}</span>${button('重新生成', 'regenerate-card', 'primary')}</div>` : ''}<div class="columns card-columns"><div class="stack">${panel('一分钟表达稿', `<p class="speech">${esc(generatedCardText()).replaceAll('\n', '<br>')}</p>${status(stale ? 'stale' : unconfirmed ? 'pending' : 'confirmed', stale ? '已过期' : unconfirmed ? '包含待核对信息' : '已核对')}`)}${panel('本次情况', row('主要困扰', /胃|腹|反酸/.test(data.cardConcern || '') ? '胃部不适' : data.cardConcern || '未记录', sourceButton()) + row('开始时间', data.cardStartDate || '未记录', sourceButton()) + row('日常影响', data.impact || '待补充', sourceButton()))}${panel('想问医生', `<ol class="question-list">${data.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol>`)}</div><div class="stack">${panel('相关记录', cardSources.map(r => `<div class="card-history"><p>${esc(fmt(r.date))}<br>${esc(r.text)}</p>${button('查看来源', 'source', 'secondary', `data-id="${attr(r.id)}"`)}</div>`).join('') || hint('未选择相关记录。'))}${panel('未记录信息', '<p class="muted">用药情况　未记录<br>过敏情况　未记录</p>')}<p class="muted small">生成于 ${esc(data.cardGeneratedAt || '2026-10-08')} · v${data.cardVersion}</p></div></div></div>`;
}

function recordsPage() {
  const emptyAfterDelete = data.deleteResult && !data.uploadedName;
  const taskVisible = taskFilter === 'all' || taskFilter === data.taskStatus;
  return `<div class="content medical-content" data-node-id="4:183">${actionHeader('健康时间线', button('上传资料', 'upload', 'primary'))}${timelineTabs()}${panel('病历资料', `<div class="upload-summary"><span>上传病历 · 文字 / PDF</span>${button('选择文件', 'upload')}</div>${emptyAfterDelete ? hint('暂无病历资料。') : row(data.uploadedName || '模拟门诊记录.pdf', data.uploadState === 'reviewed' ? '2026-10-08 · 已核对' : '2026-10-08 · 待核对', button('核对差异', 'medical-review')) + (data.deleteResult ? '' : row('已核对资料.pdf', '2026-10-06 · 已核对', button('查看原文', 'medical-source')))}`)}${panel('诊后事项', emptyAfterDelete ? hint('暂无诊后事项。') + button('记录新变化', 'record-new-change') : `<div class="task-filters" role="group" aria-label="事项状态">${[['all', '全部'], ['pending', '待完成'], ['done', '已完成'], ['paused', '已暂停']].map(([id, label]) => `<button type="button" data-act="filter-task" data-status="${id}" class="${taskFilter === id ? 'active' : ''}" aria-pressed="${taskFilter === id}">${label}</button>`).join('')}</div>${taskVisible ? row('整理复诊记录', '10月15日前 · ' + ({ pending: '待完成', done: '已完成', paused: '已暂停' }[data.taskStatus]), button('查看事项', 'task')) : hint('当前状态下没有事项。')}${row('记录新变化', '有新的身体感受', button('去记录', 'record-new-change'))}`)}</div>`;
}

function settingsPage() {
  return `<div class="content settings-content" data-node-id="4:213">${actionHeader('设置与数据')}<div class="columns settings-columns"><div class="stack">${panel('授权管理', row('健康记录整理', data.consent.organize ? '已授权' : '已撤回', button('管理', 'consent')) + row('病历解析', data.consent.parse ? '已授权' : '已撤回', button('管理', 'consent')) + row('语音处理', data.consent.voice ? '已授权' : '未开启', button('管理', 'consent')))}${panel('数据处理', row('处理范围', '用户选择的记录', button('详情', 'consent')) + row('数据去向', window.HEALTHTHREAD_API_URL ? '项目配置的处理服务' : '当前演示档案演示数据', button('详情', 'consent')))}${panel('我的数据', row('导出资料', `最近导出：${data.exportAt ? fmt(data.exportAt).replace(/^\d+年/, '') : '未生成'}`, button('选择范围', 'export')) + row('删除数据', '选择后再次确认', button('删除', 'delete-confirm')))}</div><div class="stack">${panel('处理记录', `<p>导出资料 · ${data.exportAt ? '已完成' : '未发起'}</p>${button('查看导出', 'export')}<p class="${data.deleteResult ? 'green-text' : 'muted'}">删除数据 · ${data.deleteResult ? '已完成' : '未发起'}</p>${button('查看处理结果', 'delete-result')}`, 'processing-panel')}</div></div></div>`;
}

const SUBTITLES = {
  visit: '就诊准备', conversations: '对话记录',
  record: '记录详情', review: '提取结果核对', voice: '语音转写校对', source: '事实来源', correct: '更正事实', conflict: '版本与冲突对照', history: '选择相关历史', reference: '导医参考详情', editCard: '编辑沟通卡', print: '打印预览', upload: '上传与解析', medicalReview: '病历差异核对', task: '事项详情', consent: '授权管理', export: '数据导出', deleteConfirm: '删除数据', deleteResult: '删除处理结果',
};
function subviewTitle() { return SUBTITLES[subview] || ''; }
const back = () => button('返回' + routeTitle(), 'close-subview');
function renderSubview(core) {
  if (['record', 'source', 'task'].includes(subview)) return `<div class="under-drawer">${core}</div><button class="drawer-scrim" data-act="close-subview" type="button" aria-label="关闭详情"></button><aside class="detail-drawer" aria-label="${subviewTitle()}">${renderDrawer()}</aside>`;
  return `<div class="subview-content">${renderSubPage()}</div>`;
}
function renderDrawer() {
  const r = record(selectedRecord) || latestRecord();
  const header = `<div class="drawer-head"><h1>${subviewTitle()}</h1><button type="button" data-act="close-subview" aria-label="关闭详情">×</button></div>`;
  if (subview === 'source' && selectedChatSource) {
    const session = data.sessions.find(s => s.id === data.cardConversationId);
    if (!session && data.cardSourceDeleted) return header + `<div class="source-quote"><span>原对话已删除</span><p>这张沟通卡引用的聊天来源已不可查看。</p></div>${status('stale', '已过期')}${hint('请重新核对本次描述，再生成沟通卡。')}`;
    const original = session?.messages.find(m => m.role === 'user' && m.text === data.cardConcern);
    return header + `<div class="source-quote"><span>${original ? '用户原话' : '准备页编辑内容'}</span><p>“${esc(original?.text || data.cardConcern)}”</p></div>${row('来源类型', original ? '用户对话' : '用户编辑')}${row('对应会话', session?.title || '未记录')}${row('对应字段', '本次描述')}${status('pending', '待核对')}`;
  }
  if (subview === 'source' && selectedMedicalSource) return header + `<div class="source-quote"><span>模拟门诊记录 · 原文</span><p>“自述10月1日起饭后腹胀，偶有反酸。建议整理近期症状记录，复诊时携带。”</p></div>${row('来源类型', '病历记载')}${row('病历日期', '2026-10-08')}${row('对应字段', '开始时间、诊后事项')}${status(data.recordReviewed ? 'confirmed' : 'pending', data.recordReviewed ? '已核对' : '待核对')}<div class="drawer-actions">${button('查看病历差异', 'medical-review')}</div>`;
  if (subview === 'record') return header + `<div class="source-quote"><span>用户原文</span><p>“${esc(r?.text)}”</p></div>${row('来源类型', r?.source || '用户自述')}${row('记录时间', r?.created || '未记录')}${row('事件时间', r?.date || '未记录')}${row('分析状态', r?.status === 'confirmed' ? '已核对' : '分析完成 · 待核对')}${row('关联事实', '胃部不适')}${button('查看来源', 'source')}${r?.status === 'pending' ? button('前往核对', 'review', 'primary') : ''}`;
  if (subview === 'source') return header + `<div class="source-quote"><span>原始记录（节选）</span><p>“${esc(r?.text)}”</p></div>${row('来源类型', r?.correction ? '用户更正 · 原始自述保留' : r?.source || '用户自述')}${row('记录时间', r?.created || '未记录')}${row('事件时间', r?.date || '未记录')}${r?.correction ? row('更正原因', r.correction) : ''}${row('对应字段', '开始时间、症状')}${row('版本', 'v' + data.factVersion)}${status(r?.status === 'confirmed' ? 'confirmed' : 'pending', r?.status === 'confirmed' ? '已核对' : '待核对')}<div class="drawer-actions">${button('查看原始记录', 'record')}${button('更正事实', 'correct')}</div>`;
  return header + `<div class="source-quote"><span>原始医嘱</span><p>“整理近期症状记录，复诊时携带。”</p></div><h2>通俗解释</h2><p>把近期身体变化按时间整理，复诊时带给医生。</p>${row('来源', '已核对模拟病历')}${row('日期', '2026-10-08')}${row('状态', { pending: '待完成', done: '已完成', paused: '已暂停' }[data.taskStatus])}${hint('完成事项不等于已经康复。')}<div class="drawer-actions">${button('查看来源', 'medical-source')}${button('标为完成', 'task-done', 'primary')}${button('暂停事项', 'task-pause')}${button('记录新变化', 'record-new-change')}</div>`;
}

function renderSubPage() {
  const head = (title = subviewTitle(), extra = '') => actionHeader(title, extra || back());
  const two = (left, right, className = '') => `<div class="columns ${className}"><div class="stack">${left}</div><div class="stack">${right}</div></div>`;
  const reviewedRecord = record(selectedRecord) || latestRecord();
  switch (subview) {
    case 'visit': return visitPage();
    case 'conversations': return conversationPage();
    case 'review': return `<div class="content">${head()}<div class="steps">原文已保存 <span>→</span> 候选内容 <span>→</span> 等待核对</div>${two(panel('用户原文', `<blockquote>${esc(reviewedRecord?.text)}</blockquote>${hint('记录于 ' + (reviewedRecord?.created || '未记录'))}`), panel('候选事实', `<label class="check-row"><input type="checkbox" data-review="description" ${selectedForReview.has('description') ? 'checked' : ''}/><span>症状描述</span></label>${field('候选值', 'reviewDescription', reviewDescription)}<label class="check-row"><input type="checkbox" data-review="date" ${selectedForReview.has('date') ? 'checked' : ''}/><span>事件日期：${esc(reviewedRecord?.date || '未记录')}</span></label>${row('用药情况', '未记录')}${row('过敏情况', '未记录')}${hint('当前为演示候选，未记录内容不更新画像。')}<div class="button-row">${button('确认已选字段', 'confirm-review', 'primary', selectedForReview.size ? '' : 'disabled')}${button('暂后处理', 'close-subview')}</div>`), 'review-columns')}</div>`;
    case 'voice': return `<div class="content narrow-content">${head()}${panel('转写文本', `<p class="muted">请核对时间、数字、药名与否定词。</p><label class="field"><span>可编辑文本</span><textarea id="voice-text" rows="6">${esc(recordDraft)}</textarea></label><div class="button-row">${button('确认并保存', 'save-voice', 'primary')}${button('返回修改', 'close-subview')}</div>`)}</div>`;
    case 'correct': return `<div class="content narrow-content">${head()}${panel('开始时间', `${row('当前值', data.symptomStart)}${field('更正为', 'editDate', editDate, 'date')}<label class="field"><span>修改原因</span><textarea data-field="editReason" rows="3">${esc(editReason)}</textarea></label><div class="soft-warning">影响：时间线生成新版本；引用旧版本的沟通卡将标记过期。</div><div class="button-row">${button('确认更正', 'submit-correction', 'primary')}${button('取消', 'close-subview')}</div>`)}</div>`;
    case 'conflict': return `<div class="content">${head()}${two(panel('当前版本 · v' + data.factVersion, `${status('confirmed', '已核对')}${row('开始时间', data.symptomStart)}${hint('来源：用户自述')}${button('查看来源', 'source')}`), panel('新候选 · 待提交', `${status('pending', '待核对')}${row('开始时间', '2026-10-01')}${hint('来源：模拟门诊记录')}${button('查看病历', 'medical-review')}`))}<div class="button-row">${button('保留当前版本', 'close-subview')}${button('修改后确认', 'correct', 'primary')}${button('暂不处理', 'close-subview', 'text')}</div></div>`;
    case 'history': return `<div class="content">${head()}${panel('胃部不适', data.records.map(r => `<label class="check-row history-choice"><input type="checkbox" data-history="${r.id}" ${data.selectedHistory.includes(r.id) ? 'checked' : ''}/><span><strong>${esc(fmt(r.date))}</strong><br>${esc(r.text)}</span></label>`).join('') + `<div class="between">${hint(`已选择 ${data.selectedHistory.length} 条`)}${button('确认选择', 'close-subview', 'primary')}</div>`)}</div>`;
    case 'reference': return `<div class="content">${head()}${two(panel('胃部不适', `<div class="soft-warning"><strong>当前资料不足</strong><p>可先补充近期用药、既往检查与体重变化。</p></div><h3>参考依据</h3><p>本次描述：${esc(data.currentConcern)}</p><p>相关历史：${data.selectedHistory.length} 条用户自述。</p>${button('查看事实来源', 'source')}`), panel('适用范围', `<p>用于整理就诊准备信息，不提供诊断或用药结论。</p>${hint('若出现紧急不适，应及时就医。')}${button('继续生成沟通卡', 'generate-card', 'primary')}`))}</div>`;
    case 'editCard': return `<div class="content">${head()}${panel('表达稿与问题', `<label class="field"><span>一分钟表达稿</span><textarea id="card-draft" rows="6">${esc(generatedCardText())}</textarea></label><label class="field"><span>想问医生</span><textarea id="card-questions" rows="4">${esc(data.questions.join('\n'))}</textarea></label><div class="button-row">${button('保存草稿', 'save-card')}${button('确认内容', 'save-card', 'primary')}</div>`)}${panel('固定事实与来源', `${row('开始时间', data.symptomStart, source('用户自述'))}${hint('用药与过敏情况：未记录')}`)}</div>`;
    case 'print': return `<div class="content print-screen">${head('打印预览', button('浏览器打印', 'print', 'primary'))}<article class="print-sheet"><h1>医生沟通卡</h1><p>林悦 · 生成于 2026-10-08 · 版本 v${data.cardVersion}${isCardStale() ? ' · 已过期' : ''}</p><h2>一分钟表达稿</h2><p>${esc(generatedCardText())}</p><h2>本次情况</h2><p>主要困扰：胃部不适<br>开始时间：${esc(data.cardStartDate || '未记录')}<br>用药情况：未记录 · 过敏情况：未记录</p><h2>想问医生</h2><ol>${data.questions.map(q => `<li>${esc(q)}</li>`).join('')}</ol><footer>来源：用户自述；未核对字段请在就诊时说明。</footer></article></div>`;
    case 'upload': return `<div class="content">${head()}<div class="steps">选择文件 <span>→</span> 上传 <span>→</span> 解析 <span>→</span> 核对</div>${panel('选择资料', `<p>文字 / 可复制文本的 PDF · 模拟资料</p><input id="file-input" class="sr-only" type="file" accept=".txt,.pdf,text/plain,application/pdf"/>${button('选择文件', 'choose-file')}${button('使用模拟病历', 'sample-file', 'primary')}<p class="small muted">选择真实文件后仅显示文件名；不会上传到服务器。</p>`)}${panel(data.uploadedName || '模拟门诊记录.pdf', `${row('上传状态', data.uploadState === 'empty' ? '未选择' : '原件保留在本机')}${row('解析状态', { empty: '等待文件', selected: '待解析', failed: '无法识别 · 可重试', parsed: '解析完成 · 待核对', reviewed: '已核对' }[data.uploadState])}${hint('核对后才更新画像。')}${button('查看模拟差异', 'medical-review', 'primary')}`)}</div>`;
    case 'medicalReview': {
      const conflict = data.symptomStart !== '2026-10-01';
      return `<div class="content">${head()}${two(panel('模拟门诊记录 · 原文', `<div class="document-text">就诊日期：2026-10-08<br><br>自述10月1日起饭后腹胀，偶有反酸。<br><br>建议：整理近期症状记录，复诊时携带。<br><br>用药：未记载。</div>`), panel('提取字段', `<h3 class="${conflict ? 'warning-text' : 'green-text'}">${conflict ? '有冲突' : '一致'} · 开始时间</h3>${row('当前', data.symptomStart)}${row('病历候选', '2026-10-01')}${conflict ? `<div class="button-row">${button('处理日期冲突', 'conflict')}${button(data.medicalConflictChoice === 'keep' ? '已选择保留当前日期' : '保留当前日期', 'keep-medical-date', data.medicalConflictChoice === 'keep' ? 'quiet' : 'secondary')}</div>` : ''}<h3>新增 · 诊后事项</h3><p>整理近期症状记录，复诊时携带。</p>${hint('无法识别 / 未记载：用药情况')}${button('确认核对结果', 'confirm-medical', 'primary', conflict && data.medicalConflictChoice !== 'keep' ? 'disabled' : '')}`), 'review-columns')}</div>`;
    }
    case 'consent': return `<div class="content narrow-content">${head()}${panel('授权管理', `${[['organize', '健康记录整理', '选中的记录原文与候选字段'], ['parse', '病历解析', '选择上传的病历资料'], ['voice', '语音处理', '转写校对所需音频']].map(([key, label, content]) => `<div class="consent-row"><div><strong>${label}</strong><p class="muted small">用途：${content} · 去向：${key === 'voice' ? '浏览器语音服务（处理方式取决于浏览器）' : '项目配置的处理服务'}</p></div><label class="switch"><input type="checkbox" data-consent="${key}" ${data.consent[key] ? 'checked' : ''}/><span class="sr-only">${label}授权</span></label></div>`).join('')}${hint('撤回后停止新的处理请求；已保存内容可在数据设置中管理。')}`)}</div>`;
    case 'export': return `<div class="content narrow-content">${head()}${panel('导出范围', `<p>健康记录与来源 · 已确认事实与版本 · 沟通卡与诊后事项</p>${hint('旧沟通卡会标出生成版本和过期状态。')}${button('生成并下载 JSON', 'download-export', 'primary')}`)}${panel('最近导出', row('资料包', data.exportAt || '未生成'))}</div>`;
    case 'deleteConfirm': return `<div class="content narrow-content">${head()}${panel('确认删除范围', `<p>健康记录 · 候选事实 · 沟通卡 · 病历元数据 · 诊后事项</p><p class="danger-text">删除后无法通过本演示恢复。</p><label class="check-row"><input type="checkbox" id="delete-ack" ${deleteAcknowledged ? 'checked' : ''}/><span>我已了解删除范围</span></label><div class="button-row">${button('确认删除本地演示数据', 'delete-local', 'danger', deleteAcknowledged ? '' : 'disabled')}${button('保留数据', 'close-subview')}</div>${hint('只删除当前演示档案的演示数据；此原型没有服务器副本。')}`)}</div>`;
    case 'deleteResult': return `<div class="content narrow-content">${head()}${panel('处理结果', `${data.deleteResult ? status('confirmed', '已完成') : status('pending', '未发起')}${row('当前演示档案演示数据', data.deleteResult || '尚未发起删除')}${hint('此原型没有云端存储或备份任务。')}`)}</div>`;
    default: return '';
  }
}

function ensureSession(text) {
  let session = activeSession();
  if (!session) {
    session = { id: 'c-' + crypto.randomUUID(), title: /胃|腹|反酸/.test(text) ? '胃部不适与就诊准备' : text.slice(0, 24), updatedAt: new Date().toISOString(), messages: [] };
    data.sessions.unshift(session);
    data.activeSessionId = session.id;
  }
  return session;
}
function prepareVisit(session = activeSession()) {
  data.visitSessionId = session?.id || null;
  const described = [...(session?.messages || [])].reverse().find(m => m.role === 'user' && /不舒服|不适|痛|胀|反酸|发热|头晕|咳/.test(m.text));
  if (described) {
    data.currentConcern = described.text;
    data.visitHasRelevantHistory = /胃|腹|反酸/.test(described.text);
    if (!data.visitHasRelevantHistory) { data.selectedHistory = []; data.impact = ''; }
  }
  saveData(data);
  open('home', 'visit');
}
async function sendChat(retry = false) {
  if (chatBusy) return;
  const question = (retry ? activeSession()?.failedQuestion : document.getElementById('chat-input')?.value || chatDraft)?.trim();
  if (!question) return flash('先输入想问的问题。');
  if (!data.consent.organize) return flash('请先在设置中授权健康记录整理。');
  const session = ensureSession(question);
  if (retry) session.messages = session.messages.filter(m => !m.error);
  else session.messages.push({ role: 'user', text: question });
  session.updatedAt = new Date().toISOString();
  const requestId = ++chatRequestId;
  chatRequestSessionId = session.id;
  chatDraft = '';
  chatBusy = true;
  persist();
  try {
    const reply = await askAssistant(question, { messages: session.messages.map(m => ({ role: m.role, text: m.text })), records: data.records });
    if (requestId !== chatRequestId || !data.sessions.some(s => s.id === session.id)) return;
    session.messages.push({ role: 'assistant', text: reply.answer, action: reply.action, demo: reply.demo });
    delete session.failedQuestion;
  } catch (error) {
    if (requestId !== chatRequestId || !data.sessions.some(s => s.id === session.id)) return;
    session.failedQuestion = question;
    session.messages.push({ role: 'assistant', text: error.name === 'TimeoutError' ? '回复超时，原话已保留。可以重试。' : error.message || '回复失败。原话已保留，请重试。', error: true });
  } finally {
    if (requestId === chatRequestId) {
      chatBusy = false;
      chatRequestSessionId = null;
      persist();
      document.getElementById('chat-thread')?.scrollTo({ top: 99999, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }
}

function submitHomeInput() {
  if (inputMode === 'record') return saveRecord(document.getElementById('chat-input')?.value || recordDraft);
  return sendChat();
}

function startVoiceInput() {
  if (voiceListening) return voiceRecognition?.stop();
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) return flash('当前浏览器不支持语音输入，请使用文字输入。');
  if (!data.consent.voice) {
    openSubview('consent', 'settings');
    return flash('请先开启语音处理授权。');
  }
  const mode = inputMode;
  const recognition = new Recognition();
  let receivedText = false;
  voiceRecognition = recognition;
  recognition.lang = 'zh-CN';
  recognition.interimResults = false;
  recognition.continuous = false;
  recognition.onstart = () => { voiceListening = true; render(); };
  recognition.onresult = event => {
    const transcript = Array.from(event.results).map(result => result[0]?.transcript || '').join(' ').trim();
    if (!transcript) return;
    receivedText = true;
    if (mode === 'record') recordDraft = [recordDraft, transcript].filter(Boolean).join(' ');
    else chatDraft = [chatDraft, transcript].filter(Boolean).join(' ');
  };
  recognition.onerror = event => {
    receivedText = false;
    const messages = { 'not-allowed': '麦克风权限未开启，请在浏览器中允许后重试。', 'no-speech': '没有听到语音，请重试或输入文字。', network: '语音服务暂时不可用，请输入文字。' };
    flash(messages[event.error] || '语音转写失败，请重试或输入文字。');
  };
  recognition.onend = () => {
    voiceListening = false;
    voiceRecognition = null;
    if (receivedText && page === 'home' && !subview && mode === 'record') return openSubview('voice');
    render();
  };
  try { recognition.start(); }
  catch { voiceRecognition = null; flash('无法启动语音输入，请重试或输入文字。'); }
}

async function saveRecord(value) {
  const text = value.trim();
  if (!text) return flash('先填写身体感受。');
  if (!data.consent.organize) return flash('请先在设置中授权健康记录整理。');
  const stamp = new Date();
  const date = `${stamp.getFullYear()}-${String(stamp.getMonth() + 1).padStart(2, '0')}-${String(stamp.getDate()).padStart(2, '0')}`;
  data.records.unshift({ id: 'r' + stamp.getTime(), created: date + ' ' + stamp.toTimeString().slice(0, 5), date: null, text, status: 'pending', source: '用户自述', issue: /胃|腹|反酸/.test(text) ? '胃部不适' : '身体感受' });
  selectedRecord = data.records[0].id;
  const session = ensureSession(text);
  session.messages.push({ role: 'user', text, kind: 'record', recordId: selectedRecord }, { role: 'assistant', text: '原文已保存。请核对症状描述和事件日期。', action: 'review', recordId: selectedRecord });
  session.updatedAt = stamp.toISOString();
  reviewDescription = text;
  recordDraft = '';
  selectedForReview = new Set();
  saveData(data);
  notice = '原文已保存，等待你核对提取内容。';
  openSubview('review');
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => { notice = ''; render(); }, 3400);
  try {
    const result = await requestAgent('/api/health-record', { text });
    const target = record(selectedRecord);
    if (target && target.text === text) {
      target.candidate = { description: result.description, date: result.date };
      target.date = result.date; reviewDescription = result.description;
      saveData(data); render();
    }
  } catch (error) { flash(error.message || '候选提取失败，原文已保留。'); }
}

function onFileChange(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  data.uploadedName = file.name;
  data.uploadState = 'failed';
  persist();
  flash('文件保留在本机。当前演示只支持模拟病历解析。');
}

async function doAction(act, el) {
  switch (act) {
    case 'toggle-menu': mobileMenu = !mobileMenu; return render();
    case 'nav': return open(el.dataset.page);
    case 'go-home': return open('home');
    case 'go-timeline': return open('timeline');
    case 'go-visit': return prepareVisit();
    case 'timeline-health': timelineTab = 'health'; return open('timeline');
    case 'timeline-medical': timelineTab = 'medical'; return open('timeline');
    case 'filter-task': taskFilter = el.dataset.status; return render();
    case 'record-new-change': inputMode = 'record'; return open('home');
    case 'conversations': selectedSessionId = sortedSessions()[0]?.id || null; return openSubview('conversations', 'home');
    case 'conversation': selectedSessionId = el.dataset.id; return openSubview('conversations', 'home');
    case 'select-session': selectedSessionId = el.dataset.id; return render();
    case 'clear-conversation-search': conversationQuery = ''; render(); document.getElementById('conversation-search')?.focus(); return;
    case 'start-conversation': if (chatBusy) return flash('请等待当前回复完成。'); data.activeSessionId = null; chatDraft = ''; inputMode = 'ask'; saveData(data); return open('home');
    case 'delete-session': pendingSessionDeletion = el.dataset.id; deletionReturnFocus = el.id; return render();
    case 'cancel-session-deletion': return cancelSessionDeletion();
    case 'confirm-session-deletion': return deleteConversation();
    case 'continue-session': data.activeSessionId = el.dataset.id; inputMode = 'ask'; saveData(data); return open('home');
    case 'session-visit': return prepareVisit(data.sessions.find(s => s.id === el.dataset.id));
    case 'close-subview': return closeSubview();
    case 'suggest': inputMode = 'ask'; chatDraft = el.dataset.question; render(); return sendChat();
    case 'mode-ask': inputMode = 'ask'; render(); document.getElementById('chat-input')?.focus(); return;
    case 'mode-record': inputMode = 'record'; render(); document.getElementById('chat-input')?.focus(); return;
    case 'send-chat': return submitHomeInput();
    case 'new-chat': if (chatBusy) return; data.activeSessionId = null; chatDraft = ''; inputMode = 'ask'; return persist();
    case 'retry-chat': return sendChat(true);
    case 'save-record': return submitHomeInput();
    case 'voice': return startVoiceInput();
    case 'save-voice': return saveRecord(document.getElementById('voice-text')?.value || '');
    case 'record': selectedRecord = el.dataset.id || selectedRecord; return openSubview('record');
    case 'source': selectedChatSource = false; selectedMedicalSource = false; selectedRecord = el.dataset.id || selectedRecord; return openSubview('source');
    case 'chat-source': selectedChatSource = true; selectedMedicalSource = false; return openSubview('source');
    case 'review': {
      const target = record(el.dataset.id) || data.records.find(r => r.status === 'pending');
      if (!target) return flash('当前没有待核对记录。');
      selectedRecord = target.id;
      reviewDescription = target.summary || target.text;
      selectedForReview = new Set(target.confirmedFields || []);
      return openSubview('review');
    }
    case 'confirm-review': {
      if (!selectedForReview.size) return flash('请先选择要确认的字段。');
      const target = record(selectedRecord);
      if (target) {
        target.confirmedFields = [...new Set([...(target.confirmedFields || []), ...selectedForReview])];
        target.status = target.confirmedFields.length === 2 ? 'confirmed' : 'pending';
        if (selectedForReview.has('description')) target.summary = reviewDescription;
      }
      selectedForReview.clear();
      timelineTab = 'health'; saveData(data); open('timeline'); return flash('用户已确认所选事实。');
    }
    case 'correct': editDate = data.symptomStart; editReason = ''; return openSubview('correct');
    case 'submit-correction': {
      const newDate = document.getElementById('editDate')?.value || editDate;
      if (!newDate) return flash('请填写更正后的日期。');
      if (newDate === data.symptomStart) return flash('新日期与当前日期相同。');
      const previousDate = data.symptomStart;
      data.symptomStart = newDate;
      data.factVersion += 1;
      data.factHistory.push({ version: data.factVersion, oldValue: previousDate, newValue: newDate, reason: editReason || '用户更正', changedAt: new Date().toISOString() });
      const original = data.records.find(r => r.id === 'r1');
      if (original) { original.date = newDate; original.correction = document.querySelector('[data-field="editReason"]')?.value || '用户更正'; }
      saveData(data); open('timeline'); return flash('时间线已更新；旧沟通卡已标记过期。');
    }
    case 'conflict': return openSubview('conflict');
    case 'select-history': return openSubview('history');
    case 'remove-history': data.selectedHistory = data.selectedHistory.filter(id => id !== el.dataset.id); return persist();
    case 'reference': return openSubview('reference');
    case 'generate-card': case 'regenerate-card': {
      if (act === 'regenerate-card' && data.cardSourceDeleted) return open('home', 'visit');
      try {
        const result = await requestAgent('/api/visit-preparations', { current_concern: data.currentConcern, selected_record_ids: data.selectedHistory });
        data.cardSourceDeleted = false; data.cardVersion = data.factVersion; data.cardStartDate = data.visitHasRelevantHistory === false ? null : data.symptomStart;
        data.cardConcern = data.currentConcern; data.cardConversationId = data.visitSessionId || null; data.cardGeneratedAt = new Date().toISOString().slice(0, 10);
        data.cardRecords = data.selectedHistory.map(record).filter(Boolean).map(r => ({ id: r.id, date: r.date, text: r.summary || r.text, source: r.source, status: r.status }));
        data.cardDraft = result.speech; data.questions = result.questions; saveData(data); return open('card');
      } catch (error) { return flash(error.message || '沟通卡未生成，请重试。'); }
    }
    case 'edit-card': return openSubview('editCard');
    case 'save-card': data.cardDraft = document.getElementById('card-draft')?.value.trim() || ''; data.questions = (document.getElementById('card-questions')?.value || '').split('\n').map(x => x.trim()).filter(Boolean); saveData(data); open('card'); return flash('沟通卡内容已保存。');
    case 'copy-card': {
      const content = `医生沟通卡\n${generatedCardText()}\n\n想问医生：\n${data.questions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`;
      try { await navigator.clipboard.writeText(content); flash('已复制沟通卡。'); }
      catch { flash('无法访问剪贴板，可在打印预览中选取内容。'); }
      return;
    }
    case 'print-preview': return openSubview('print');
    case 'print': return window.print();
    case 'upload': return openSubview('upload');
    case 'choose-file': return document.getElementById('file-input')?.click();
    case 'sample-file': data.uploadedName = '模拟门诊记录.pdf'; data.uploadState = 'parsed'; return persist();
    case 'medical-review': return openSubview('medicalReview');
    case 'keep-medical-date': data.medicalConflictChoice = 'keep'; return persist();
    case 'medical-source': selectedChatSource = false; selectedMedicalSource = true; return openSubview('source');
    case 'confirm-medical': data.recordReviewed = true; data.uploadState = 'reviewed'; saveData(data); open('records'); return flash('病历差异已核对。');
    case 'task': return openSubview('task');
    case 'task-done': data.taskStatus = 'done'; saveData(data); closeSubview(); return flash('事项已标为完成。');
    case 'task-pause': data.taskStatus = 'paused'; saveData(data); closeSubview(); return flash('事项已暂停。');
    case 'consent': return openSubview('consent');
    case 'export': return openSubview('export');
    case 'download-export': {
      const payload = { exportedAt: new Date().toISOString(), version: 2, records: data.records, conversations: data.sessions, fact: { symptomStart: data.symptomStart, version: data.factVersion, history: data.factHistory }, communicationCard: { text: generatedCardText(), version: data.cardVersion, stale: isCardStale(), sources: data.cardRecords }, medical: { filename: data.uploadedName, status: data.uploadState }, taskStatus: data.taskStatus };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'HealthThread-demo-export.json'; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      data.exportAt = new Date().toISOString().slice(0, 10); saveData(data); return flash('导出文件已生成。');
    }
    case 'delete-confirm': deleteAcknowledged = false; return openSubview('deleteConfirm');
    case 'delete-result': return openSubview('deleteResult');
    case 'delete-local': {
      if (!deleteAcknowledged) return;
      resetData();
      chatRequestId += 1; chatBusy = false;
      data = createEmptyState();
      recordDraft = ''; chatDraft = ''; deleteAcknowledged = false;
      saveData(data); try { await flushData(); } catch (error) { return flash(error.message); } return openSubview('deleteResult');
    }
    default: return;
  }
}

app.addEventListener('click', event => {
  const target = event.target.closest('[data-act]');
  if (!target || target.disabled) return;
  doAction(target.dataset.act, target);
});
app.addEventListener('submit', event => {
  if (event.target.id === 'chat-form') { event.preventDefault(); submitHomeInput(); }
});
app.addEventListener('keydown', event => {
  if (event.key === 'Escape' && pendingSessionDeletion) { event.preventDefault(); cancelSessionDeletion(); return; }
  if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submitHomeInput(); }
  if (event.key === 'Escape' && subview) closeSubview();
});
app.addEventListener('cancel', event => {
  if (event.target.id === 'delete-session-dialog') { event.preventDefault(); cancelSessionDeletion(); }
}, true);
app.addEventListener('input', event => {
  if (event.target.id === 'conversation-search') {
    const position = event.target.selectionStart;
    conversationQuery = event.target.value;
    render();
    const search = document.getElementById('conversation-search');
    search?.focus();
    if (position !== null) { try { search?.setSelectionRange(position, position); } catch { /* search inputs do not expose selection ranges in every browser */ } }
  }
  if (event.target.id === 'chat-input') { if (inputMode === 'record') recordDraft = event.target.value; else chatDraft = event.target.value; }
  if (event.target.dataset.field === 'reviewDescription') reviewDescription = event.target.value;
  if (event.target.dataset.field === 'editDate') editDate = event.target.value;
  if (event.target.dataset.field === 'editReason') editReason = event.target.value;
  if (['currentConcern', 'recentChange', 'symptomStart'].includes(event.target.dataset.field)) { data[event.target.dataset.field] = event.target.value; saveData(data); }
});
app.addEventListener('change', event => {
  if (event.target.dataset.review) { event.target.checked ? selectedForReview.add(event.target.dataset.review) : selectedForReview.delete(event.target.dataset.review); render(); }
  if (event.target.dataset.history) { const id = event.target.dataset.history; data.selectedHistory = event.target.checked ? [...new Set([...data.selectedHistory, id])] : data.selectedHistory.filter(x => x !== id); persist(); }
  if (event.target.dataset.consent) { data.consent[event.target.dataset.consent] = event.target.checked; persist(); flash(event.target.checked ? '授权已开启。' : '授权已撤回。'); }
  if (event.target.dataset.field === 'impact') { data.impact = event.target.value; persist(); }
  if (event.target.id === 'timeline-filter') { timelineFilter = event.target.value; render(); }
  if (event.target.id === 'timeline-time') { timelineTime = event.target.value; render(); }
  if (event.target.id === 'timeline-issue') { timelineIssue = event.target.value; render(); }
  if (event.target.id === 'delete-ack') { deleteAcknowledged = event.target.checked; render(); }
});

window.addEventListener('popstate', () => { readRoute(); mobileMenu = false; render(); });
readRoute();
render();

window.addEventListener('healththread:state', () => { data = loadData(); render(); });
