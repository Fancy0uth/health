import {SetupSession, consumeLaunchToken, safeError, projectDestination} from './state.js';
let launchToken = consumeLaunchToken(location, history);
const $ = id => document.getElementById(id);
const destination = projectDestination(location.search);
$('enter-project').href = destination;
const session = new SetupSession();
let csrf = '', config = null, saving = false;
const show = (id, visible) => { $(id).hidden = !visible; };
function notice(message, error = false) {
  $('notice').textContent = message; $('notice').classList.toggle('error', error); show('notice', !!message);
}
async function api(path, body) {
  let response;
  try { response = await fetch(path, {method:body === undefined ? 'GET' : 'POST', credentials:'same-origin', cache:'no-store', headers:body === undefined ? {} : {'Content-Type':'application/json', 'X-CSRF-Token':csrf}, ...(body === undefined ? {} : {body:JSON.stringify(body)})}); }
  catch { throw {code:'AGNES_UNAVAILABLE'}; }
  let data; try { data = await response.json(); } catch { throw {code:'UNKNOWN'}; }
  if (!response.ok) throw {code:data.error?.code || data.code || data.error_code || (response.status === 401 ? 'UNAUTHORIZED' : response.status === 403 ? 'FORBIDDEN' : 'UNKNOWN')};
  return data;
}
function controls() {
  const busy = session.busy || saving;
  $('api-key').disabled = busy;
  $('test').disabled = busy || !session.key.trim();
  $('test').textContent = session.busy ? '正在连接 Agnes…' : '测试连接并获取模型';
  $('model').disabled = busy || !session.ticket;
  $('save').disabled = busy || !session.canSave;
  $('save').textContent = saving ? '正在保存并启用…' : '保存并进入项目';
  $('cancel').disabled = busy;
}
function modelOptions() {
  $('model').replaceChildren();
  if (!session.models.length) $('model').append(new Option('请先测试连接', ''));
  for (const model of session.models) $('model').append(new Option(model.name ? `${model.name} · ${model.id}` : model.id, model.id));
  $('model').value = session.model; controls();
}
function editing(visible) {
  session.setKey(''); $('api-key').value = ''; modelOptions(); notice('');
  show('config-form', visible && config.can_manage); show('configured-actions', !!config.configured && !visible);
  show('change', !!config.can_manage); show('cancel', !!config.configured);
  if (visible) $('api-key').focus();
}
$('api-key').addEventListener('input', event => { session.setKey(event.target.value); modelOptions(); notice(''); });
$('model').addEventListener('change', event => { session.selectModel(event.target.value); controls(); });
$('change').addEventListener('click', () => editing(true));
$('cancel').addEventListener('click', () => editing(false));
$('test').addEventListener('click', async () => {
  if (session.busy || saving || !session.key.trim()) return;
  notice('正在验证 API Key 并获取可用模型…');
  const pending = session.test(apiKey => api('/api/model-config/test', {api_key:apiKey})); controls();
  try { await pending; modelOptions(); notice(`连接成功，找到 ${session.models.length} 个可用模型。请选择模型后保存。`); }
  catch (error) { notice(safeError(error), true); modelOptions(); }
  finally { controls(); }
});
$('config-form').addEventListener('submit', async event => {
  event.preventDefault(); if (!session.canSave || saving || !config.can_manage) return;
  saving = true; controls(); notice('正在保存配置并启用模型…');
  try {
    await api('/api/model-config/save', {ticket:session.ticket, model:session.model, expected_revision:config.revision});
    session.setKey(''); $('api-key').value = ''; location.assign(destination);
  } catch (error) {
    if (['INVALID_TICKET','TICKET_EXPIRED','CONFIG_CONFLICT','REVISION_CONFLICT','CONFIG_TICKET_INVALID','CONFIG_REVISION_CONFLICT','CONFIG_MODEL_UNAVAILABLE','CONFIG_RUNTIME_FAILED'].includes(error.code)) {session.ticket=null;modelOptions();}
    notice(safeError(error), true);
  } finally { saving = false; controls(); }
});
async function init() {
  try {
    if (launchToken) {
      const token = launchToken; launchToken = null;
      await api('/api/auth/launch', {token});
    }
    const me = await api('/api/me');
    if (!me.user) throw {code:'UNAUTHORIZED'};
    csrf = me.csrf_token || '';
    config = await api('/api/model-config');
    $('eyebrow').textContent = config.configured ? '项目设置' : '首次设置';
    $('status-chip').textContent = config.configured ? '已配置' : '待配置';
    $('status-chip').classList.toggle('ready', !!config.configured);
    show('current', !!config.configured); $('current-model').textContent = config.model || '未选择';
    $('runtime-status').textContent = ({ready:'模型服务已就绪',starting:'模型服务正在启动',error:'模型服务启动失败，请重新配置或稍后重试。',unavailable:'模型服务暂不可用，请使用本机项目启动器打开。'})[config.runtime_status] || '';
    if (['error','unavailable'].includes(config.runtime_status)) $('status-chip').textContent = '服务未就绪';
    show('readonly', !config.can_manage);
    editing(!config.configured);
    if (config.error_code) notice(safeError({code:config.error_code}), true);
  } catch (error) {
    $('status-chip').textContent = error.code === 'UNAUTHORIZED' ? '请先登录' : '暂不可用';
    notice(safeError(error), true); show('signed-out', error.code === 'UNAUTHORIZED');
  } finally { show('loading', false); }
}
init();
