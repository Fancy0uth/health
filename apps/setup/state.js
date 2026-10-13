export const projectDestination = search => new URLSearchParams(search).get('return') === 'mobile' ? '/mobile/' : '/web/';

export function consumeLaunchToken(location, history) {
  const token = new URLSearchParams(location.hash.slice(1)).get('launch');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
  return token;
}

const errors = {
  LAUNCH_DENIED: '启动链接已失效，请重新打开项目启动器。',
  CSRF_DENIED: '登录状态已变化，请刷新页面后重试。',
  ORIGIN_DENIED: '请从本机项目地址打开配置页面。',
  RATE_LIMITED: '尝试次数较多，请稍后重试。',
  CONFIG_BUSY: '有任务正在处理或配置正在更新，请稍后重试。',
  CONFIG_TICKET_INVALID: '验证已失效，请重新测试连接。',
  CONFIG_REVISION_CONFLICT: '配置已在其他页面更新，请刷新后重新测试连接。',
  CONFIG_KEY_REQUIRED: '请先填写 Agnes API Key。',
  CONFIG_TEST_FAILED: '连接验证失败，请检查 API Key、账号权限和网络后重试。',
  CONFIG_MODEL_UNAVAILABLE: '所选模型当前不可用，请重新测试连接。',
  CONFIG_RUNTIME_FAILED: '配置已保存，但模型服务启动失败。请刷新查看状态，稍后重试。',
  CONFIG_UNAVAILABLE: '此项目暂不支持模型配置，请使用本机项目启动器打开。',
  UNAUTHORIZED: '请先登录项目账号，再打开模型配置。',
  FORBIDDEN: '只有本机项目管理员可以修改模型配置。',
  CONFIG_OWNER_REQUIRED: '只有本机项目管理员可以修改模型配置。',
  INVALID_API_KEY: 'API Key 无效，请检查后重新测试连接。',
  AGNES_AUTH_FAILED: 'Agnes 未接受此 API Key，请检查后重新测试。',
  AGNES_UNAVAILABLE: '暂时无法连接 Agnes，请检查网络后重试。',
  AGNES_TIMEOUT: '连接 Agnes 超时，请稍后重试。',
  NO_MODELS: '此 API Key 暂无可用模型，请检查 Agnes 账号权限。',
  INVALID_MODEL: '请选择连接测试返回的模型。',
  INVALID_TICKET: '验证已失效，请重新测试连接。',
  TICKET_EXPIRED: '验证已过期，请重新测试连接。',
  CONFIG_CONFLICT: '配置已在其他页面更新，请刷新后重新测试连接。',
  REVISION_CONFLICT: '配置已在其他页面更新，请刷新后重新测试连接。',
  RUNTIME_BUSY: '有任务正在处理，请等任务完成后再保存。',
  RUNTIME_UNAVAILABLE: '模型运行服务尚未就绪，请稍后重试。',
  CSRF_INVALID: '登录状态已变化，请刷新页面后重试。',
  INVALID_LAUNCH_TOKEN: '启动链接已失效，请重新打开项目启动器。',
};
export const safeError = error => errors[error?.code] || '暂时无法完成操作，请稍后重试。';
export class SetupSession {
  key = ''; ticket = null; models = []; model = ''; busy = false;
  setKey(value) { if (value !== this.key) { this.key = value; this.ticket = null; this.models = []; this.model = ''; } }
  selectModel(value) { this.model = this.models.some(model => model.id === value) ? value : ''; }
  get canSave() { return !this.busy && !!this.ticket && this.models.some(model => model.id === this.model); }
  async test(request) {
    if (this.busy || !this.key.trim()) return;
    this.busy = true; this.ticket = null; this.models = []; this.model = '';
    const key = this.key;
    try {
      const result = await request(key);
      if (key !== this.key) return;
      const models = (result.models || []).filter(model => typeof model.id === 'string' && model.id);
      if (!result.ticket || !models.length) throw Object.assign(new Error(), {code:'NO_MODELS'});
      this.ticket = result.ticket; this.models = models; this.model = models[0].id;
    } finally { this.busy = false; }
  }
}
