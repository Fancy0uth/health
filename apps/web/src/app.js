import {recordRecoveryMarkup,documentForSource,sourceProvenanceLabel,documentSourceMarkup,captureDisclosureState,restoreDisclosureState,recordTimeLabel,recordStatusLabel,recordSaveMarkup,pendingReviewItems,careProgressMarkup,eventTimeText,documentStatusLabel,documentAnalysisMarkup,healthProfileMarkup,comparisonMarkup,selectedResolutions,reviewProposals,careTaskMarkup,careDetailsMarkup,profileCorrectionMarkup} from '../../../packages/client/health-profile.js';
import {isRecordConfirmation} from '../../../packages/client/record-dialogue.js';
import {assertionLabel,scopeLabel} from '../../../packages/client/presentation.js';
import {nativeBridge} from '../../../packages/client/native-bridge.js';
const native=nativeBridge();
const actionRetries=new Set();
const recoveryRetries=new Set();
let profileView='overview';
async function refreshHealthProfile(automatic){
  try{const receipt=await native.openHealthProfile({automatic});if(!receipt)return;data=loadData();render();if(receipt.run_id)await native.wait(receipt.run_id);}
  catch(error){if(error.code!=='SESSION_CHANGED')flash(error.message||'近况评估未完成，可查看最新状态后重试。');}
  finally{data=loadData();if(subview==='healthProfile')render();}
}
let medicalText='';
let medicalUploadBusy=false;
let profileEditor=null;
let profileSaveBusy=false;
let reviewChoices={};
const feedbackDrafts={};
const feedbackBusy=new Set();
const medicalRetries=new Set();
const careRetries=new Set();
let filePickerOpen=false;
function releaseFilePicker(){filePickerOpen=false;render();}

let cardErrorRunId=null;
import { createEmptyState, flushData } from '../../../packages/client/data.js';
import { NAV, INITIAL, loadData, saveData, resetData } from '../../../packages/client/data.js';
import { askAssistant, appendAssistantReply, executionLabel } from '../../../packages/client/chat.js';

const app = document.getElementById('app');
let data = loadData();
let page = 'home';
let subview = '';
let returnPage = 'home';
let selectedRecord = null;
let selectedTask = null;
let selectedUploadFile = null;
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
let recordDraft = native.client.getDraft('record','');
let chatDraft = '';
let inputMode = 'ask';
let voiceRecognition = null;
let voiceListening = false;
let editDate = data.symptomStart;
let editReason = '';
let editText = '';
let editFactId = '';
let editFactRevision = null;
let editBusy = false;
let cardEditor = null;
let cardBusy = false;
let cardSaveBusy = false;
let cardError = '';
let renderedContext = '';
let reviewDescription = '饭后腹胀 · 偶有反酸';
let selectedForReview = new Set();
let reviewSnapshot=null;
let reviewSourceId=null;
let reviewLoadingId=null;
let reviewRequestId=0;
let navigationRevision=0;
let confirmBusy=false;
const capturedReview=sourceId=>reviewSnapshot&&reviewSourceId===sourceId?reviewSnapshot:null;
let chatBusy = false;
let notice = '';
let mobileMenu = false;
let deleteAcknowledged = false;
let fileInput;

const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
const attr = esc;
const fmt = value => value ? value.replace(/^(\d{4})-(\d{2})-(\d{2})$/, (_, y, m, d) => `${y}年${Number(m)}月${Number(d)}日`) : '未记录';
const routeTitle = () => NAV.find(x => x.id === page)?.label || '首页';
const record = id => data.records.find(x => x.id === id||x.source_ids?.includes(id));
const latestRecord = () => data.records[0];
const hasPending = () => pendingCount()>0;
const isCardStale = () => !!data.cardSourceDeleted;
const dateText = () => `${Number(data.symptomStart.slice(5, 7))}月${Number(data.symptomStart.slice(8, 10))}日`;
const activeSession = () => data.sessions.find(s => s.id === data.activeSessionId);
const sortedSessions = () => [...data.sessions].sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
const sessionDate = session => {
  const d = new Date(session.updatedAt);
  return d.toDateString() === new Date().toDateString() ? '今天' : `${d.getMonth() + 1}月${d.getDate()}日`;
};
const sessionTime = session => new Date(session.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const pendingCount = (includeDocuments=true) => pendingReviewItems(data).filter(item=>includeDocuments||!item.medical).reduce((n,item)=>n+item.count,0);
const status = (kind, label) => `<span class="status status-${kind}">${esc(label)}</span>`;
const button = (label, act, variant = 'secondary', extra = '') => {
  const classes = extra.match(/class="([^"]*)"/)?.[1] || '';
  return `<button class="btn btn-${variant} ${classes}" type="button" data-act="${act}" ${extra.replace(/class="[^"]*"/, '')}>${esc(label)}</button>`;
};
const source = (label = '用户自述', id) => `<button class="source-link" type="button" data-act="source" data-id="${attr(id)}">${esc(label)} · 查看来源</button>`;
const panel = (title, content, className = '') => `<section class="panel ${className}"><h2>${esc(title)}</h2>${content}</section>`;
const row = (label, value, action = '') => `<div class="info-row"><span>${esc(label)}</span><strong>${esc(value)}</strong>${action}</div>`;
const field = (label, id, value, type = 'text', extra = '') => `<label class="field"><span>${esc(label)}</span><input id="${id}" data-field="${id}" type="${type}" value="${attr(value)}" ${extra}/></label>`;
const hint = text => `<p class="hint">${esc(text)}</p>`;
const actionHeader = (title, actions = '') => `<div class="page-head"><h1>${esc(title)}</h1><div class="head-actions">${actions}</div></div>`;

function shell(content) {
  const nav = NAV.map(item => `<button class="nav-item ${page === item.id ? 'active' : ''}" type="button" data-act="nav" data-page="${item.id}" ${page === item.id ? 'aria-current="page"' : ''}><img src="./assets/${item.icon}" alt=""/><span>${item.label}</span></button>`).join('');
  return `<div class="app-shell">
    <aside class="sidebar ${mobileMenu ? 'is-open' : ''}" aria-label="主导航"><div class="brand"><img src="./assets/healththread-logo.svg" alt="HealthThread" width="176" height="121"/></div><nav>${nav}</nav></aside>
    <div class="main-shell"><header class="topbar"><button class="menu-toggle" data-act="toggle-menu" aria-label="打开菜单" type="button" aria-expanded="${mobileMenu}">☰</button><strong>${subviewTitle()||routeTitle()}</strong><div class="top-tools"><span class="search-mark" aria-hidden="true">⌕</span><span class="tool-divider"></span><button class="btn btn-secondary" type="button" data-act="account">${esc(native.client.state.user?.username||'账号')} ⌄</button></div></header><main id="main-content">${content}</main></div>
    ${mobileMenu ? '<button class="mobile-scrim" type="button" data-act="toggle-menu" aria-label="关闭菜单"></button>' : ''}
    ${sessionDeletionDialog()}
    ${notice ? `<div class="toast" role="status">${esc(notice)}${native.client.pendingOperations().length?button('恢复原请求','recover-original'):''}</div>` : ''}
  </div>`;
}

function render() {
  if(filePickerOpen&&subview==='upload')return;
  if(subview!=='upload')filePickerOpen=false;
  const context = [page, subview, data.activeSessionId, selectedSessionId, selectedRecord].join(':');
  const sameView = context === renderedContext;
  if(!sameView&&subview==='healthProfile')Promise.resolve().then(()=>refreshHealthProfile(true));
  const disclosures=sameView?captureDisclosureState(app):new Set();
  const scrolls = sameView ? ['#chat-thread', '.history-transcript', '.session-list', '.detail-drawer'].map(selector => {
    const node = app.querySelector(selector);
    return {selector, top: node?.scrollTop || 0, bottom: node && node.scrollHeight - node.clientHeight - node.scrollTop < 48};
  }) : [];
  const windowScroll = {x: window.scrollX, y: window.scrollY};
  const active = document.activeElement;
  const focusId = sameView && app.contains(active) ? active?.id : '';
  const selection = focusId && typeof active.selectionStart === 'number' ? [active.selectionStart, active.selectionEnd] : null;
  const previousNavPage = app.querySelector('.nav-item.active')?.dataset.page;
  const core = { home: homePage, timeline: timelineTab === 'medical' ? recordsPage : timelinePage, card: cardPage, settings: settingsPage }[page]?.() || '';
  app.innerHTML = shell(subview ? renderSubview(core) : core);
  restoreDisclosureState(app,disclosures);
  for (const {selector, top, bottom} of scrolls) {
    const node = app.querySelector(selector);
    if (node) node.scrollTop = selector === '#chat-thread' && bottom ? node.scrollHeight : top;
  }
  if (sameView) window.scrollTo(windowScroll.x, windowScroll.y);
  if (focusId) {
    const target = document.getElementById(focusId);
    target?.focus({preventScroll:true});
    if (selection && target?.setSelectionRange) target.setSelectionRange(...selection);
  }
  renderedContext = context;
  if (previousNavPage && previousNavPage !== page) app.querySelector('.nav-item.active')?.classList.add('is-entering');
  fileInput = document.getElementById('file-input');
  if(fileInput){fileInput.addEventListener('change',onFileChange);fileInput.addEventListener('cancel',releaseFilePicker);}
  document.title = `${subview ? subviewTitle() + ' · ' : ''}${routeTitle()} · HealthThread`;
  const dialog = document.getElementById('delete-session-dialog');
  if (dialog) { dialog.showModal(); dialog.querySelector('[data-act="cancel-session-deletion"]')?.focus(); }
}

