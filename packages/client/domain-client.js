// Active v1 client. Prototype whole-state/data/chat helpers are not imported here.
export class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
}
const empty = () => ({user:null,profile:{profile_revision:null,facts:[],pending_changes:[]},timeline:{entries:[]},tasks:{tasks:[]},consents:{consents:[]},results:[],runs:{},capabilities:null});
const problem = (code, message, extra = {}) => Object.assign(new Error(message), {code,...extra});
const clone = value => structuredClone(value);
const identityChanged = () => problem('SESSION_CHANGED','登录或资料权限已变化，旧请求已停止。请重新登录或读取当前账号；原请求不会提交给新账号。');
async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256',typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export class DomainClient {
  constructor({fetchImpl=globalThis.fetch,storage=globalThis.localStorage || new MemoryStorage(),channel=undefined,pollMs=600,timeoutMs=15000}={}) {
    this.fetchImpl=fetchImpl.bind(globalThis); this.storage=storage; this.pollMs=pollMs; this.timeoutMs=timeoutMs;
    this.state=empty(); this.csrf=null; this.sessionEpoch=null; this.generation=0;
    this.listeners=new Set(); this.drafts={}; this.operations=[]; this.controllers=new Set(); this.refreshSequence=0;
    this.sender=crypto.randomUUID(); this.channel=channel===undefined && typeof window!=='undefined' && typeof BroadcastChannel!=='undefined'?new BroadcastChannel('healththread-domain-v1'):channel;
    this.onBroadcast=event=>{
      const message=event.data;
      if (!message || message.sender===this.sender) return;
      if (message.type==='identity') this.invalidate('external-session');
      else if (message.user===this.state.user?.id && message.type==='scope') {if(message.clearDrafts) this.clearLocalHealth();this.invalidateScope();}
      else if (message.user===this.state.user?.id && message.type==='refresh') this.refresh().catch(error=>this.emit({type:'error',error}));
    };
    this.channel?.addEventListener('message',this.onBroadcast);
    this.onStorage=event=>{ if(event.key==='healththread-domain-event'&&event.newValue) { try {this.onBroadcast({data:JSON.parse(event.newValue)});} catch {} } };
    globalThis.window?.addEventListener('storage',this.onStorage);
  }
  subscribe(listener) { this.listeners.add(listener); return ()=>this.listeners.delete(listener); }
  emit(event={type:'state'}) { for(const listener of this.listeners) listener(event); }
  broadcast(type,details={}) {
    const event={...details,type,user:this.state.user?.id||null,sender:this.sender,nonce:crypto.randomUUID()};
    this.channel?.postMessage(event);
    try {this.storage.setItem('healththread-domain-event',JSON.stringify(event));} catch {}
  }
  key(kind) { return `healththread-domain:${kind}:${this.state.user?.id}:${this.sessionEpoch}`; }
  persist() {
    if(!this.state.user) return;
    try { this.storage.setItem(this.key('drafts'),JSON.stringify(this.drafts)); this.storage.setItem(this.key('operations'),JSON.stringify(this.operations.map(({file,...op})=>({...op,body:op.state==='resolved'?undefined:op.body,file_required:op.state==='resolved'?false:!!file||op.file_required})))); }
    catch { this.emit({type:'storage',message:'本机草稿存储空间不足；当前页面仍保留输入，请保持页面打开。'}); }
  }
  restore() {
    try {this.drafts=JSON.parse(this.storage.getItem(this.key('drafts'))||'{}');this.operations=JSON.parse(this.storage.getItem(this.key('operations'))||'[]');for(const op of this.operations) if(op.state==='sending') op.state='unknown';} catch {this.drafts={};this.operations=[];}
  }
  setDraft(name,value) { if(!this.state.user) return; this.drafts[name]=clone(value); this.persist(); }
  getDraft(name,fallback='') { return clone(this.drafts[name]??fallback); }
  clearDraftIf(name,original) { if(JSON.stringify(this.drafts[name])===JSON.stringify(original)) {delete this.drafts[name];this.persist();} }
  pendingOperations() { return this.operations.filter(op=>['unknown','sending'].includes(op.state)).map(op=>clone({...op,file:undefined})); }
  ticket() { if(!this.state.user) throw problem('AUTH_REQUIRED','请先登录。',{status:401});return {generation:this.generation,user:this.state.user.id,epoch:this.sessionEpoch,csrf:this.csrf,consentVersion:this.state.consents.consents.find(c=>c.purpose==='analysis')?.version}; }
  check(ticket) { if(ticket.generation!==this.generation||ticket.user!==this.state.user?.id||ticket.epoch!==this.sessionEpoch||ticket.csrf!==this.csrf) throw identityChanged(); }
  clearLocalHealth() {
    const owner=this.state.user?.id;
    for(let index=this.storage.length-1;index>=0;index--) {const key=this.storage.key(index);if(key?.startsWith('healththread-domain:')&&key.includes(':'+owner+':')) this.storage.removeItem(key);}
    this.drafts={};this.operations=[];
  }
  invalidateScope() {
    this.generation++;for(const controller of this.controllers) controller.abort();this.controllers.clear();
    this.state={...empty(),user:this.state.user,capabilities:this.state.capabilities};this.emit({type:'scope'});
  }
  invalidate(reason='session') {
    // Health projections are never persisted. Remove active-session drafts on logout/switch;
    // unresolved original requests stay quarantined under their original owner+session hash.
    if(this.state.user&&this.sessionEpoch) {try {this.storage.removeItem(this.key('drafts'));} catch {}}
    this.generation++;for(const controller of this.controllers) controller.abort();this.controllers.clear();
    this.state=empty();this.csrf=null;this.sessionEpoch=null;this.drafts={};this.operations=[];
    this.emit({type:'identity',reason});
  }
  async raw(path,{method='GET',body,headers={},signal}={}) {
    const controller=new AbortController(); this.controllers.add(controller);
    const timer=setTimeout(()=>controller.abort(problem('REQUEST_TIMEOUT','请求超时。')),this.timeoutMs);
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal;
    const isForm=typeof FormData!=='undefined'&&body instanceof FormData;
    try {
      const response=await this.fetchImpl(path,{method,credentials:'same-origin',headers:{...(body!==undefined&&!isForm?{'Content-Type':'application/json'}:{}),...headers},body:body===undefined?undefined:isForm?body:JSON.stringify(body),signal:combined});
      const payload=await response.json();
      if(!response.ok) throw problem(payload.error?.code||'REQUEST_FAILED',payload.error?.message||'请求未完成。',{status:response.status,...payload.error});
      return payload;
    } finally {clearTimeout(timer);this.controllers.delete(controller);}
  }
  async bootstrapIdentity() {
    const generation=this.generation;const me=await this.raw('/api/me');
    if(generation!==this.generation) throw identityChanged();
    if(!me.user) {this.invalidate();return null;}
    const epoch=await fingerprint(me.csrf_token);
    if(generation!==this.generation) throw identityChanged();
    if(this.state.user&&(this.state.user.id!==me.user.id||this.csrf!==me.csrf_token)) {this.invalidate();throw identityChanged();}
    this.state.user=me.user;this.csrf=me.csrf_token;this.sessionEpoch=epoch;this.restore();this.emit();return me;
  }
  async initialize() { await this.bootstrapIdentity();const capabilities=await this.raw('/api/capabilities');this.state.capabilities=capabilities;if(this.state.user) await this.refresh();else this.emit();return this.state; }
  async login(username,password) {
    this.invalidate();const generation=this.generation;
    const me=await this.raw('/api/auth/login',{method:'POST',body:{username,password}});
    if(generation!==this.generation) throw identityChanged();
    const epoch=await fingerprint(me.csrf_token);if(generation!==this.generation) throw identityChanged();
    this.state.user=me.user;this.csrf=me.csrf_token;this.sessionEpoch=epoch;this.restore();this.broadcast('identity');this.emit();return this.refresh();
  }
  async verifySession(ticket) {
    this.check(ticket);const me=await this.raw('/api/me');this.check(ticket);
    if(me.user?.id!==ticket.user||me.csrf_token!==ticket.csrf) {this.invalidate('external-session');throw identityChanged();}
    return me;
  }
  async verifyReadScope(ticket) {
    this.check(ticket);
    if(ticket.consentVersion!==undefined) {const current=await this.raw('/api/consents');this.check(ticket);if(current.consents.find(c=>c.purpose==='analysis')?.version!==ticket.consentVersion) {this.invalidateScope();throw identityChanged();}}
  }
  async read(path,ticket=this.ticket()) {
    this.check(ticket);try {const before=await this.verifySession(ticket);await this.verifyReadScope(ticket);const value=await this.raw(path);this.check(ticket);const after=await this.verifySession(ticket);await this.verifyReadScope(ticket);if(before.profile_revision!==after.profile_revision) throw problem('PROFILE_CHANGED','资料版本在读取期间变化，请重新读取；输入已保留。');return value;} catch(error) {this.check(ticket);if(error.status===401){this.invalidate();throw identityChanged();}throw error;}
  }
  async refresh() {
    const ticket=this.ticket(),sequence=++this.refreshSequence;
    await this.verifySession(ticket);
    const [profile,timeline,tasks,consents,projection,capabilities]=await Promise.all(['/api/profile','/api/timeline','/api/care-tasks','/api/consents','/api/state','/api/capabilities'].map(path=>this.read(path,ticket)));
    const current=await this.verifySession(ticket);this.check(ticket);
    if(profile.profile_revision!==current.profile_revision) throw problem('PROFILE_CHANGED','资料版本已变化，请重新读取；输入已保留。');
    if(sequence!==this.refreshSequence) return this.state;
    const sourceIds=new Set(timeline.entries.map(entry=>entry.source_id));
    if(this.state.timeline.entries.some(entry=>!sourceIds.has(entry.source_id))) this.invalidateScope();
    // Drafts never come from GET/poll responses, regardless of focus or edits.
    this.state={...this.state,profile,timeline,tasks,consents,results:projection.state.cardRecords||[],capabilities};this.emit();return this.state;
  }
  async logout() {const ticket=this.ticket();await this.verifySession(ticket);await this.raw('/api/auth/logout',{method:'POST',body:{},headers:{'X-CSRF-Token':ticket.csrf}});this.broadcast('identity');this.invalidate('logout');}
  async submit(slot,path,body,method='POST',file=null) {
    const ticket=this.ticket();await this.verifySession(ticket);
    if(this.operations.some(op=>op.slot===slot&&['unknown','sending'].includes(op.state))) throw problem('UNRESOLVED_OPERATION','前次请求结果未知。请先用原请求查询 / 重试回执，当前输入已保留。');
    const op={id:crypto.randomUUID(),key:crypto.randomUUID(),slot,path,method,body:clone(body),owner:ticket.user,epoch:ticket.epoch,state:'sending',created_at:new Date().toISOString(),file};
    this.operations.push(op);this.persist();this.emit({type:'operation'});return this.execute(op,ticket);
  }
  async execute(op,ticket) {
    this.check(ticket);if(op.owner!==ticket.user||op.epoch!==ticket.epoch) throw identityChanged();
    let body=clone(op.body);
    if(op.file_required&&!op.file) throw problem('ORIGINAL_FILE_REQUIRED','原上传结果未知。请重新选择同一个文件核对指纹后重试原请求。');
    if(op.file) {body=new FormData();body.set('file',op.file);}
    op.state='sending';this.persist();
    try {
      const outcome=await this.raw(op.path,{method:op.method,body,headers:{'X-CSRF-Token':ticket.csrf,'Idempotency-Key':op.key}});
      this.check(ticket);await this.verifySession(ticket);op.state='resolved';op.outcome=outcome;
      this.persist();this.broadcast('refresh');this.emit({type:'operation',operation:op});return outcome;
    } catch(error) {
      this.check(ticket);op.state=error.status&&error.status<500?'rejected':'unknown';
      op.error={code:error.code||'NETWORK_ERROR',message:error.message,status:error.status,phase:error.phase,request_id:error.request_id};this.persist();this.emit({type:'operation',operation:op});
      if(op.state==='unknown') throw problem('OUTCOME_UNKNOWN','请求结果未知，原文与原请求键已保留。请核对回执或重试原请求，勿重复创建。',{operation_id:op.id,cause:error});
      throw error;
    }
  }
  async retryOperation(id,file=null) {
    const op=this.operations.find(op=>op.id===id);if(!op) throw problem('OPERATION_MISSING','当前会话没有该原请求。');
    const ticket=this.ticket();await this.verifySession(ticket);
    if(op.owner!==ticket.user||op.epoch!==ticket.epoch) throw identityChanged();
    if(op.state==='resolved') return clone(op.outcome);
    if(file) {const metadata=await this.fileMetadata(file);this.check(ticket);if(JSON.stringify(metadata)!==JSON.stringify(op.body.file)) throw problem('ORIGINAL_FILE_MISMATCH','所选文件与原请求不同，不能使用原请求键提交。');op.file=file;}
    return this.execute(op,ticket);
  }
  async fileMetadata(file) {return {name:file.name,type:file.type,size:file.size,sha256:await fingerprint(await file.arrayBuffer())};}
  createEntry(text) {return this.submit('entry','/api/entries',{text,input_kind:'self_report'});}
  async createDocument({text,name,file}={}) { if(file) return this.submit('document','/api/documents',{file:await this.fileMetadata(file)},'POST',file);return this.submit('document','/api/documents',{text,name}); }
  createVisit(currentConcern,sourceIds) {return this.submit('visit','/api/visit-preparations',{current_concern:currentConcern,selected_source_ids:[...sourceIds]});}
  factChange(id) {return this.read('/api/fact-changes/'+encodeURIComponent(id));}
  source(id) {return this.read('/api/sources/'+encodeURIComponent(id));}
  operation(id) {return this.read('/api/operations/'+encodeURIComponent(id));}
  confirm(id,ids,revision) {return this.submit('confirm:'+id,'/api/fact-changes/'+encodeURIComponent(id)+'/confirm',{accepted_change_ids:[...ids],expected_profile_revision:revision});}
  reject(id,revision) {return this.submit('reject:'+id,'/api/fact-changes/'+encodeURIComponent(id)+'/reject',{expected_profile_revision:revision});}
  reanalyse(id,revision) {return this.submit('reanalyse:'+id,'/api/runs/'+encodeURIComponent(id)+'/reanalyse',{expected_profile_revision:revision});}
  retryRun(id) {return this.submit('retry:'+id,'/api/runs/'+encodeURIComponent(id)+'/retry',{});}
  changeFact(fact,kind,text) {return this.submit('change:'+fact.fact_id,'/api/facts/'+encodeURIComponent(fact.fact_id)+'/change-requests',{kind,text,expected_version:fact.revision});}
  async mutate(path,method,body) {
    const ticket=this.ticket();await this.verifySession(ticket);const value=await this.raw(path,{method,body,headers:{'X-CSRF-Token':ticket.csrf}});this.check(ticket);await this.verifySession(ticket);this.broadcast('refresh');return value;
  }
  async updateTask(id,status,version) {const value=await this.mutate('/api/care-tasks/'+encodeURIComponent(id),'PATCH',{status,expected_version:version});await this.refresh();return value;}
  async setConsent(granted) {
    const consents=await this.read('/api/consents');const version=consents.consents.find(c=>c.purpose==='analysis')?.version;
    const value=await this.mutate('/api/consents','PATCH',{purpose:'analysis',granted,expected_version:version});
    this.broadcast('scope');this.invalidateScope();await this.refresh();return value;
  }
  async deleteData(sourceId='all') {
    const value=await this.submit('delete:'+sourceId,'/api/data/'+encodeURIComponent(sourceId),{},'DELETE');
    if(sourceId==='all') this.clearLocalHealth();else {this.operations=this.operations.filter(op=>op.outcome?.source_id!==sourceId);this.persist();}
    this.broadcast('scope',{clearDrafts:sourceId==='all'});this.invalidateScope();await this.refresh();return value;
  }
  exportData() {return this.read('/api/export');}
  async cancelRun(id) {const value=await this.mutate('/api/runs/'+encodeURIComponent(id)+'/cancel','POST',{});this.state.runs[id]=value;this.emit();return value;}
  async pollRun(id,{signal,deadlineMs=130000}={}) {
    const ticket=this.ticket(),deadline=Date.now()+deadlineMs;
    while(Date.now()<deadline) {
      signal?.throwIfAborted();await this.verifySession(ticket);const run=await this.read('/api/runs/'+encodeURIComponent(id),ticket);
      if(run.fact_change_id) run.change=await this.read('/api/fact-changes/'+encodeURIComponent(run.fact_change_id),ticket);
      if(run.result_id||run.result_ref) run.result=await this.read('/api/results/'+encodeURIComponent(run.result_id||run.result_ref),ticket);
      this.check(ticket);this.state.runs[id]=run;this.emit({type:'run',run});
      if(!['queued','running'].includes(run.status)) {await this.refresh();return run;}
      await new Promise((resolve,reject)=>{const timer=setTimeout(done,this.pollMs);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason);}signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted) abort();});
      this.check(ticket);
    }
    throw problem('POLL_TIMEOUT','原文已保存，仍未取得最终状态；稍后读取该任务，不会自动重放或取消。',{run_id:id});
  }
  dispose() {this.generation++;for(const c of this.controllers)c.abort();this.channel?.removeEventListener('message',this.onBroadcast);this.channel?.close?.();globalThis.window?.removeEventListener('storage',this.onStorage);this.listeners.clear();}
}
