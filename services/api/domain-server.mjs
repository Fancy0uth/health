import http from 'node:http';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DomainStore} from './domain-store.mjs';
import {DispatchQueue} from './domain-jobs.mjs';
import {check,fail,errorBody,LIMITS} from './domain-errors.mjs';
import {extractPdf,pdfAvailable} from './pdf.mjs';
const defaultRoot=fileURLToPath(new URL('../../',import.meta.url));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.json':'application/json; charset=utf-8','.ico':'image/x-icon'};
function json(res,status,data,headers={}){if(status>=200&&status<300&&res.healththreadEpoch)headers={...headers,...res.healththreadEpoch()};res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(data));}
async function readBytes(req,limit){const chunks=[];let size=0;for await(const c of req){size+=c.length;check(size<=limit,'PAYLOAD_TOO_LARGE',413);chunks.push(c);}return Buffer.concat(chunks);}
async function jsonBody(req,limits){check(req.headers['content-type']?.startsWith('application/json'),'JSON_REQUIRED',415);const bytes=await readBytes(req,limits.bodyBytes);let b;try{b=JSON.parse(bytes.toString('utf8'));}catch{fail(400,'INVALID_JSON');}check(b&&typeof b==='object'&&!Array.isArray(b),'INVALID_JSON');return b;}
const epochHeaders=u=>({'X-HealthThread-Epoch':String(u.epoch),'X-HealthThread-All-Clear-Epoch':String(u.all_clear_epoch)});
function requestEpoch(req){const raw=req.headers['x-healththread-epoch'];check(typeof raw==='string'&&/^[1-9]\d{0,15}$/.test(raw)&&Number.isSafeInteger(Number(raw)),'EPOCH_REQUIRED',428);return Number(raw);}
function origin(req){let value;try{value=new URL(req.headers.origin);}catch{fail(403,'ORIGIN_DENIED');}check(value.origin===`${req.socket.encrypted?'https':'http'}://${req.headers.host}`,'ORIGIN_DENIED',403);}
const tokenFrom=req=>req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('ht_session='))?.slice('ht_session='.length);
const pick=(value,fields)=>Object.fromEntries(fields.filter(key=>Object.hasOwn(value,key)).map(key=>[key,value[key]]));
const publicOperation=value=>{const {owner,...out}=value;return out;};
function publicRun(store,uid,run){return{...pick(run,['id','workflow','record_thread_id','conversation_id','status','phase','source_ids','base_profile_revision','created_at','fact_change_id','result_id','result_ref','error','execution_error','tool_receipts','document_id','parent_run_id','operation_id','repair_attempts','runtime','deleted']),saved_receipt:publicOperation(store.get(uid,'operation',run.operation_id))};}
const publicDocument=value=>pick(value,['id','source_id','name','media_type','byte_size','content_hash','extraction_status','pages']);
function listQuery(url,run){const allowed=run?['limit','before','source_id','status']:['limit','before'];check([...url.searchParams.keys()].every(k=>allowed.includes(k))&&new Set(url.searchParams.keys()).size===[...url.searchParams.keys()].length);return Object.fromEntries(url.searchParams);}
export function createApp({root=defaultRoot,dbPath=resolve(root,'.runtime/healththread-domain.sqlite'),agent=null,agentFactory=null,demoAccounts=[],limits={}}={}){
 const configured={...LIMITS,...limits};const store=new DomainStore({dbPath,demoAccounts,limits:configured});agent=agentFactory?agentFactory(store):agent;const jobs=new DispatchQueue(store,agent,{limits:configured});const attempts=new Map();
 const capabilities=()=>({api_version:1,analysis:{status:agent&&['fixture','real'].includes(agent.mode)?'enabled':'not_configured',mode:agent?.mode||null},pdf_text:{status:pdfAvailable()?'enabled':'not_configured'},voice:{status:'unsupported'},audio:{status:'unsupported'},ocr:{status:'unsupported'},department:{status:'not_configured',decision:'D01'},triage:{status:'not_configured',decision:'D02'},limits:{text_bytes:configured.textBytes,upload_bytes:configured.uploadBytes,pdf_pages:configured.pdfPages}});
 const server=http.createServer(async(req,res)=>{const requestId=randomUUID();try{
  const url=new URL(req.url,'http://localhost'),path=decodeURIComponent(url.pathname);const method=req.method;
  if(path.startsWith('/api/')){
   if(!['GET','HEAD'].includes(method))origin(req);
   if(path==='/api/health'&&method==='GET')return json(res,200,{ok:true,storage:'sqlite',dispatch:jobs.status(),capabilities:capabilities()});
   if(path==='/api/capabilities'&&method==='GET')return json(res,200,capabilities());
   if(path==='/api/auth/login'&&method==='POST'){
    const now=Date.now();for(const [k,v]of attempts)if(now-v.start>configured.loginWindowMs)attempts.delete(k);const address=req.socket.remoteAddress||'unknown';const record=attempts.get(address)||{start:now,count:0};check(record.count<configured.loginAttempts,'RATE_LIMITED',429);record.count++;attempts.set(address,record);const b=await jsonBody(req,configured);const result=store.login(b.username,b.password);const {token,...publicResult}=result;res.healththreadEpoch=()=>epochHeaders(store.user(result.user.id));return json(res,200,publicResult,{'Set-Cookie':`ht_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${Math.floor(configured.sessionTtlMs/1000)}${req.socket.encrypted?'; Secure':''}`});
   }
   const token=tokenFrom(req),session=store.session(token);if(session)res.healththreadEpoch=()=>epochHeaders(store.user(session.user.id));
   if(path==='/api/me'&&method==='GET')return json(res,200,session||{user:null,csrf_token:null,profile_revision:null,scope_epoch:null,all_clear_epoch:null});
   check(session,'AUTH_REQUIRED',401);const uid=session.user.id;
   if(!['GET','HEAD'].includes(method))check(req.headers['x-csrf-token']===session.csrf_token,'CSRF_DENIED',403);
   if(path==='/api/auth/logout'&&method==='POST'){store.logout(token);return json(res,200,{logged_out:true},{'Set-Cookie':'ht_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0'});}
   const expectedEpoch=['GET','HEAD'].includes(method)?undefined:requestEpoch(req);
   if(path==='/api/state'&&method==='PUT')fail(405,'METHOD_NOT_ALLOWED','正式资料只能通过核对事务更新。');
   if(path==='/api/state'&&method==='GET'){const p=store.profile(uid);return json(res,200,{revision:p.profile_revision,state:{recordThreads:store.recordThreads(uid),records:store.timeline(uid).entries.map(e=>({id:e.source_id,text:e.source.text,date:null,status:'saved'})),facts:p.facts,pending_changes:p.pending_changes,sessions:[],consent:store.consent(uid),medical:null,cardRecords:store.all('result',uid),tasks:store.careTasks(uid).tasks}});}
   if(path==='/api/profile'&&method==='GET')return json(res,200,store.profile(uid));
   if(path==='/api/timeline'&&method==='GET')return json(res,200,store.timeline(uid));
   if(path==='/api/runs'&&method==='GET'){const page=store.listOwned(uid,'run',listQuery(url,true));return json(res,200,{runs:page.items.map(run=>publicRun(store,uid,run)),next_cursor:page.next_cursor});}
   if(path==='/api/documents'&&method==='GET'){const page=store.listOwned(uid,'document',listQuery(url,false));return json(res,200,{documents:page.items.map(publicDocument),next_cursor:page.next_cursor});}
   if(path==='/api/care-tasks'&&method==='GET')return json(res,200,store.careTasks(uid));
   if(path==='/api/consents'&&method==='GET')return json(res,200,{consents:[store.consent(uid)]});
   if(path==='/api/consents'&&method==='PATCH'){const result=store.setConsent(uid,await jsonBody(req,configured),expectedEpoch);for(const [rid]of jobs.running)if(store.internalRun(rid).owner===uid)jobs.cancel(rid);return json(res,200,result);}
   if(path==='/api/export'&&method==='GET')return json(res,200,store.exportData(uid),{'Content-Disposition':'attachment; filename="healththread-export.json"'});
   const key=req.headers['idempotency-key'];
   if(path==='/api/record-turns'&&method==='POST'){const accepted=store.acceptRecordTurn(uid,await jsonBody(req,configured),key,expectedEpoch);jobs.kick();return json(res,202,accepted);}
   if(['/api/entries','/api/documents','/api/visit-preparations','/api/health-record','/api/medical-document','/api/health-assistant'].includes(path)&&method==='POST'){
    const workflow=['/api/documents','/api/medical-document'].includes(path)?'document':path==='/api/health-assistant'?'chat':path==='/api/visit-preparations'?'visit':'entry';let input,document=null;
    store.requireConsent(uid);
    if(workflow==='document'&&req.headers['content-type']?.startsWith('multipart/form-data')){
     const bytes=await readBytes(req,configured.uploadBytes+65536);let form;try{form=await new Request('http://localhost/upload',{method:'POST',headers:{'Content-Type':req.headers['content-type']},body:bytes}).formData();}catch{fail(400,'INVALID_MULTIPART');}check([...form.keys()].length===1&&form.has('file'),'INVALID_MULTIPART');const file=form.get('file');check(file&&typeof file.arrayBuffer==='function'&&file.type==='application/pdf','UNSUPPORTED_DOCUMENT',415);document=await extractPdf(Buffer.from(await file.arrayBuffer()),configured);input={text:document.text,name:file.name};
    }else input=await jsonBody(req,configured);
    if(path==='/api/health-assistant')input={question:input.question,selected_source_ids:input.selected_source_ids||[]};
    if(input.input_kind!==undefined)check(input.input_kind==='self_report'||(workflow==='document'&&input.input_kind==='pasted_document'));
    const accepted=store.accept(uid,workflow,input,key,document,expectedEpoch);jobs.kick();return json(res,202,accepted);
   }
   let match=path.match(/^\/api\/(sources|runs|results|fact-changes|operations)\/([^/]+)$/);
   if(match&&method==='GET'){const [,collection,objectId]=match;const type={sources:'source',runs:'run',results:'result','fact-changes':'fact_change',operations:'operation'}[collection];let value;try{value=store.get(uid,type,objectId);}catch(e){if(type!=='operation'||e.code!=='NOT_FOUND')throw e;value=store.get(uid,'deletion_job',objectId);}if(type==='fact_change')value={...value,review_revision:store.user(uid).revision,sources:value.source_ids.map(s=>store.get(uid,'source',s))};if(type==='run')value=publicRun(store,uid,value);return json(res,200,value);}
   match=path.match(/^\/api\/fact-changes\/([^/]+)\/(confirm|reject)$/);if(match&&method==='POST'){const body=await jsonBody(req,configured);const result=match[2]==='confirm'?store.confirm(uid,match[1],body,key,expectedEpoch):store.reject(uid,match[1],body,key,expectedEpoch);jobs.kick();return json(res,200,result);}
   match=path.match(/^\/api\/runs\/([^/]+)\/cancel$/);if(match&&method==='POST'){const result=store.cancel(uid,match[1],expectedEpoch);jobs.cancel(match[1]);return json(res,200,result);}
   match=path.match(/^\/api\/runs\/([^/]+)\/retry$/);if(match&&method==='POST'){const result=store.retry(uid,match[1],key,expectedEpoch);jobs.kick();return json(res,202,result);}
   match=path.match(/^\/api\/runs\/([^/]+)\/reanalyse$/);if(match&&method==='POST'){const result=store.reanalyse(uid,match[1],await jsonBody(req,configured),key,expectedEpoch);jobs.cancel(match[1]);jobs.kick();return json(res,202,result);}
   match=path.match(/^\/api\/facts\/([^/]+)\/change-requests$/);if(match&&method==='POST')return json(res,202,store.changeRequest(uid,match[1],await jsonBody(req,configured),key,expectedEpoch));
   match=path.match(/^\/api\/care-tasks\/([^/]+)$/);if(match&&method==='PATCH')return json(res,200,store.updateTask(uid,match[1],await jsonBody(req,configured),expectedEpoch));
   match=path.match(/^\/api\/data\/(all|[^/]+)$/);if(match&&method==='DELETE'){const result=store.deleteData(uid,match[1],key,expectedEpoch);for(const [rid]of jobs.running)if(store.internalRun(rid).owner===uid)jobs.cancel(rid);return json(res,202,result);}
   fail(404,'NOT_FOUND');
  }
  check(['GET','HEAD'].includes(method),'METHOD_NOT_ALLOWED',405);
  if(path==='/'){res.writeHead(302,{Location:'/web/'});return res.end();}
  if(path==='/runtime-config.js'&&method==='GET'){res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});return res.end("window.HEALTHTHREAD_CONFIG={storageMode:'domain'};window.HEALTHTHREAD_API_URL='/api/health-assistant';window.HEALTHTHREAD_RECORD_URL='/api/health-record';window.HEALTHTHREAD_PARSE_URL='/api/medical-document';");}
  const mounts=[['/web/',resolve(root,'apps/web')],['/mobile/',resolve(root,'apps/mobile')],['/packages/client/',resolve(root,'packages/client')]];const mount=mounts.find(([prefix])=>path.startsWith(prefix));check(mount,'NOT_FOUND',404);const relative=path.slice(mount[0].length)||'index.html';check(!relative.includes('\0')&&!relative.split('/').some(p=>p.startsWith('.')),'PATH_DENIED',403);let file;try{file=await realpath(resolve(mount[1],relative));}catch{fail(404,'NOT_FOUND');}check(file.startsWith(await realpath(mount[1])+sep),'PATH_DENIED',403);check(mime[extname(file)],'NOT_FOUND',404);const bytes=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)],'X-Content-Type-Options':'nosniff','Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:bytes);
 }catch(error){if(!error.status)console.error(JSON.stringify({request_id:requestId,code:'INTERNAL_ERROR',phase:'request'}));if(!res.headersSent)json(res,error.status||500,errorBody(error,'request',requestId),error.status===429?{'Retry-After':'60'}:{});else res.end();}});
 return {server,store,jobs,listen:(port=4173,host='127.0.0.1')=>new Promise((resolveListen,reject)=>{server.once('error',reject);server.listen(port,host,()=>{server.off('error',reject);resolveListen();});}),async close(){await jobs.close();server.closeAllConnections();if(server.listening)await new Promise(done=>server.close(done));store.close();}};
}