function open(pageName, secondary = '') {
  navigationRevision += 1;
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
function routeHash() { return `#${page}${subview ? '/' + subview : page === 'timeline' && timelineTab === 'medical' ? '/medical' : ''}${subview==='source'&&!selectedChatSource&&selectedRecord?'/'+encodeURIComponent(selectedRecord):''}`; }
function pushRoute() { if (location.hash !== routeHash()) history.pushState(null, '', routeHash()); }
function readRoute() {
  navigationRevision += 1;
  const [host, step, sourceId] = location.hash.slice(1).split('/');
  selectedChatSource=false;selectedMedicalSource=false;
  if(step==='source'){try{selectedRecord=sourceId?decodeURIComponent(sourceId):null;}catch{selectedRecord=null;}}
  page = NAV.some(n => n.id === host) ? host : 'home';
  returnPage = page;
  subview = step && step !== 'medical' && SUBTITLES[step] ? step : '';
  timelineTab = host === 'timeline' && step === 'medical' ? 'medical' : 'health';
  viewStack = [];
}
function openSubview(name, host = page) {
  navigationRevision += 1;
  viewStack.push({ page, subview, scroll: window.scrollY });
  returnPage = page;
  page = host;
  subview = name;
  mobileMenu = false;
  pushRoute(); render(); window.scrollTo(0, 0);
}
function closeSubview() {
  navigationRevision += 1;
  const previous = viewStack.pop();
  subview = previous?.subview || '';
  page = previous?.page || returnPage;
  pushRoute(); render(); window.scrollTo(0, previous?.scroll || 0);
}
function flash(message){notice=/Failed to fetch|NetworkError|Load failed/i.test(String(message))?'网络连接暂时中断，请稍后重试。':message;render();clearTimeout(flash.timer);if(!native.client.pendingOperations().length)flash.timer=setTimeout(()=>{notice='';render();},3200);}
function persist() { saveData(data); render(); }

function actionRetryMarkup(message){return [['chat_retry_run_id','重试回复'],['record_retry_run_id','重试整理记录'],['visit_retry_run_id','重试生成沟通卡']].filter(([field])=>message[field]).map(([field,label])=>button(actionRetries.has(message[field])?'重试中…':label,field==='chat_retry_run_id'?'retry-chat-run':'retry-chat-action','quiet',`data-id="${attr(message[field])}" ${actionRetries.has(message[field])?'disabled':''}`)).join('');}
function chatMessages() {
  const messages = activeSession()?.messages || [];
  if (!messages.length) return `<div class="chat-empty"><h2>今天想聊点什么？</h2><p>描述不适、整理记录，或准备就诊。</p><div class="suggestions">${[['描述不适并准备就诊', '饭后总腹胀，偶尔反酸，去医院前该准备什么？'], ['整理最近记录', '帮我整理最近的身体记录。'], ['还要补充什么？', '还需要补充哪些信息？']].map(([label, question]) => `<button type="button" data-act="suggest" data-question="${attr(question)}">${label}</button>`).join('')}</div></div>`;
  return `<div class="chat-thread" id="chat-thread" aria-live="polite">${messages.map(item => `<div class="chat-bubble ${item.role === 'user' ? 'from-user' : 'from-assistant'}">${item.role === 'assistant' ? '<strong>HealthThread</strong>' : ''}<p>${esc(item.text).replaceAll('\n', '<br>')}</p>${recordSaveMarkup(item)}${item.visit_result_id?button('查看沟通卡','view-chat-card','quiet',`data-id="${attr(item.visit_result_id)}"`):''}${item.record_source_id?button('查看记录','record','quiet',`data-id="${attr(item.record_source_id)}"`):''}${actionRetryMarkup(item)}${item.error && !item.chat_retry_run_id && !item.retry_unavailable ? button('重试回复', 'retry-chat') : item.action && !['visit','card'].includes(item.action) ? button(item.action === 'timeline' ? '查看时间线' : item.action === 'review' ? '核对这条记录' : '继续记录', item.action === 'review' ? 'review' : `go-${item.action}`, 'secondary', item.recordId ? `data-id="${attr(item.recordId)}"` : '') : ''}</div>`).join('')}${chatBusy && messages.at(-1)?.visit_status!=='generating' && messages.at(-1)?.record_status!=='saving' ? '<div class="chat-bubble from-assistant"><span class="loading-dot"></span>正在整理回复…</div>' : ''}</div>`;
}
function cardProgress() {
  return `${cardBusy||data.cardRegenerationPending?'<p class="hint" role="status">正在生成医生沟通卡，请稍候…</p>':''}${cardError||data.cardRegenerationError?`<p class="danger-text" role="alert">${esc(cardError||data.cardRegenerationError)}</p>`:''}`;
}
function homePage() {
  const recent = sortedSessions().slice(0, 3).map((s, i) => `<button class="recent-conversation" type="button" data-act="conversation" data-id="${attr(s.id)}"><span>${sessionDate(s)} · ${esc(s.title)}</span><span class="${i === 0 ? 'warning-text' : 'green-text'}">${s.messages.length} 条消息 · ${i === 0 ? '继续查看' : '已保存'}</span></button>`).join('');
  const isRecord = false;
  const voiceSupported = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  const voiceLabel = voiceListening ? '停止语音输入' : voiceSupported ? '开始语音输入' : '当前浏览器不支持语音输入';
  return `<div class="content home-content" data-node-id="4:63"><h1>你好，${esc(native.client.state.user?.username||'')}</h1><div class="home-grid"><section class="chat-panel panel"><div class="chat-top"><h2>AI 健康助手</h2>${button('新对话', 'new-chat', 'quiet', activeSession() ? '' : 'disabled')}</div>${chatMessages()}${cardProgress()}<div class="composer-wrap"><form id="chat-form" class="chat-composer"><label for="chat-input" class="sr-only">${isRecord ? '记录身体感受' : '向 AI 健康助手提问'}</label><textarea id="chat-input" rows="1" placeholder="${isRecord ? '例如：饭后有点腹胀…' : activeSession() ? '还需要补充哪些信息？' : '就诊前，我应该准备哪些资料？'}">${esc(isRecord ? recordDraft : chatDraft)}</textarea><div class="composer-bottom"><span class="composer-help">${voiceListening ? '正在听，请说话…' : isRecord ? '模型整理后，请回复确认或继续补充' : 'Enter 发送 · Shift + Enter 换行'}</span><div class="composer-actions"><button type="button" class="mic-button ${voiceListening ? 'is-listening' : ''}" data-act="voice" aria-label="${voiceLabel}" title="${voiceLabel}" aria-pressed="${voiceListening}" ${voiceSupported ? '' : 'disabled'}><img src="./assets/b8836.svg" alt="" width="22" height="22"/></button>${button(isRecord ? '发送记录' : chatBusy ? '回复中…' : '发送 ↑', isRecord ? 'save-record' : 'send-chat', 'primary', chatBusy ? 'disabled' : '')}</div></div></form><p class="chat-note">健康信息会自动整理成可修改的记录，回答供参考。</p></div></section><div class="home-rail">${panel('身体近况',hint('结合记录与病历，查看近期整体身体情况。')+button('查看身体近况','health-profile','secondary'))}${panel('对话记录', (recent || hint('还没有对话。')) + button('查看全部对话', 'conversations', 'secondary', data.sessions.length ? 'class="full-width"' : 'class="full-width" disabled'), 'recent-panel')}<section class="panel pending-panel"><div class="between"><h2>待处理差异</h2><span class="small warning-text">${pendingCount()} 项</span></div><p class="small muted">${hasPending() ? '仅需核实的冲突或识别不确定内容' : '当前没有待处理差异'}</p>${button('查看差异', 'review', 'primary', hasPending() ? '' : 'disabled')}</section></div></div></div>`;
}

function conversationPage() {
  const sessions = sortedSessions();
  const query = conversationQuery.trim().toLocaleLowerCase();
  const filtered = sessions.filter(s => !query || [s.title, ...s.messages.map(m => m.text)].join('\n').toLocaleLowerCase().includes(query));
  const selected = filtered.find(s => s.id === selectedSessionId) || filtered[0];
  const emptyTitle = sessions.length ? '没有找到相关对话' : '还没有对话';
  const emptyAction = sessions.length ? button('清除搜索', 'clear-conversation-search') : button('开始新对话', 'start-conversation', 'primary');
  return `<div class="content conversation-content">
    ${actionHeader('对话记录', button('返回首页', 'go-home'))}${cardProgress()}
    <div class="conversation-grid">
      <section class="panel conversation-list" aria-label="会话列表">
        <div class="conversation-list-title"><h2>全部对话</h2><span class="conversation-count">${sessions.length}</span></div>
        <label class="conversation-search"><span class="sr-only">搜索对话</span><img src="./assets/search.svg" alt="" width="20" height="20"/><input id="conversation-search" type="search" value="${attr(conversationQuery)}" placeholder="搜索标题或聊天内容"/></label>
        <p class="conversation-list-meta" role="status">${query ? `${filtered.length} 条搜索结果` : '最近更新'}</p>
        <div class="session-list">${filtered.map(s => `<div class="session-choice ${selected?.id === s.id ? 'selected' : ''}"><button class="session-open" type="button" data-act="select-session" data-id="${attr(s.id)}" aria-pressed="${selected?.id === s.id}" title="${attr(s.title)}"><strong>${esc(s.title)}</strong><span>${sessionDate(s)} ${sessionTime(s)} · ${s.messages.length} 条消息</span></button><button id="delete-session-${attr(s.id)}" class="session-delete" type="button" data-act="delete-session" data-id="${attr(s.id)}" aria-label="删除对话：${attr(s.title)}，${sessionDate(s)} ${sessionTime(s)}" title="删除对话"><img src="./assets/trash.svg" alt="" width="18" height="18"/></button></div>`).join('') || `<p class="conversation-list-empty">${emptyTitle}</p>`}</div>
      </section>
      <section class="panel conversation-detail" aria-label="完整聊天记录">${selected ? `
        <div class="conversation-detail-heading"><div><h2>${esc(selected.title)}</h2><p>${sessionDate(selected)} ${sessionTime(selected)} · ${selected.messages.length} 条消息</p></div><button id="delete-current-session" class="delete-conversation-button" type="button" data-act="delete-session" data-id="${attr(selected.id)}"><img src="./assets/trash.svg" alt="" width="18" height="18"/><span>删除对话</span></button></div>
        <div class="history-transcript">${selected.messages.map(m => `<div class="history-message ${m.role === 'user' ? 'from-user' : 'from-assistant'}"><strong>${m.role === 'user' ? '我' : '健康助手'}</strong><p>${esc(m.text).replaceAll('\n', '<br>')}</p>${actionRetryMarkup(m)}${m.record_source_id?button('查看记录','record','quiet',`data-id="${attr(m.record_source_id)}"`):''}${m.visit_result_id?button('查看沟通卡','view-chat-card','quiet',`data-id="${attr(m.visit_result_id)}"`):''}</div>`).join('')}</div>
        <div class="button-row">${button('继续对话', 'continue-session', 'primary', `data-id="${attr(selected.id)}"`)}</div>` : `
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
  data.hiddenSessions=[...new Set([...(data.hiddenSessions||[]),targetId])];
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
  const issues = [...new Set(data.records.map(r => r.issue || '健康记录'))];
  const items = data.records.filter(r => (timelineFilter === 'all' || r.status === timelineFilter) && (timelineIssue === 'all' || (r.issue || '健康记录') === timelineIssue) && (timelineTime === 'all' || new Date(r.date) >= new Date(Date.now() - 7 * 86400000)));
  const cards = items.map(r=>`<article class="panel fact-panel"><div class="fact-date"><h2>${esc(recordTimeLabel(r))}</h2></div><p>${esc(r.summary||r.text)}</p><div class="record-metadata">${status(['patient_report','document_report','confirmed'].includes(r.status)?'confirmed':'pending',recordStatusLabel(r))}</div><div class="card-actions">${button('查看与修改记录','record','secondary',`data-id="${attr(r.id)}"`)}${r.review_state==='exceptions'&&r.proposals.length?button('处理差异','review','secondary',`data-id="${attr(r.id)}"`):''}${!r.automatic&&r.review_state!=='exceptions'?button('重新整理记录','reanalyse-record','secondary',`data-id="${attr(r.id)}"`):''}</div></article>`).join('');
  return `<div class="content timeline-content" data-node-id="4:93">${actionHeader('健康时间线')}${timelineTabs()}<div class="filter-row"><label><span class="sr-only">问题</span><select id="timeline-issue" aria-label="问题筛选"><option value="all">${issues.length === 1 ? esc(issues[0]) : '全部问题'}</option>${issues.length > 1 ? issues.map(issue => `<option value="${attr(issue)}" ${timelineIssue === issue ? 'selected' : ''}>${esc(issue)}</option>`).join('') : ''}</select></label><label><span class="sr-only">时间</span><select id="timeline-time" aria-label="时间筛选"><option value="all">全部时间</option><option value="week" ${timelineTime === 'week' ? 'selected' : ''}>最近 7 天</option></select></label><label><span class="sr-only">确认状态</span><select id="timeline-filter" aria-label="确认状态"><option value="all" ${timelineFilter === 'all' ? 'selected' : ''}>全部状态</option><option value="confirmed" ${timelineFilter === 'confirmed' ? 'selected' : ''}>已核对</option><option value="patient_report">患者自述</option><option value="document_report">病历记载</option><option value="pending" ${timelineFilter === 'pending' ? 'selected' : ''}>待核对 ${pendingCount(false)}</option></select></label></div>${cards || panel('暂无记录', '<p class="muted">没有符合筛选条件的记录。</p>' + button('记录新变化', 'record-new-change'))}</div>`;
}

function visitPage() {
  return `<div class="content">${actionHeader('准备就诊')}${panel('在首页和助手聊聊',hint('把本次困扰、变化和想问的问题告诉助手，再根据完整对话生成医生沟通卡。')+button('回到首页准备就诊','start-visit','primary'))}</div>`;
}

function generatedCardText(){return data.cardDraft||'';}
function cardPage() {
  if (!data.cardVersion) return `<div class="content">${actionHeader('医生沟通卡')}${cardProgress()}${panel('还没有医生沟通卡', `<p class="muted">先在首页和助手聊清本次就诊需要，再从对话生成沟通卡。</p>${button('回到首页准备就诊', 'start-visit', 'primary')}`)}</div>`;
  const stale = isCardStale(),cardSources=[...new Map((data.cardRecords||[]).filter(record=>record.id).map(record=>[record.id,record])).values()];
  if(data.cardSourceId&&!cardSources.some(record=>record.id===data.cardSourceId))cardSources.push({id:data.cardSourceId,source:'用户自述'});
  return `<div class="content card-content" data-node-id="4:153">${actionHeader('医生沟通卡', `${button('编辑沟通卡','edit-card','primary',cardBusy||data.cardRegenerationPending?'disabled':'')}${button(cardBusy||data.cardRegenerationPending?'正在生成…':'重新生成','regenerate-card','secondary',cardBusy||data.cardRegenerationPending?'disabled':'')}${button('打印','print-preview')}${button('复制','copy-card')}`)}${cardProgress()}${stale?`<div class="stale-banner">${status('stale','来源已变化')}<span>请根据当前资料重新生成，或核对并编辑现有内容。</span></div>`:''}<p class="muted">根据对话整理。表达稿和问题都可以修改，方便就诊时直接使用。</p><div class="columns card-columns"><div class="stack">${panel('一分钟表达稿',`<p class="speech">${esc(generatedCardText()).replaceAll('\n','<br>')}</p>`)}${panel('想问医生',data.questions.length?`<ol class="question-list">${data.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ol>`:hint('可以点击“编辑沟通卡”补充想问医生的问题。'))}</div><div class="stack">${data.cardConversationId?button('回到首页继续补充','continue-session','secondary',`data-id="${attr(data.cardConversationId)}"`):''}${(data.cardUnknowns||[]).length?panel('还可补充',`<ul>${data.cardUnknowns.map(item=>`<li>${esc(item)}</li>`).join('')}</ul>`):''}${panel('参考来源',`${data.cardConversationId?button('查看本次对话原文','chat-source'):''}${cardSources.length?`<p class="small muted">根据 ${cardSources.length} 份来源整理</p>`:''}${cardSources.map((r,index)=>`<div class="card-history">${source(`来源 ${index+1} · ${r.source||'用户自述'}`,r.id)}</div>`).join('')||(!data.cardConversationId?hint('本卡根据就诊对话整理。'):'')}`)}<p class="muted small">生成于 ${esc(data.cardGeneratedAt||'未记录')}</p></div></div></div>`;
}

function recordsPage() {
  const tasks=(data.tasks||[]).filter(t=>taskFilter==='all'||taskFilter===t.status),careProgress=careProgressMarkup(native.client.state.runs,'web',careRetries,data.documents);
  return `<div class="content medical-content" data-node-id="4:183">${actionHeader('健康时间线')}${timelineTabs()}${panel('病历资料',`<div class="upload-summary"><span>上传病历 · 图片 / 文字 / PDF</span>${button('上传资料','upload')}</div>${(data.documents||[]).map(doc=>row(doc.name,documentStatusLabel(doc),button('查看原文与分析','medical-review','secondary',`data-id="${attr(doc.source_id)}"`))).join('')||hint('暂无病历资料。')}`)}${panel('诊后事项',`${careProgress}<div class="task-filters" role="group" aria-label="事项状态">${[['all','全部'],['pending','待完成'],['done','已完成'],['paused','已暂停']].map(([id,label])=>`<button type="button" data-act="filter-task" data-status="${id}" class="${taskFilter===id?'active':''}">${label}</button>`).join('')}</div>${tasks.map(t=>careTaskMarkup(t,'web')).join('')||(careProgress?'':hint('暂无诊后事项。'))}<div class="care-record-entry"><p>有新的身体感受，或想补充执行情况</p>${button('记录新变化','record-new-change')}</div>`)}</div>`;
}

function settingsPage() {
  return `<div class="content settings-content" data-node-id="4:213">${actionHeader('设置与数据')}<div class="columns settings-columns"><div class="stack">${panel('当前账号',row('已登录',native.client.state.user?.username||'未登录')+hint('手机端和电脑端共享登录状态与健康资料。')+button('Agnes 模型配置','model-config')+button('退出登录','logout'))}${panel('授权管理', row('健康记录整理', data.consent.organize ? '已授权' : '未授权', button('管理', 'consent')) + row('病历解析', data.consent.parse ? '已授权' : '未授权', button('管理', 'consent')) + row('语音处理', data.consent.voice ? '已授权' : '未开启', button('管理', 'consent')))}${panel('数据处理', row('处理范围', '用户选择的记录', button('详情', 'consent')) + row('数据去向', '项目配置的处理服务', button('详情', 'consent')))}${panel('我的数据', row('导出资料', `最近导出：${data.exportAt ? fmt(data.exportAt).replace(/^\d+年/, '') : '未生成'}`, button('选择范围', 'export')) + row('删除数据', '选择后再次确认', button('删除', 'delete-confirm')))}</div><div class="stack">${panel('处理记录', `<p>导出资料 · ${data.exportAt ? '已完成' : '未发起'}</p>${button('查看导出', 'export')}<p class="${data.deleteResult ? 'green-text' : 'muted'}">删除数据 · ${data.deleteResult ? '部分删除' : '未发起'}</p>${button('查看处理结果', 'delete-result')}`, 'processing-panel')}</div></div></div>`;
}

const SUBTITLES = {
  healthProfile:'身体近况',profileCorrection:'更正健康事实',visit: '就诊准备', conversations: '对话记录',
  record: '记录详情', review: '提取结果核对', voice: '语音转写校对', source: '事实来源', correct: '修改整条记录', conflict: '版本与冲突对照', history: '选择相关历史', reference: '导医参考详情', editCard: '编辑沟通卡', print: '打印预览', upload: '上传病历', medicalReview: '病历原文与分析', task: '事项详情', consent: '授权管理', export: '数据导出', deleteConfirm: '删除数据', deleteResult: '删除处理结果',
};
function subviewTitle() { return SUBTITLES[subview] || ''; }
const back = () => button('返回' + routeTitle(), 'close-subview');
function renderSubview(core) {
  if (['record', 'source', 'task'].includes(subview)) return `<div class="under-drawer">${core}</div><button class="drawer-scrim" data-act="close-subview" type="button" aria-label="关闭详情"></button><aside class="detail-drawer" aria-label="${subviewTitle()}">${renderDrawer()}</aside>`;
  return `<div class="subview-content">${renderSubPage()}</div>`;
}
function renderDrawer() {
  const r = record(selectedRecord);
  const header = `<div class="drawer-head"><h1>${subviewTitle()}</h1><button type="button" data-act="close-subview" aria-label="关闭详情">×</button></div>`;
  if (subview === 'source' && selectedChatSource) {
    const original=native.sources?.get(data.cardSourceId);
    const session=data.sessions.find(s=>s.id===data.cardConversationId);
    const text=original?.text||session?.messages.filter(m=>m.role==='user').map(m=>m.text).join('\n');
    return header+`<div class="source-quote"><span>生成沟通卡时的对话原文</span><p>${esc(text||'此来源已不可查看。').replaceAll('\n','<br>')}</p></div>${session?row('对应会话',session.title):''}${hint('原始对话保留，编辑沟通卡不会改动这里的内容。')}`;
  }
  const medicalSource=subview==='source'?(selectedMedicalSource?data.medical:documentForSource(data.documents,selectedRecord)):null;
  if(medicalSource)return header+documentSourceMarkup(medicalSource,'web');
  if(subview==='source'&&!r){
    const original=native.sources?.get(selectedRecord);
    if(original)return header+`<div class="source-quote"><span>${esc(sourceProvenanceLabel(original))}</span><p>“${esc(original.text||'原文文字尚未取得。')}”</p></div>${row('来源编号',original.id)}${row('记录时间',original.recorded_at||original.created_at||'未记录')}${hint('此处仅展示保存的原文；请从对应健康记录修改事实。')}`;
  }
  if (['record','source'].includes(subview)&&!r) return header+hint('原始记录已不可查看。');
  if (subview === 'record') return header+`${recordRecoveryMarkup(r,'web',recoveryRetries)}<section class="record-summary"><h2>${r.edit_recovery?'已保存的完整修改':'整理后的记录'}</h2><p>${esc(r.summary||r.text).replaceAll('\n','<br>')}</p></section><div class="record-metadata">${status(['patient_report','document_report','confirmed'].includes(r.status)?'confirmed':'pending',recordStatusLabel(r))}</div>${r.date?row('事件时间',r.date):''}<div class="drawer-actions">${button('查看来源','source','secondary',`data-id="${attr(r.id)}"`)}${r.record_thread_id?button('修改整条记录','correct','primary',`data-id="${attr(r.id)}"`):button('重新整理记录','reanalyse-record','primary',`data-id="${attr(r.id)}"`)}${r.review_state==='exceptions'&&r.proposals.length?button('处理差异','review','secondary',`data-id="${attr(r.id)}"`):''}</div>`;
  if (subview === 'source') return header + `<div class="source-quote"><span>原始记录（节选）</span><p>“${esc(r?.text)}”</p></div>${row('来源类型', r?.correction ? '用户更正 · 原始自述保留' : r?.source || '用户自述')}${row('记录时间', r?.created || '未记录')}${row('事件时间', r?.date || '未记录')}${r?.correction ? row('更正原因', r.correction) : ''}${Number.isSafeInteger(r?.source_text_version)&&r.source_text_version>0?row('原文版本','v'+r.source_text_version):Number.isSafeInteger(r?.record_version)&&r.record_version>0?row('记录版本','v'+r.record_version):row('原文版本','未记录')}<div class="record-metadata">${status(['patient_report','document_report','confirmed'].includes(r?.status)?'confirmed':'pending',recordStatusLabel(r))}</div><div class="drawer-actions">${button('查看原始记录', 'record')}${r?.record_thread_id?button('修改整条记录','correct'):button('重新整理记录','reanalyse-record','secondary',`data-id="${attr(r?.id)}"`)}</div>`;
  const task=data.tasks?.find(t=>t.id===selectedTask);if(!task)return header+hint('没有找到事项。');
  return header+`${careDetailsMarkup(task,feedbackDrafts[task.id]||'','web',feedbackBusy.has(task.id))}${row('截止时间',task.schedule||'未指定截止时间')}${row('状态',({pending:'待完成',done:'已完成',paused:'已暂停'})[task.status])}${row('依赖',task.validity==='current'?'当前':'已过期')}<div class="drawer-actions">${task.validity==='current'?button('标为完成','task-done','primary',`data-version="${task.version}"`)+button('暂停事项','task-pause','secondary',`data-version="${task.version}"`)+button('重新打开','task-resume','secondary',`data-version="${task.version}"`):hint('依赖已过期，请核对当前医嘱。')}${button('记录新变化','record-new-change')}</div>`;
}

function renderSubPage() {
  const head = (title = subviewTitle(), extra = '') => actionHeader(title, extra || back());
  const two = (left, right, className = '') => `<div class="columns ${className}"><div class="stack">${left}</div><div class="stack">${right}</div></div>`;
  const currentReviewRecord = record(selectedRecord) || latestRecord();
  const reviewedRecord=capturedReview(currentReviewRecord?.id)?{...currentReviewRecord,proposals:reviewProposals(reviewSnapshot)}:currentReviewRecord;
  switch (subview) {
    case 'visit': return visitPage();
    case 'healthProfile': return `<div class="content">${head('身体近况')}${healthProfileMarkup(data.healthProfile,profileView,'web',recoveryRetries,native.healthProfileRefreshState())}</div>`;
    case 'profileCorrection': return `<div class="content narrow-content">${head('更正健康事实')}${profileEditor?profileCorrectionMarkup(profileEditor.fact,profileEditor.text,'web',profileSaveBusy):hint('请重新选择要更正的事实。')}</div>`;
    case 'conversations': return conversationPage();
    case 'review': return `<div class="content">${head()}<div class="steps">原文已保存 <span>→</span> 候选内容 <span>→</span> 等待核对</div>${two(panel('用户原文',`<blockquote>${esc(reviewedRecord?.text)}</blockquote>${hint('记录于 '+(reviewedRecord?.created||'未记录'))}`),panel('候选事实',hint(selectedForReview.size ? `已选择 ${selectedForReview.size} 项，确认后保存为事实。` : '请勾选下方正确的内容，再点击确认；不正确的内容可先修改记录。')+((reviewedRecord?.proposals||[]).map(p=>`<label class="check-row"><input type="checkbox" data-review="${attr(p.id)}" ${selectedForReview.has(p.id)?'checked':''}/><span>${esc(p.value)}</span></label>${row('事件时间',eventTimeText(p))}${hint(`${assertionLabel(p.assertion)} · ${scopeLabel(p.temporal_scope)} · 保留完整原句`)}${comparisonMarkup(p,reviewChoices,'web')}`).join('')||hint(reviewedRecord?.analysis==='failed'?'分析未完成，原文保留。':'当前没有可确认候选；已确认的信息可在时间线查看，未分析的原文可重新整理。')))+'<div class="button-row">'+button('确认已选字段','confirm-review','primary',selectedForReview.size&&capturedReview(reviewedRecord?.id)&&!confirmBusy?'':'disabled')+button('刷新核对内容','refresh-review')+button('修改记录','correct','secondary',`data-id="${attr(reviewedRecord?.id)}"`)+button(reviewedRecord?.record_kind==='visit_context'?'整理为记录':'重新分析原文',reviewedRecord?.record_kind==='visit_context'?'convert-record':'retry-analysis')+button('暂后处理','close-subview')+'</div>','review-columns')}</div>`;
    case 'voice': return `<div class="content narrow-content">${head()}${panel('转写文本', `<p class="muted">请核对时间、数字、药名与否定词。</p><label class="field"><span>可编辑文本</span><textarea id="voice-text" rows="6">${esc(recordDraft)}</textarea></label><div class="button-row">${button('确认并保存', 'save-voice', 'primary')}${button('返回修改', 'close-subview')}</div>`)}</div>`;
    case 'correct': return `<div class="content narrow-content">${head('修改整条记录')}${panel('完整记录',`<label class="field"><span>按你的意思修改完整描述</span><textarea id="edit-text" rows="8" ${editBusy?'disabled':''}>${esc(editText)}</textarea></label>${hint('保存后自动重新整理并更新身体近况。原始对话与历史版本保留。')}<div class="button-row">${button(editBusy?'正在保存…':'保存修改','submit-correction','primary',editBusy?'disabled':'')}${button('取消','close-subview','secondary',editBusy?'disabled':'')}</div>`)}</div>`;
    case 'conflict': {
      const item=record(selectedRecord);
      return `<div class="content">${head()}${two(panel('当前已核对事实',(item?.facts||[]).map(f=>row('事实内容',f.value)).join('')||hint('当前没有已核对事实。')),panel('本条记录的新候选',(item?.proposals||[]).map(p=>row('候选内容',p.value)).join('')||hint('当前没有待核对候选。')))}<div class="button-row">${button('查看来源','source','secondary',`data-id="${attr(item?.id)}"`)}${button('修改记录','correct','primary',`data-id="${attr(item?.id)}"`)}${item?.proposals?.length?button('核对候选','review','secondary',`data-id="${attr(item.id)}"`):''}${button('暂不处理','close-subview','text')}</div></div>`;
    }
    case 'history': return `<div class="content">${head()}${panel('健康记录', data.records.map(r => `<label class="check-row history-choice"><input type="checkbox" data-history="${r.id}" ${data.selectedHistory.includes(r.id) ? 'checked' : ''}/><span><strong>${esc(fmt(r.date))}</strong><br>${esc(r.text)}</span></label>`).join('') + `<div class="between">${hint(`已选择 ${data.selectedHistory.length} 条`)}${button('确认选择', 'close-subview', 'primary')}</div>`)}</div>`;
    case 'reference': return `<div class="content">${head()}${two(panel('健康记录', `<div class="soft-warning"><strong>科室推荐与观察分级未配置</strong><p>本页保留原文与就诊资料，相关判断请向医疗机构确认。</p></div><h3>参考依据</h3><p>本次描述：${esc(data.currentConcern)}</p><p>相关历史：${data.selectedHistory.length} 条用户自述。</p>${button('查看事实来源', 'source')}`), panel('适用范围', `<p>用于整理就诊准备信息，不提供诊断或用药结论。</p>${hint('若出现紧急不适，应及时就医。')}${button('继续生成沟通卡', 'generate-card', 'primary')}`))}</div>`;
    case 'editCard': return `<div class="content">${head('编辑医生沟通卡')}${cardError?`<p class="danger-text" role="alert">${esc(cardError)}</p>`:''}${panel('表达稿与问题', `<label class="field"><span>一分钟表达稿</span><textarea id="card-draft" rows="8" ${cardSaveBusy?'disabled':''}>${esc(cardEditor?.speech??generatedCardText())}</textarea></label><label class="field"><span>想问医生（每行一个问题）</span><textarea id="card-questions" rows="5" ${cardSaveBusy?'disabled':''}>${esc(cardEditor?.questions??data.questions.join('\n'))}</textarea></label><label class="field"><span>还需补充（每行一项）</span><textarea id="card-unknowns" rows="4" ${cardSaveBusy?'disabled':''}>${esc(cardEditor?.unknowns??(data.cardUnknowns||[]).join('\n'))}</textarea></label><div class="button-row">${button(cardSaveBusy?'正在保存…':'保存修改','save-card','primary',cardSaveBusy?'disabled':'')}${button('取消','close-subview','secondary',cardSaveBusy?'disabled':'')}</div>`)}${hint('修改只更新这张沟通卡，不会改动已核对的健康事实。')}</div>`;
    case 'print': return `<div class="content print-screen">${head('打印预览', button('浏览器打印', 'print', 'primary'))}<article class="print-sheet"><h1>医生沟通卡</h1><p>${esc(native.client.state.user?.username||'')} · 生成于 ${esc(data.cardGeneratedAt||'未记录')}${isCardStale()?' · 来源已变化':''}</p><h2>一分钟表达稿</h2><p>${esc(generatedCardText()).replaceAll('\n','<br>')}</p><h2>想问医生</h2><ol>${data.questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ol><footer>由就诊对话整理，请在就诊时核对。</footer></article></div>`;
    case 'upload': return `<div class="content narrow-content">${head('上传病历')}<p class="muted">保存原件 → 图片识别为文字 → 结合记录分析 → 更新近况与诊后建议</p>${panel('选择资料',`<p>PNG / JPEG 图片、文字文件或可复制文本的 PDF</p><input id="file-input" hidden type="file" accept=".png,.jpg,.jpeg,.txt,.pdf,image/png,image/jpeg,text/plain,application/pdf"/><div class="button-row">${button('选择文件','choose-file','secondary',medicalUploadBusy?'disabled':'')}${button('试用合成示例','sample-file','secondary',medicalUploadBusy?'disabled':'')}</div><label class="field"><span>也可以粘贴病历文字</span><textarea id="medical-text" rows="7" placeholder="粘贴完整病历或医嘱原文">${esc(medicalText)}</textarea></label>${button(medicalUploadBusy?'正在处理…':'保存并分析文字','parse-medical-text','primary',medicalUploadBusy?'disabled':'')}${hint('资料会自动整理。只有实际冲突或识别不确定的内容需要核实。')}`)}${data.medical?panel(data.medical.name,documentAnalysisMarkup(data.medical,'web',medicalRetries.has(data.medical.source_id))+button('查看原文与分析','medical-review','secondary',`data-id="${attr(data.medical.source_id)}"`)):''}</div>`;
    case 'medicalReview': {
      const m=capturedReview(data.medical?.source_id)?{...data.medical,proposals:reviewProposals(reviewSnapshot)}:data.medical;
      const exceptions=m?.review_state==='exceptions';
      return `<div class="content">${head('病历原文与分析')}${documentAnalysisMarkup(m,'web',medicalRetries.has(m?.source_id))}${panel((m?.name||'病历资料')+(m?.transcript?' · 识别文字':' · 原文'),`<div class="document-text">${esc(m?.original||'识别完成后，完整文字会显示在这里。').replaceAll('\n','<br>')}</div>`)}${exceptions?panel('需要核实的差异',(m?.proposals||[]).map(p=>`<label class="check-row"><input type="checkbox" data-review="${attr(p.id)}" ${selectedForReview.has(p.id)?'checked':''}/><span>${esc(p.value)}</span></label>${row('事件时间',eventTimeText(p))}${comparisonMarkup(p,reviewChoices,'web')}`).join('')+`<div class="button-row">${button('提交差异处理','confirm-medical','primary',selectedForReview.size&&capturedReview(m?.source_id)&&!confirmBusy?'':'disabled')}${button('刷新差异','refresh-medical')}</div>`):''}<div class="button-row">${button('查看身体近况','health-profile')}${button('查看诊后事项','timeline-medical')}${!exceptions&&m?.proposals?.length?button('重新整理记录','retry-medical','secondary',`data-id="${attr(m.source_id)}"`):''}</div></div>`;
    }
    case 'consent': return `<div class="content narrow-content">${head()}${panel('授权管理', `${[['organize', '健康记录整理', '你提供的身体感受与健康记录'], ['parse', '病历解析', '选择上传的病历资料'], ['voice', '语音处理', '转写校对所需音频']].map(([key, label, content]) => `<div class="consent-row"><div><strong>${label}</strong><p class="muted small">用途：${content} · 去向：${key === 'voice' ? '浏览器语音服务（处理方式取决于浏览器）' : '项目配置的处理服务'}</p></div><label class="switch"><input type="checkbox" data-consent="${key}" ${data.consent[key] ? 'checked' : ''}/><span class="sr-only">${label}授权</span></label></div>`).join('')}${hint('撤回后停止新的处理请求；已保存内容可在数据设置中管理。')}`)}</div>`;
    case 'export': return `<div class="content narrow-content">${head()}${panel('导出范围', `<p>健康记录与来源 · 已确认事实与版本 · 沟通卡与诊后事项</p>${hint('旧沟通卡会标出生成版本和过期状态。')}${button('生成并下载 JSON', 'download-export', 'primary')}`)}${panel('最近导出', row('资料包', data.exportAt || '未生成'))}</div>`;
    case 'deleteConfirm': return `<div class="content narrow-content">${head()}${panel('确认删除范围', `<p>健康记录 · 候选事实 · 沟通卡 · 病历元数据 · 诊后事项</p><p class="danger-text">删除后无法通过本应用恢复。</p><label class="check-row"><input type="checkbox" id="delete-ack" ${deleteAcknowledged ? 'checked' : ''}/><span>我已了解删除范围</span></label><div class="button-row">${button('确认删除当前账号资料', 'delete-local', 'danger', deleteAcknowledged ? '' : 'disabled')}${button('保留数据', 'close-subview')}</div>${hint('删除当前账号的活动资料与原件；模型轨迹、备份和存储残留未认证擦除，结果如实报告partial。')}`)}</div>`;
    case 'deleteResult': return `<div class="content narrow-content">${head()}${panel('处理结果', `${data.deleteResult ? status('pending', '部分删除') : status('pending', '未发起')}${row('当前账号资料', data.deleteResult || '尚未发起删除')}${data.deleteResult?hint('后端活动资料已删除；轨迹、备份与存储残留未认证擦除。'):hint('尚未提交删除请求。')}`)}</div>`;
    default: return '';
  }
}

function ensureSession(text) {
  let session = activeSession();
  if (!session) {
    session = { id: 'c-' + crypto.randomUUID(), title: text.slice(0,24), updatedAt: new Date().toISOString(), messages: [] };
    data.sessions.unshift(session);
    data.activeSessionId = session.id;
  }
  return session;
}
function reconcileCardCompletion(){
  if(!cardErrorRunId)return;
  const run=native.client.state.runs[cardErrorRunId];
  if(run?.status==='completed'&&run.runtime&&!run.execution_error&&(native.client.state.results||[]).some(result=>result.id===run.result_id)){
    cardError='';cardErrorRunId=null;
    notice='';
  }
}
async function generateConversationCard(sessionId,regenerate=false) {
  if(cardBusy||data.cardRegenerationPending)return;
  if(!regenerate&&!sessionId)return startVisitConversation();
  const navigation=navigationRevision;
  cardBusy=true;cardError='';cardErrorRunId=null;render();
  try{
    if(regenerate)await native.regenerateVisit();else await native.generateVisit(sessionId);
    data=loadData();notice='';
    if(navigation===navigationRevision)open('card');
  }catch(error){
    cardErrorRunId=error.run_id||null;
    data=loadData();
    if(['POLL_TIMEOUT','REQUEST_TIMEOUT'].includes(error.code)&&data.cardRegenerationPending){cardError='';flash('沟通卡仍在整理，完成后会自动更新。');return;}
    cardError=({
      NO_VISIT_CONVERSATION:'请先在首页和助手聊聊本次就诊情况，再生成医生沟通卡。',
      CONVERSATION_NOT_READY:'请等待本次对话回复完成，再生成医生沟通卡。',
      NO_CARD:'还没有沟通卡，请先回到首页整理就诊信息，再生成。',
      CONSENT_REQUIRED:'请在设置中授权健康记录整理，再生成医生沟通卡。',
      NO_CONVERSATION:'请先在首页和助手聊聊本次就诊情况，再生成医生沟通卡。',
      NO_SOURCE:'请回到首页补充本次就诊信息，再生成医生沟通卡。'
    })[error.code]||'医生沟通卡暂未生成成功，对话和已有卡片已保留。请重试，或回到首页补充就诊信息。';
  }finally{cardBusy=false;render();}
}
function startVisitConversation(){
  if(activeSession()?.record_thread_id){data.activeSessionId=null;saveData(data);}
  inputMode='ask';open('home');document.getElementById('chat-input')?.focus();
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
    const reply = await askAssistant(question, { retry_source_id:retry?session.messages.findLast(m=>m.role==='user')?.source_id:undefined, messages: session.messages.map(m => ({ role: m.role, text: m.text,source_id:m.source_id })), records: data.records, onProgress:()=>{if(requestId===chatRequestId){data=loadData();render();}} });
    if (requestId !== chatRequestId || !data.sessions.some(s => s.id === session.id)) return;
    const current=data.sessions.find(s=>s.id===session.id);
    const userMessage=[...current.messages].reverse().find(m=>m.role==='user');if(userMessage)userMessage.source_id=reply.source_id;
    appendAssistantReply(data.sessions,session.id,{text:reply.answer,action:reply.action,demo:reply.demo,run_id:reply.run_id,runtime:reply.runtime,execution_error:reply.execution_error,visit_result_id:reply.visit_result_id,visit_status:reply.visit_status,visit_retry_run_id:reply.visit_retry_run_id,record_retry_run_id:reply.record_retry_run_id,record_status:reply.record_status,record_change_id:reply.record_change_id,record_source_id:reply.record_source_id});
  } catch (error) {
    if (requestId !== chatRequestId || !data.sessions.some(s => s.id === session.id)) return;
    const current=data.sessions.find(s=>s.id===session.id);
    current.failedQuestion = question;
    current.messages.push({ role: 'assistant', text: error.name === 'TimeoutError' ? '回复超时，原话已保留。可以重试。' : error.message || '回复失败。原话已保留，请重试。', error: true, run_id: error.run_id });
  } finally {
    if (requestId === chatRequestId) {
      chatBusy = false;
      chatRequestSessionId = null;
      persist();
    }
  }
}

function submitHomeInput() {
  const session=activeSession(),text=document.getElementById('chat-input')?.value|| (inputMode==='record'?recordDraft:chatDraft);
  if(session?.record_thread_id&&(!['confirmed','partially_confirmed'].includes(session.record_status)||isRecordConfirmation(text)))return saveRecord(text);
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

async function saveRecord(value,existingSourceId=null) {
  if(chatBusy)return;
  const text=value.trim();if(!text)return flash('先填写身体感受。');
  if(!data.consent.organize)return flash('请先在设置中授权健康记录整理。');
  const session=activeSession();const continuing=!existingSourceId&&session?.record_thread_id&&!['confirmed','partially_confirmed'].includes(session.record_status);
  const confirmation=isRecordConfirmation(text),review=session?.messages.findLast(m=>m.record_review)?.record_review;
  if(confirmation&&!continuing)return flash('请先查看待确认的模型汇总；已确认记录不需要重复提交。');
  const navigation=navigationRevision,sessionId=data.activeSessionId;
  native.client.setDraft('record',text);chatBusy=true;render();
  try {
    if(confirmation){await native.confirmRecord(session.record_thread_id,text,review);data=loadData();}
    else {
      const receipt=await native.recordTurn(text,continuing?session.record_thread_id:null,continuing?session.record_version:undefined,existingSourceId);
      data=loadData();if(navigation===navigationRevision&&data.activeSessionId===sessionId){selectedRecord=receipt.source_id;data.activeSessionId=receipt.record_thread_id;saveData(data);open('home');}
      if(recordDraft.trim()===text)recordDraft='';if(chatDraft.trim()===text)chatDraft='';native.client.clearDraftIf('record',text);
      await native.wait(receipt.run_id);data=loadData();
    }
    if(recordDraft.trim()===text)recordDraft='';if(chatDraft.trim()===text)chatDraft='';native.client.clearDraftIf('record',text);
  } catch(error){data=loadData();flash(error.code==='REVISION_CONFLICT'?'记录或核对版本已变化，输入已保留。请阅读最新汇总后再提交。':error.message||'模型整理未完成，原文仍然保留。');}
  finally{chatBusy=false;render();}
}
async function openReview(sourceId,medical=false,preserve=false) {
  const target=medical?data.documents?.find(doc=>doc.source_id===sourceId):record(sourceId);
  if(!target)return flash('当前没有这条记录。');
  if(!medical&&target.review_state&&target.review_state!=='exceptions'){selectedRecord=sourceId;return openSubview('record');}
  if(medical){data.selectedDocumentId=sourceId;data.medical=target;saveData(data);}
  const requestId=++reviewRequestId;
  selectedRecord=sourceId;reviewSourceId=sourceId;reviewSnapshot=null;if(!preserve){selectedForReview.clear();reviewChoices={};}
  const view=medical?'medicalReview':'review';
  if(subview!==view)openSubview(view);else render();
  const navigation=navigationRevision;
  const stillCurrent=()=>requestId===reviewRequestId&&navigation===navigationRevision&&subview===view&&selectedRecord===sourceId;
  try{
    const snapshot=await native.review(sourceId);
    if(!stillCurrent())return;
    reviewSnapshot=snapshot;reviewChoices={};data=loadData();
    const valid=new Set(snapshot.proposals.map(p=>p.id));selectedForReview=new Set([...selectedForReview].filter(id=>valid.has(id)));
  } catch(error){
    if(!stillCurrent())return;
    if(error.code!=='NO_PENDING_CANDIDATES')throw error;
    data=loadData();selectedForReview.clear();
  }
  render();
}
async function confirmReview(medical=false) {
  const target=medical?data.medical:record(selectedRecord);if(confirmBusy||!target||!selectedForReview.size||!capturedReview(medical?target.source_id:target.id))return flash('请读取候选并选择要确认的字段。');
  let resolutions;try{resolutions=selectedResolutions(reviewSnapshot,[...selectedForReview],reviewChoices);}catch(error){return flash(error.message);}
  const navigation=navigationRevision,requestId=reviewRequestId;
  confirmBusy=true;render();
  try{const receipt=await native.confirm(medical?target.source_id:target.id,[...selectedForReview],reviewSnapshot.review_revision,reviewSnapshot.id,resolutions);data=loadData();if(navigation===navigationRevision&&requestId===reviewRequestId){selectedForReview.clear();reviewSnapshot=null;open(medical?'records':'timeline');}flash('所选内容已按你的选择处理；未选择或暂缓的候选继续留待核对。');await Promise.all([['care',receipt.continuation_run_id],['overview',receipt.overview_refresh_run_id]].filter(([,id])=>id).map(async([kind,id])=>{try{await native.wait(id);}catch(error){flash(kind==='overview'?'差异处理已保存；身体近况更新未完成，可在身体近况重试。':'差异处理已保存；诊后事项整理未完成，原文与处理结果已保留。');}}));data=loadData();render();}
  catch(error){flash(error.code==='REVISION_CONFLICT'?'核对版本已变化，勾选已保留。请点击“刷新核对内容”重新检查后提交。':error.message||'确认未完成，请恢复原请求。');}
  finally{confirmBusy=false;render();}
}
async function uploadDocument(input) {
  if(medicalUploadBusy)return;
  if(!data.consent.parse)return flash('请先在设置中授权病历解析。');
  const navigation=navigationRevision;medicalUploadBusy=true;render();
  try{const receipt=await native.createDocument(input);data=loadData();flash('原件已保存，正在处理。');await native.waitDocument(receipt.run_id);data=loadData();notice='病历处理已结束，可查看原文和诊后事项。';if(navigation===navigationRevision)await openReview(receipt.source_id,true);else render();}
  catch(error){data=loadData();flash(error.message||'处理尚未完成，已接收的原件仍保留。');}
  finally{medicalUploadBusy=false;render();}
}
async function onFileChange(event) {
  filePickerOpen=false;const file=event.target.files?.[0];if(!file)return;selectedUploadFile=file;return uploadDocument({file});
}

async function doAction(act, el) {
  switch (act) {
    case 'parse-medical-text': if(!medicalText.trim())return flash('请先粘贴病历原文。');return uploadDocument({text:medicalText.trim(),name:'粘贴的病历文字'});
    case 'reanalyse-record': selectedRecord=el.dataset.id||selectedRecord;return doAction('retry-analysis',el);
    case 'health-profile': return openSubview('healthProfile');
    case 'profile-view': profileView=el.dataset.view;return render();
    case 'profile-refresh': return refreshHealthProfile(false);
    case 'profile-review': {const doc=documentForSource(data.documents,el.dataset.id);return openReview(doc?.source_id||el.dataset.id,!!doc);}
    case 'profile-correct': {const fact=native.client.state.profile?.facts.find(f=>f.fact_id===el.dataset.id);if(!fact||fact.revision!==Number(el.dataset.version))return flash('事实已变化，请刷新后重试。');profileEditor={fact:{...fact},text:fact.value};return openSubview('profileCorrection');}
    case 'save-profile-correction': {
      if(!profileEditor||profileSaveBusy)return;const editor=profileEditor,navigation=navigationRevision;profileSaveBusy=true;render();
      try{const receipt=await native.correctFact(editor.fact.fact_id,editor.fact.revision,editor.text);data=loadData();if(navigation===navigationRevision){profileEditor=null;await openReview(receipt.source_id);}flash('更正已保存，请核对后确认。');}finally{profileSaveBusy=false;render();}return;
    }
    case 'care-feedback': {
      const id=el.dataset.id,text=(feedbackDrafts[id]||'').trim();if(feedbackBusy.has(id))return;if(!text)return flash('请先填写执行情况或新的感受。');
      const navigation=navigationRevision;feedbackBusy.add(id);render();
      try{const receipt=await native.feedbackTask(id,text,Number(el.dataset.version));if((feedbackDrafts[id]||'').trim()===text)delete feedbackDrafts[id];data=loadData();if(navigation===navigationRevision){data.activeSessionId=receipt.conversation_id||receipt.run_id;saveData(data);inputMode='ask';chatDraft='';open('home');}flash('反馈已保存为自述，可在这段对话继续补充。');await native.wait(receipt.run_id);data=loadData();}finally{feedbackBusy.delete(id);render();}return;
    }
    case 'toggle-menu': mobileMenu = !mobileMenu; return render();
    case 'nav': return open(el.dataset.page);
    case 'go-home': return open('home');
    case 'go-timeline': return open('timeline');
    case 'view-chat-card': data.selectedCardResultId=el.dataset.id;saveData(data);data=loadData();return open('card');
    case 'go-visit': return startVisitConversation();
    case 'timeline-health': timelineTab = 'health'; return open('timeline');
    case 'timeline-medical': timelineTab = 'medical'; return open('timeline');
    case 'filter-task': taskFilter = el.dataset.status; return render();
    case 'record-new-change': data.activeSessionId=null;saveData(data);inputMode = 'ask'; return open('home');
    case 'conversations': selectedSessionId = sortedSessions()[0]?.id || null; return openSubview('conversations', 'home');
    case 'conversation': selectedSessionId = el.dataset.id; return openSubview('conversations', 'home');
    case 'select-session': selectedSessionId = el.dataset.id; return render();
    case 'clear-conversation-search': conversationQuery = ''; render(); document.getElementById('conversation-search')?.focus(); return;
    case 'start-conversation': if (chatBusy) return flash('请等待当前回复完成。'); data.activeSessionId = null; chatDraft = ''; inputMode = 'ask'; saveData(data); return open('home');
    case 'delete-session': pendingSessionDeletion = el.dataset.id; deletionReturnFocus = el.id; return render();
    case 'cancel-session-deletion': return cancelSessionDeletion();
    case 'confirm-session-deletion': return deleteConversation();
    case 'continue-session': data.activeSessionId = el.dataset.id; inputMode = 'ask'; saveData(data); return open('home');
    case 'session-visit': return generateConversationCard(el.dataset.id);
    case 'start-visit': return startVisitConversation();
    case 'close-subview': return closeSubview();
    case 'suggest': inputMode = 'ask'; chatDraft = el.dataset.question; render(); return sendChat();
    case 'mode-ask': inputMode = 'ask'; render(); document.getElementById('chat-input')?.focus(); return;
    case 'mode-record': inputMode = 'ask'; render(); document.getElementById('chat-input')?.focus(); return;
    case 'send-chat': return submitHomeInput();
    case 'account': return open('settings');
    case 'model-config': return location.assign('/setup/');
    case 'logout': return native.client.logout().catch(error=>flash(error.message));
    case 'new-chat': if (chatBusy) return; data.activeSessionId = null; chatDraft = ''; inputMode = 'ask'; return persist();
    case 'retry-recovery': {const id=el.dataset.id;if(!id||recoveryRetries.has(id))return;recoveryRetries.add(id);render();try{const receipt=await native.retryRecovery(id);data=loadData();render();await native.wait(receipt.run_id);}catch(error){flash('整理仍未完成，已保存的原文保留。请查看最新状态后重试。');}finally{recoveryRetries.delete(id);data=loadData();render();}return;}
    case 'retry-chat-run': {const id=el.dataset.id;if(actionRetries.has(id)||chatBusy)return;actionRetries.add(id);render();try{await native.retryChatRun(id);}catch(error){flash(error.message||'回复仍未完成，原话已保留。');}finally{actionRetries.delete(id);data=loadData();render();}return;}
    case 'retry-chat-action': {const id=el.dataset.id;if(actionRetries.has(id))return;actionRetries.add(id);render();try{await native.retryAssistantAction(id);}catch(error){flash('这次整理仍未完成，原来的对话已保留。请稍后重试。');}finally{actionRetries.delete(id);data=loadData();render();}return;}
    case 'retry-chat': return sendChat(true);
    case 'save-record': return submitHomeInput();
    case 'voice': return startVoiceInput();
    case 'save-voice': return saveRecord(document.getElementById('voice-text')?.value || '');
    case 'record': selectedRecord = el.dataset.id || selectedRecord; return openSubview('record');
    case 'source': selectedChatSource = false; selectedMedicalSource = false; selectedRecord = el.dataset.id || selectedRecord; return openSubview('source');
    case 'chat-source': selectedChatSource = true; selectedMedicalSource = false; return openSubview('source');
    case 'review': {
      const explicitDocument=data.documents?.find(doc=>doc.source_id===el.dataset.id);if(explicitDocument)return openReview(explicitDocument.source_id,true);
      const context=record(el.dataset.id)||(['record','source','review'].includes(subview)?record(selectedRecord):null);if(context)return openReview(context.id);
      const pending=pendingReviewItems(data)[0];if(pending)return openReview(pending.sourceId,pending.medical);
      const target=data.records.find(r=>r.change_id)||latestRecord();if(!target)return flash('当前没有待核对记录。');return openReview(target.id);
    }
    case 'refresh-review': return openReview(selectedRecord||latestRecord()?.id,false,true);
    case 'refresh-medical': return openReview(data.medical?.source_id,true,true);
    case 'convert-record': {const target=record(selectedRecord);if(target)return saveRecord(target.text,target.id);return;}
    case 'confirm-review': return confirmReview();
    case 'correct': {
      selectedRecord=el.dataset.id||selectedRecord||data.records.find(r=>r.facts?.length)?.id;
      const item=record(selectedRecord);if(!item)return flash('没有找到要修改的记录。');
      editFactId='';editFactRevision=item.record_version;editText=item.summary||item.text||'';
      return openSubview('correct');
    }
    case 'submit-correction': {
      if(editBusy)return;if(!editText.trim())return flash('请填写正确的记录内容。');
      const sourceId=selectedRecord,navigation=navigationRevision;let accepted=false;editBusy=true;render();
      try {
        const receipt=await native.editRecord(sourceId,editText.trim(),editFactId,editFactRevision);
        accepted=true;data=loadData();if(navigation===navigationRevision&&selectedRecord===sourceId){selectedForReview.clear();if(viewStack.at(-1)?.subview==='record')viewStack.pop();subview='record';pushRoute();render();}
        if(receipt.run_id){flash('修改已保存，正在重新整理。');await native.wait(receipt.run_id);}
        data=loadData();flash(data.healthProfile?.overview?.status==='current'?'修改已保存，身体近况已更新。':'修改已保存，可在身体近况查看最新整理状态。');
      } catch(error){if(!accepted)throw error;flash('修改原文已保存，整理未完成。可在记录详情重试。');}
      finally {editBusy=false;data=loadData();render();}
      return;
    }
    case 'conflict': selectedRecord=el.dataset.id||selectedRecord;return openSubview('conflict');
    case 'select-history': return openSubview('history');
    case 'remove-history': data.selectedHistory = data.selectedHistory.filter(id => id !== el.dataset.id); return persist();
    case 'reference': return openSubview('reference');
    case 'generate-card': return generateConversationCard(el.dataset.id||data.activeSessionId);
    case 'regenerate-card': return generateConversationCard(null,true);
    case 'edit-card': cardError='';cardEditor={result_id:data.cardResultId,speech:generatedCardText(),questions:data.questions.join('\n'),unknowns:(data.cardUnknowns||[]).join('\n'),revision:data.cardEditRevision??0};return openSubview('editCard');
    case 'save-card': {
      if(cardSaveBusy)return;
      if(!cardEditor||cardEditor.result_id!==data.cardResultId)return flash('沟通卡已变化，请返回并重新打开编辑。');
      const editor=cardEditor,navigation=navigationRevision;
      if(!editor.speech.trim())return flash('请填写就诊表达稿。');
      cardSaveBusy=true;cardError='';render();
      try{
        await native.saveCardEdit(editor.result_id,editor.speech.trim(),editor.questions.split('\n').map(q=>q.trim()).filter(Boolean),editor.revision,(editor.unknowns||'').split('\n').map(value=>value.trim()).filter(Boolean));
        data=loadData();if(navigation===navigationRevision&&cardEditor===editor)open('card');
        flash('沟通卡修改已跨端保存，健康事实保持不变。');
      }catch(error){cardError=error.code==='REVISION_CONFLICT'?'这张沟通卡已有其他修改，你的编辑已保留。请返回查看最新版本，再重新编辑。':'修改暂未保存成功，输入已保留，请重试。';}
      finally{cardSaveBusy=false;render();}
      return;
    }
    case 'copy-card': try{await navigator.clipboard.writeText(native.copyText());flash('已复制原生成卡、来源和过期标识。');}catch{flash('无法访问剪贴板，可使用打印预览。');}return;
    case 'print-preview': return openSubview('print');
    case 'print': return window.print();
    case 'upload': return openSubview('upload');
    case 'choose-file': filePickerOpen=true;return document.getElementById('file-input')?.click();
    case 'sample-file': return uploadDocument({text:'医嘱：每日记录症状。\n医嘱：三天后复诊。',name:'合成医嘱示例'});
    case 'medical-review': if(el.dataset.id){data.selectedDocumentId=el.dataset.id;saveData(data);data=loadData();}return openReview(data.medical?.source_id,true);
    case 'keep-medical-date': return flash('请逐项选择实际候选；不自动覆盖现有事实。');
    case 'medical-source': selectedChatSource=false;selectedMedicalSource=false;selectedRecord=data.medical?.source_id||null;return openSubview('source');
    case 'confirm-medical': return confirmReview(true);
    case 'task': selectedTask=el.dataset.id||data.tasks?.[0]?.id;return openSubview('task');
    case 'task-done': case 'task-pause': case 'task-resume': {const navigation=navigationRevision,taskId=selectedTask;await native.updateTask(taskId,act==='task-done'?'done':act==='task-pause'?'paused':'pending',Number(el.dataset.version));data=loadData();if(navigation===navigationRevision&&selectedTask===taskId)closeSubview();return flash('事项执行状态已更新。');}
    case 'consent': return openSubview('consent');
    case 'export': return openSubview('export');
    case 'download-export': {
      const payload=await native.client.exportData();const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='HealthThread-account-export.json';a.click();data.exportAt=new Date().toISOString().slice(0,10);saveData(data);setTimeout(()=>URL.revokeObjectURL(url),1000);return flash('当前账号的服务端资料已导出。');
    }
    case 'delete-confirm': deleteAcknowledged = false; return openSubview('deleteConfirm');
    case 'delete-result': return openSubview('deleteResult');
    case 'delete-local': {
      if(!deleteAcknowledged)return;const navigation=navigationRevision;await native.deleteAll();data=loadData();recordDraft='';chatDraft='';selectedForReview.clear();deleteAcknowledged=false;return navigation===navigationRevision?openSubview('deleteResult'):render();
    }
    case 'recover-original': await native.recover(selectedUploadFile);data=loadData();render();return flash('原请求已恢复，没有重复创建资料。');
    case 'retry-care-plan': {
      const runId=el.dataset.id;if(!runId||careRetries.has(runId))return;careRetries.add(runId);render();
      try{const receipt=await native.retryCarePlan(runId);data=loadData();render();await native.wait(receipt.run_id);data=loadData();flash('医嘱解释与诊后事项已更新。');}
      finally{careRetries.delete(runId);data=loadData();render();}return;
    }
    case 'retry-medical': {
      const sourceId=el.dataset.id||data.medical?.source_id;if(!sourceId||medicalRetries.has(sourceId))return;const navigation=navigationRevision;medicalRetries.add(sourceId);render();
      try{const receipt=await native.retryEntry(sourceId);await native.waitDocument(receipt.run_id);data=loadData();if(navigation===navigationRevision&&data.medical?.source_id===sourceId)return await openReview(sourceId,true);}
      finally{medicalRetries.delete(sourceId);data=loadData();render();}return;
    }
    case 'retry-analysis': {const sourceId=selectedRecord,navigation=navigationRevision;const receipt=await native.retryEntry(sourceId);await native.wait(receipt.run_id);data=loadData();if(navigation===navigationRevision&&selectedRecord===sourceId)return openSubview('record');return render();}
    default: return;
  }
}

app.addEventListener('click', event => {
  const target = event.target.closest('[data-act]');
  if (!target || target.disabled) return;
  Promise.resolve(doAction(target.dataset.act,target)).catch(error=>flash(error.message||'操作未完成，请查看原文与回执。'));
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
  if(event.target.id==='profile-correction-text'&&profileEditor)profileEditor.text=event.target.value;
  if(event.target.id==='care-feedback-text')feedbackDrafts[event.target.dataset.task]=event.target.value;
  if (event.target.id === 'conversation-search') {
    const position = event.target.selectionStart;
    conversationQuery = event.target.value;
    render();
    const search = document.getElementById('conversation-search');
    search?.focus();
    if (position !== null) { try { search?.setSelectionRange(position, position); } catch { /* search inputs do not expose selection ranges in every browser */ } }
  }
  if(cardEditor&&event.target.id==='card-draft')cardEditor.speech=event.target.value;
  if(cardEditor&&event.target.id==='card-questions')cardEditor.questions=event.target.value;
  if(cardEditor&&event.target.id==='card-unknowns')cardEditor.unknowns=event.target.value;
  if (event.target.id === 'edit-text') editText = event.target.value;
  if(event.target.id==='medical-text')medicalText=event.target.value;
  if (event.target.id === 'chat-input') { if (inputMode === 'record') recordDraft = event.target.value; else chatDraft = event.target.value; }
  if (event.target.dataset.field === 'reviewDescription') reviewDescription = event.target.value;
  if (event.target.dataset.field === 'editDate') editDate = event.target.value;
  if (event.target.dataset.field === 'editReason') editReason = event.target.value;
  if (['currentConcern', 'recentChange', 'symptomStart'].includes(event.target.dataset.field)) { data[event.target.dataset.field] = event.target.value; saveData(data); }
});
app.addEventListener('change', event => {
  if(event.target.dataset.resolution){reviewChoices[event.target.dataset.resolution]=event.target.value;return;}
  if(event.target.dataset.episode){native.updateEpisode(event.target.dataset.episode,event.target.value,Number(event.target.dataset.version)).then(()=>{data=loadData();render();flash('事件当前状态已更新，历史记录保留。');}).catch(error=>{render();flash(error.message);});return;}
  if (event.target.id === 'edit-fact') {
    const fact=record(selectedRecord)?.facts?.find(f=>f.fact_id===event.target.value);
    if(fact){editFactId=fact.fact_id;editFactRevision=fact.revision;editText=fact.value;render();}
  }
  if (event.target.dataset.review) { event.target.checked ? selectedForReview.add(event.target.dataset.review) : selectedForReview.delete(event.target.dataset.review); render(); }
  if (event.target.dataset.history) { const id = event.target.dataset.history; data.selectedHistory = event.target.checked ? [...new Set([...data.selectedHistory, id])] : data.selectedHistory.filter(x => x !== id); persist(); }
  if(event.target.dataset.consent){const granted=event.target.checked;if(event.target.dataset.consent==='voice'){data.voiceConsent=granted;persist();}else native.setConsent(granted).then(()=>{data=loadData();render();flash(granted?'已授权分析。':'已撤回分析，旧运行停止。');}).catch(error=>flash(error.message));}
  if (event.target.dataset.field === 'impact') { data.impact = event.target.value; persist(); }
  if (event.target.id === 'timeline-filter') { timelineFilter = event.target.value; render(); }
  if (event.target.id === 'timeline-time') { timelineTime = event.target.value; render(); }
  if (event.target.id === 'timeline-issue') { timelineIssue = event.target.value; render(); }
  if (event.target.id === 'delete-ack') { deleteAcknowledged = event.target.checked; render(); }
});

window.addEventListener('popstate', () => { readRoute(); mobileMenu = false; render(); });
readRoute();
render();

window.addEventListener('healththread:state', async () => {
  data = loadData(); reconcileCardCompletion();render();
  const reviewView=subview;
  if(!['review','medicalReview'].includes(reviewView)||reviewSnapshot||confirmBusy)return;
  const target=reviewView==='medicalReview'?data.medical:record(selectedRecord);
  const sourceId=target?.source_id||target?.id,changeId=target?.change_id;
  if(!changeId||reviewLoadingId===changeId)return;
  reviewLoadingId=changeId;
  try {
    const snapshot=await native.client.factChange(changeId);
    const current=reviewView==='medicalReview'?data.medical:record(selectedRecord);
    if(subview===reviewView&&(current?.source_id||current?.id)===sourceId&&current?.change_id===changeId&&snapshot.status!=='confirmed'&&snapshot.status!=='expired') {
      reviewSourceId=sourceId;reviewSnapshot=snapshot;selectedForReview.clear();render();
    }
  } catch(error) {flash(error.message||'读取核对内容失败，请点击刷新核对内容。');}
  finally {if(reviewLoadingId===changeId)reviewLoadingId=null;}
});

window.addEventListener('healththread:sync',event=>flash(event.detail.message||'同步未完成，请恢复原请求。'));
