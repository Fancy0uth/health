// Active v1 client. Prototype whole-state/data/chat helpers are not imported here.
export class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
}
const empty = () => ({user:null,profile:{profile_revision:null,facts:[],pending_changes:[]},timeline:{entries:[]},tasks:{tasks:[]},consents:{consents:[]},results:[],recordThreads:[],runs:{},runPage:{next_cursor:null,initialized:false},documents:{documents:[],next_cursor:null,initialized:false},capabilities:null});
const problem = (code, message, extra = {}) => Object.assign(new Error(message), {code,...extra});
const EPOCH=Symbol('server-epoch');
const clone = value => structuredClone(value);
const identityChanged = () => problem('SESSION_CHANGED','登录或资料权限已变化，旧请求已停止。请重新登录或读取当前账号；原请求不会提交给新账号。');
async function fingerprint(value) {
  const bytes = await crypto.subtle.digest('SHA-256',typeof value === 'string' ? new TextEncoder().encode(value) : value);
  return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
export class DomainClient {
  constructor({fetchImpl=globalThis.fetch,storage=globalThis.localStorage || new MemoryStorage(),channel=undefined,pollMs=600,timeoutMs=15000}={}) {
    this.fetchImpl=fetchImpl.bind(globalThis); this.storage=storage; this.pollMs=pollMs; this.timeoutMs=timeoutMs;
    this.state=empty(); this.csrf=null; this.sessionEpoch=null; this.generation=0;this.scopeEpoch=null;this.allClearEpoch=null;
    this.listeners=new Set(); this.drafts={}; this.operations=[]; this.controllers=new Set(); this.refreshSequence=0;this.refreshFlight=null;this.settledRuns=new Map();
    this.sender=crypto.randomUUID(); this.channel=channel===undefined && typeof window!=='undefined' && typeof BroadcastChannel!=='undefined'?new BroadcastChannel('healththread-domain-v1'):channel;
    this.onBroadcast=event=>{
      const message=event.data;
      if (!message || message.sender===this.sender) return;
      if (message.type==='identity') this.invalidate('external-session');
      else if (message.user===this.state.user?.id && message.type==='scope') {
        if(message.scopeEpoch) this.observeServerScope({scope_epoch:message.scopeEpoch,all_clear_epoch:message.allClearEpoch});
        else {if(message.clearDrafts)this.clearLocalHealth();this.invalidateScope();}
        if(message.sourceId&&message.sourceId!=='all')this.removeSelectedSource(message.sourceId);
        this.refresh().catch(error=>this.emit({type:'error',error}));
      }
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
  deletionRecoveryKey() {return `healththread-delete-recovery:${this.state.user?.id}:${this.sessionEpoch}`;}
  deletionHandles(operations=this.operations) {
    return operations.filter(op=>op.method==='DELETE'&&['unknown','sending'].includes(op.state)).map(op=>({id:op.id,key:op.key,slot:op.slot,path:op.path,method:op.method,owner:op.owner,epoch:op.epoch,scopeEpoch:op.scopeEpoch,allClearEpoch:op.allClearEpoch,state:op.state,created_at:op.created_at,body:{}}));
  }
  restoreDeletionHandles() {
    // Load only the authenticated owner/session's opaque handles before all-clear cleanup.
    // Health drafts and body journals remain unread until the scope watermark is checked.
    try {const stored=JSON.parse(this.storage.getItem(this.deletionRecoveryKey())||'[]');this.operations=Array.isArray(stored)?this.deletionHandles(stored).filter(op=>op.owner===this.state.user.id&&op.epoch===this.sessionEpoch):[];}catch{this.operations=[];}
  }
  persistDeletionHandles() {
    const handles=this.deletionHandles();
    if(handles.length) this.storage.setItem(this.deletionRecoveryKey(),JSON.stringify(handles));else this.storage.removeItem(this.deletionRecoveryKey());
  }
  persist() {
    if(!this.state.user) return;
    try {
      if(Object.keys(this.drafts).length)this.storage.setItem(this.key('drafts'),JSON.stringify(this.drafts));else this.storage.removeItem(this.key('drafts'));
      const journal=this.operations.filter(op=>op.method!=='DELETE').map(({file,...op})=>({...op,body:op.state==='resolved'?undefined:op.body,file_required:op.state==='resolved'?false:!!file||op.file_required}));
      if(journal.length)this.storage.setItem(this.key('operations'),JSON.stringify(journal));else this.storage.removeItem(this.key('operations'));
      this.persistDeletionHandles();
    } catch {this.emit({type:'storage',message:'本机草稿存储空间不足；当前页面仍保留输入，请保持页面打开。'});}
  }
  restore() {
    try {this.drafts=JSON.parse(this.storage.getItem(this.key('drafts'))||'{}');this.operations=[...JSON.parse(this.storage.getItem(this.key('operations'))||'[]'),...JSON.parse(this.storage.getItem(this.deletionRecoveryKey())||'[]')];for(const op of this.operations)if(op.state==='sending')op.state='unknown';}catch{this.drafts={};this.operations=[];}
  }
  setDraft(name,value) { if(!this.state.user) return; this.drafts[name]=clone(value); this.persist(); }
  getDraft(name,fallback='') { return clone(this.drafts[name]??fallback); }
  clearDraftIf(name,original) { if(JSON.stringify(this.drafts[name])===JSON.stringify(original)) {delete this.drafts[name];this.persist();} }
  pendingOperations() { return this.operations.filter(op=>['unknown','sending'].includes(op.state)).map(op=>clone({...op,file:undefined})); }
  ticket() { if(!this.state.user) throw problem('AUTH_REQUIRED','请先登录。',{status:401});return {generation:this.generation,user:this.state.user.id,epoch:this.sessionEpoch,csrf:this.csrf,scopeEpoch:this.scopeEpoch,allClearEpoch:this.allClearEpoch,consentVersion:this.state.consents.consents.find(c=>c.purpose==='analysis')?.version}; }
  check(ticket) { if(ticket.generation!==this.generation||ticket.user!==this.state.user?.id||ticket.epoch!==this.sessionEpoch||ticket.csrf!==this.csrf) throw identityChanged(); }
  clearLocalHealth() {
    const handles=this.deletionHandles();
    const owner=this.state.user?.id;
    for(let index=this.storage.length-1;index>=0;index--) {const key=this.storage.key(index);if(key?.startsWith('healththread-domain:')&&key.includes(':'+owner+':')) this.storage.removeItem(key);}
    this.drafts={};this.operations=handles;
    try{this.persistDeletionHandles();}catch{}
  }
  epochHeaders(epoch) {
    if(!Number.isSafeInteger(epoch)||epoch<1) throw problem('EPOCH_REQUIRED','服务端资料范围尚未取得，请重新读取当前账号；旧请求不会更换范围后提交。',{status:428});
    return {'X-HealthThread-Epoch':String(epoch)};
  }
  observeServerScope(me) {
    if(!Number.isSafeInteger(me.scope_epoch)||me.scope_epoch<1||!Number.isSafeInteger(me.all_clear_epoch)||me.all_clear_epoch<0) throw problem('EPOCH_REQUIRED','服务端未提供资料范围，请刷新并确认服务版本。',{status:428});
    const marker='healththread-domain:epochs:'+this.state.user.id;let recorded={};try{recorded=JSON.parse(this.storage.getItem(marker)||'{}');}catch{}
    const scope=Math.max(this.scopeEpoch||0,recorded.scopeEpoch||0),clear=Math.max(this.allClearEpoch||0,recorded.allClearEpoch||0);
    if(me.scope_epoch<scope||me.all_clear_epoch<clear) throw problem('STALE_SCOPE','收到较旧的资料范围，已忽略；请重新读取当前资料。');
    // Another tab may have persisted the new watermark while this tab still holds old
    // drafts in memory. Use this tab's own observation for cleanup, the max for monotonicity.
    const cleared=me.all_clear_epoch>(this.allClearEpoch??(recorded.allClearEpoch||0));const changed=this.scopeEpoch!==null&&me.scope_epoch!==this.scopeEpoch;
    if(cleared)this.clearLocalHealth();
    this.scopeEpoch=me.scope_epoch;this.allClearEpoch=me.all_clear_epoch;
    try{this.storage.setItem(marker,JSON.stringify({scopeEpoch:me.scope_epoch,allClearEpoch:me.all_clear_epoch}));}catch{}
    if(changed||cleared) this.invalidateScope();
    return changed||cleared;
  }
  reconcileSelections(allowed) {
    if(!Array.isArray(this.drafts.selectedSources)) return;
    const previous=this.drafts.selectedSources;const selected=previous.filter(id=>allowed.has(id));
    if(selected.length!==previous.length) {this.drafts.selectedSources=selected;this.persist();this.emit({type:'selection-pruned',count:previous.length-selected.length});}
  }
  removeSelectedSource(id) {
    if(Array.isArray(this.drafts.selectedSources)) this.reconcileSelections(new Set(this.drafts.selectedSources.filter(value=>value!==id)));
  }
  invalidateScope() {
    this.refreshFlight=null;this.settledRuns.clear();
    this.generation++;for(const controller of this.controllers) controller.abort();this.controllers.clear();
    this.state={...empty(),user:this.state.user,capabilities:this.state.capabilities};this.emit({type:'scope'});
  }
  invalidate(reason='session') {
    this.refreshFlight=null;this.settledRuns.clear();
    // Health projections are never persisted. Remove active-session drafts on logout/switch;
    // unresolved original requests stay quarantined under their original owner+session hash.
    if(this.state.user&&this.sessionEpoch) {try {this.storage.removeItem(this.key('drafts'));} catch {}}
    this.generation++;for(const controller of this.controllers) controller.abort();this.controllers.clear();
    this.state=empty();this.csrf=null;this.sessionEpoch=null;this.scopeEpoch=null;this.allClearEpoch=null;this.drafts={};this.operations=[];
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
      if(response.ok&&payload&&typeof payload==='object'&&response.headers?.get('X-HealthThread-Epoch')) Object.defineProperty(payload,EPOCH,{value:{scope_epoch:Number(response.headers.get('X-HealthThread-Epoch')),all_clear_epoch:Number(response.headers.get('X-HealthThread-All-Clear-Epoch'))}});
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
    this.state.user=me.user;this.csrf=me.csrf_token;this.sessionEpoch=epoch;this.restoreDeletionHandles();this.observeServerScope(me);this.restore();this.emit();return me;
  }
  async initialize() { await this.bootstrapIdentity();const capabilities=await this.raw('/api/capabilities');this.state.capabilities=capabilities;if(this.state.user) await this.refresh();else this.emit();return this.state; }
  async login(username,password) {
    this.invalidate();const generation=this.generation;
    const me=await this.raw('/api/auth/login',{method:'POST',body:{username,password}});
    if(generation!==this.generation) throw identityChanged();
    const epoch=await fingerprint(me.csrf_token);if(generation!==this.generation) throw identityChanged();
    this.state.user=me.user;this.csrf=me.csrf_token;this.sessionEpoch=epoch;this.restoreDeletionHandles();this.observeServerScope(me);this.restore();this.broadcast('identity');this.emit();return this.refresh();
  }
  async verifySession(ticket,{scope=true}={}) {
    this.check(ticket);const me=await this.raw('/api/me');this.check(ticket);
    if(me.user?.id!==ticket.user||me.csrf_token!==ticket.csrf) {this.invalidate('external-session');throw identityChanged();}
    if(scope&&this.observeServerScope(me)) throw identityChanged();
    return me;
  }
  async verifyReadScope(ticket) {
    this.check(ticket);
    if(ticket.consentVersion!==undefined) {const current=await this.raw('/api/consents');this.check(ticket);if(current.consents.find(c=>c.purpose==='analysis')?.version!==ticket.consentVersion) {this.invalidateScope();throw identityChanged();}}
  }
  async read(path,ticket=this.ticket()) {
    this.check(ticket);try {const before=await this.verifySession(ticket);await this.verifyReadScope(ticket);const value=await this.raw(path);this.check(ticket);const after=await this.verifySession(ticket);await this.verifyReadScope(ticket);if(before.profile_revision!==after.profile_revision) throw problem('PROFILE_CHANGED','资料版本在读取期间变化，请重新读取；输入已保留。');return value;} catch(error) {this.check(ticket);if(error.status===401){this.invalidate();throw identityChanged();}throw error;}
  }
  refresh() {
    const ticket=this.ticket();
    if(this.refreshFlight?.generation===ticket.generation) return this.refreshFlight.promise;
    const promise=this.refreshCanonical(ticket);
    const flight={generation:ticket.generation,promise};this.refreshFlight=flight;
    promise.finally(()=>{if(this.refreshFlight===flight) this.refreshFlight=null;}).catch(()=>{});
    return promise;
  }
  async refreshCanonical(ticket) {
    const initial=await this.verifySession(ticket,{scope:false});
    if(this.observeServerScope(initial)) ticket=this.ticket();
    await this.verifyReadScope(ticket);
    let values;
    try {values=await Promise.all(['/api/profile','/api/timeline','/api/care-tasks','/api/consents','/api/state','/api/capabilities','/api/runs?limit=100','/api/documents?limit=100'].map(path=>this.raw(path)));}
    catch(error) {this.check(ticket);throw error;}
    this.check(ticket);
    const [profile,timeline,tasks,consents,projection,capabilities,listed,documents]=values;
    const current=await this.verifySession(ticket);await this.verifyReadScope(ticket);this.check(ticket);
    if(profile.profile_revision!==current.profile_revision) throw problem('PROFILE_CHANGED','资料版本已变化，请重新读取；输入已保留。');
    const sourceIds=new Set(timeline.entries.map(entry=>entry.source_id));
    if(this.state.timeline.entries.some(entry=>!sourceIds.has(entry.source_id))) this.invalidateScope();
    this.reconcileSelections(sourceIds);
    const newRuns=listed.runs.some(run=>!this.state.runs[run.id]);
    const runCursor=this.state.runPage.initialized&&!newRuns?this.state.runPage.next_cursor:listed.next_cursor;
    const runs={};
    for(const run of listed.runs) {const prior=this.state.runs[run.id];runs[run.id]=prior&&this.runSignature(prior)===this.runSignature(run)?{...prior,...run}:run;}
    // Older loaded pages remain only while their sources still exist; current list wins.
    for(const run of Object.values(this.state.runs)) if(!runs[run.id]&&run.source_ids?.every(id=>sourceIds.has(id))) runs[run.id]=run;
    const knownDocs=new Map(this.state.documents.documents.map(document=>[document.id,document]));
    const newDocuments=documents.documents.some(document=>!knownDocs.has(document.id));
    const docCursor=this.state.documents.initialized&&!newDocuments?this.state.documents.next_cursor:documents.next_cursor;
    const mergedDocs=new Map(documents.documents.map(document=>[document.id,document]));
    for(const document of knownDocs.values())if(!mergedDocs.has(document.id)&&sourceIds.has(document.source_id))mergedDocs.set(document.id,document);
    this.state={...this.state,profile,timeline,tasks,consents,results:projection.state.cardRecords||[],recordThreads:projection.state.recordThreads||[],capabilities,runs,runPage:{next_cursor:runCursor,initialized:true},documents:{documents:[...mergedDocs.values()],next_cursor:docCursor,initialized:true}};this.emit();return this.state;
  }
  async loadMoreRuns() {
    const cursor=this.state.runPage.next_cursor;if(!cursor) return;
    const page=await this.read('/api/runs?limit=100&before='+encodeURIComponent(cursor));
    for(const run of page.runs) this.state.runs[run.id]=run;
    this.state.runPage.next_cursor=page.next_cursor;this.emit();return page;
  }
  async loadMoreDocuments() {
    const cursor=this.state.documents.next_cursor;if(!cursor) return;
    const page=await this.read('/api/documents?limit=100&before='+encodeURIComponent(cursor));
    this.state.documents={documents:[...new Map([...this.state.documents.documents,...page.documents].map(document=>[document.id,document])).values()],next_cursor:page.next_cursor,initialized:true};this.emit();return page;
  }
  async logout() {const ticket=this.ticket();await this.verifySession(ticket);await this.raw('/api/auth/logout',{method:'POST',body:{},headers:{'X-CSRF-Token':ticket.csrf}});this.broadcast('identity');this.invalidate('logout');}
  async submit(slot,path,body,method='POST',file=null,ticket=this.ticket()) {
    this.check(ticket);await this.verifySession(ticket);this.epochHeaders(ticket.scopeEpoch);
    if(this.operations.some(op=>op.slot===slot&&['unknown','sending'].includes(op.state))) throw problem('UNRESOLVED_OPERATION','前次请求结果未知。请先用原请求查询 / 重试回执，当前输入已保留。');
    const op={id:crypto.randomUUID(),key:crypto.randomUUID(),slot,path,method,body:clone(body),owner:ticket.user,epoch:ticket.epoch,scopeEpoch:ticket.scopeEpoch,allClearEpoch:ticket.allClearEpoch,state:'sending',created_at:new Date().toISOString(),file};
    this.operations.push(op);this.persist();this.emit({type:'operation',operation:op});return this.execute(op,ticket);
  }
  async execute(op,ticket) {
    this.check(ticket);if(op.owner!==ticket.user||op.epoch!==ticket.epoch) throw identityChanged();
    let body=clone(op.body),outcome,completedMe;
    if(op.file_required&&!op.file) throw problem('ORIGINAL_FILE_REQUIRED','原上传结果未知。请重新选择同一个文件核对指纹后重试原请求。');
    if(op.file) {body=new FormData();body.set('file',op.file);}
    op.state='sending';this.persist();
    try {
      outcome=await this.raw(op.path,{method:op.method,body,headers:{'X-CSRF-Token':ticket.csrf,'Idempotency-Key':op.key,...this.epochHeaders(op.scopeEpoch)}});
      this.check(ticket);completedMe=await this.verifySession(ticket,{scope:op.method!=='DELETE'});op.state='resolved';op.outcome=outcome;this.persist();
    } catch(error) {
      this.check(ticket);op.state=error.status&&error.status<500?'rejected':'unknown';
      op.error={code:error.code||'NETWORK_ERROR',message:error.message,status:error.status,phase:error.phase,request_id:error.request_id};this.persist();
      if(['SCOPE_EPOCH_CONFLICT','SOURCE_DELETED'].includes(error.code)) {const current=await this.verifySession(ticket,{scope:false});this.observeServerScope(current);}
      this.emit({type:'operation',operation:op});
      if(op.state==='unknown') throw problem('OUTCOME_UNKNOWN','请求结果未知，原文与原请求键已保留。请核对回执或重试原请求，勿重复创建。',{operation_id:op.id,cause:error});
      throw error;
    }
    // Completion effects live here, so an original-key recovery has the same semantics.
    if(op.method==='DELETE'&&op.path.startsWith('/api/data/')) await this.completeDeletion(decodeURIComponent(op.path.slice('/api/data/'.length)),outcome,completedMe);
    else {this.broadcast('refresh');this.emit({type:'operation',operation:op});}
    return outcome;
  }
  async completeDeletion(sourceId,receipt,me=receipt[EPOCH]) {
    const previous=this.generation;this.observeServerScope(me);
    if(sourceId==='all') {this.operations=this.operations.filter(op=>!(op.method==='DELETE'&&op.path==='/api/data/all'));this.persist();}
    else {this.removeSelectedSource(sourceId);this.operations=this.operations.filter(op=>op.outcome?.source_id!==sourceId&&!(op.method==='DELETE'&&op.path==='/api/data/'+encodeURIComponent(sourceId)));this.persist();}
    this.broadcast('scope',{clearDrafts:sourceId==='all',sourceId,scopeEpoch:this.scopeEpoch,allClearEpoch:this.allClearEpoch});if(previous===this.generation)this.invalidateScope();
    this.emit({type:'deletion',receipt,sourceId});
    // Receipt stays successful if a subsequent read fails; never turn known deletion into unknown.
    await this.refresh().catch(error=>this.emit({type:'error',error}));
  }
  async retryOperation(id,file=null) {
    const op=this.operations.find(op=>op.id===id);if(!op) throw problem('OPERATION_MISSING','当前会话没有该原请求。');
    const identity=this.ticket();const me=await this.verifySession(identity,{scope:false});
    if(op.owner!==identity.user||op.epoch!==identity.epoch) throw identityChanged();
    this.observeServerScope(me);const ticket=this.ticket();
    if(op.method!=='DELETE'&&op.allClearEpoch<this.allClearEpoch) throw problem('SCOPE_EPOCH_CONFLICT','该原请求所属资料已全部删除，不能重新提交。',{status:409});
    if(op.owner!==ticket.user||op.epoch!==ticket.epoch) throw identityChanged();
    if(op.state==='resolved') return clone(op.outcome);
    if(file) {const metadata=await this.fileMetadata(file);this.check(ticket);if(JSON.stringify(metadata)!==JSON.stringify(op.body.file)) throw problem('ORIGINAL_FILE_MISMATCH','所选文件与原请求不同，不能使用原请求键提交。');op.file=file;}
    return this.execute(op,ticket);
  }
  async fileMetadata(file) {return {name:file.name,type:file.type,size:file.size,sha256:await fingerprint(await file.arrayBuffer())};}
  createRecordTurn(text,recordThreadId,version,sourceId) {return this.submit('record-turn:'+(recordThreadId||sourceId||'new'),'/api/record-turns',{...(sourceId?{existing_source_id:sourceId}:{text}),...(recordThreadId?{record_thread_id:recordThreadId,expected_version:version}:{})});}
  createEntry(text) {return this.submit('entry','/api/entries',{text,input_kind:'self_report'});}
  async createChat(question,sourceIds=[]) {const ticket=this.ticket();await this.refresh();this.check(ticket);const allowed=new Set(this.state.timeline.entries.map(entry=>entry.source_id));return this.submit('chat','/api/health-assistant',{question,selected_source_ids:[...new Set(sourceIds)].filter(id=>allowed.has(id)).slice(-6)},'POST',null,ticket);}
  async createDocument({text,name,file}={}) { const ticket=this.ticket();if(file) {const metadata=await this.fileMetadata(file);this.check(ticket);return this.submit('document','/api/documents',{file:metadata},'POST',file,ticket);}return this.submit('document','/api/documents',{text,name}); }
  async createVisit(currentConcern,sourceIds) {const ticket=this.ticket();await this.refresh();this.check(ticket);const allowed=new Set(this.state.timeline.entries.map(entry=>entry.source_id));return this.submit('visit','/api/visit-preparations',{current_concern:currentConcern,selected_source_ids:sourceIds.filter(id=>allowed.has(id))},'POST',null,ticket);}
  factChange(id) {return this.read('/api/fact-changes/'+encodeURIComponent(id));}
  source(id) {return this.read('/api/sources/'+encodeURIComponent(id));}
  operation(id) {return this.read('/api/operations/'+encodeURIComponent(id));}
  confirm(id,ids,revision,extra={}) {return this.submit('confirm:'+id,'/api/fact-changes/'+encodeURIComponent(id)+'/confirm',{accepted_change_ids:[...ids],expected_profile_revision:revision,...extra});}
  reject(id,revision) {return this.submit('reject:'+id,'/api/fact-changes/'+encodeURIComponent(id)+'/reject',{expected_profile_revision:revision});}
  reanalyse(id,revision) {return this.submit('reanalyse:'+id,'/api/runs/'+encodeURIComponent(id)+'/reanalyse',{expected_profile_revision:revision});}
  retryRun(id) {return this.submit('retry:'+id,'/api/runs/'+encodeURIComponent(id)+'/retry',{});}
  changeFact(fact,kind,text) {return this.submit('change:'+fact.fact_id,'/api/facts/'+encodeURIComponent(fact.fact_id)+'/change-requests',{kind,text,expected_version:fact.revision});}
  async mutate(path,method,body,{allowScopeChange=false}={}) {
    const ticket=this.ticket();await this.verifySession(ticket);const value=await this.raw(path,{method,body,headers:{'X-CSRF-Token':ticket.csrf,...this.epochHeaders(ticket.scopeEpoch)}});this.check(ticket);const me=await this.verifySession(ticket,{scope:!allowScopeChange});if(allowScopeChange)this.observeServerScope(me);this.broadcast('refresh');return value;
  }
  async updateTask(id,status,version) {const value=await this.mutate('/api/care-tasks/'+encodeURIComponent(id),'PATCH',{status,expected_version:version});await this.refresh();return value;}
  async setConsent(granted) {
    const consents=await this.read('/api/consents');const version=consents.consents.find(c=>c.purpose==='analysis')?.version;
    const value=await this.mutate('/api/consents','PATCH',{purpose:'analysis',granted,expected_version:version},{allowScopeChange:true});
    this.broadcast('scope',{scopeEpoch:this.scopeEpoch,allClearEpoch:this.allClearEpoch});await this.refresh();return value;
  }
  deleteData(sourceId='all') {return this.submit('delete:'+sourceId,'/api/data/'+encodeURIComponent(sourceId),{},'DELETE');}
  exportData() {return this.read('/api/export');}
  async cancelRun(id) {const value=await this.mutate('/api/runs/'+encodeURIComponent(id)+'/cancel','POST',{});this.state.runs[id]=value;this.emit();return value;}
  runSignature(run) {return JSON.stringify([run.status,run.phase,run.fact_change_id,run.result_id,run.result_ref,run.source_ids,run.error,run.execution_error,run.runtime,run.deleted]);}
  async pollRun(id,{signal,deadlineMs=130000,refresh=true,force=false,requireRuntime=false}={}) {
    const ticket=this.ticket(),deadline=Date.now()+deadlineMs;
    const cached=this.settledRuns.get(id),known=this.state.runs[id];
    const finalized=run=>!requireRuntime||!['completed','needs_review'].includes(run.status)||!!(run.runtime||run.execution_error);
    if(!force&&cached&&known&&cached.signature===this.runSignature(known)&&finalized(cached.run)) {await this.verifySession(ticket);await this.verifyReadScope(ticket);return clone(cached.run);}
    while(Date.now()<deadline) {
      signal?.throwIfAborted();await this.verifySession(ticket);const run=await this.read('/api/runs/'+encodeURIComponent(id),ticket);
      if(run.fact_change_id) run.change=await this.read('/api/fact-changes/'+encodeURIComponent(run.fact_change_id),ticket);
      if(run.result_id||run.result_ref) run.result=await this.read('/api/results/'+encodeURIComponent(run.result_id||run.result_ref),ticket);
      this.check(ticket);this.state.runs[id]=run;this.emit({type:'run',run});
      if(!['queued','running'].includes(run.status)&&finalized(run)) {this.settledRuns.set(id,{signature:this.runSignature(run),run:clone(run)});if(refresh) await this.refresh();return run;}
      await new Promise((resolve,reject)=>{const timer=setTimeout(done,this.pollMs);function done(){signal?.removeEventListener('abort',abort);resolve();}function abort(){clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(signal.reason);}signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted) abort();});
      this.check(ticket);
    }
    throw problem('POLL_TIMEOUT','原文已保存，仍未取得最终状态；稍后读取该任务，不会自动重放或取消。',{run_id:id});
  }
  dispose() {this.generation++;for(const c of this.controllers)c.abort();this.channel?.removeEventListener('message',this.onBroadcast);this.channel?.close?.();globalThis.window?.removeEventListener('storage',this.onStorage);this.listeners.clear();}
}
