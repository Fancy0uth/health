import {INITIAL,NAV,DEMO_SESSIONS} from './demo-data.js';
import {nativeBridge} from './native-bridge.js';
export {INITIAL,NAV,DEMO_SESSIONS};
const bridge=nativeBridge();
let generation=0;
const notify=(type,detail)=>window.dispatchEvent(new CustomEvent(type,{detail}));
function hasEditor(){return ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);}
function publish(){if(!hasEditor())notify('healththread:state',{state:loadData()});}
async function login(){
  const mobile=location.pathname.startsWith('/mobile/');
  const dialog=document.createElement('dialog');dialog.className=mobile?'sheet-dialog':'confirmation-dialog';
  dialog.innerHTML=`<form class="sheet-content"><h2>登录 HealthThread</h2><label class="field"><span>账号</span><input name="username" autocomplete="username" required></label><label class="field"><span>密码</span><input name="password" type="password" autocomplete="current-password" required></label><p role="status"></p><button class="button primary" type="submit">登录</button></form>`;
  document.body.append(dialog);dialog.addEventListener('cancel',event=>event.preventDefault());dialog.showModal();
  await new Promise(resolve=>dialog.querySelector('form').addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{await bridge.client.login(form.elements.username.value,form.elements.password.value);resolve();dialog.close();dialog.remove();}catch(error){form.querySelector('[role=status]').textContent=error.message;}finally{button.disabled=false;}}));
}
if(typeof window!=='undefined'){
  window.HEALTHTHREAD_CONFIG={storageMode:'domain'};
  window.HEALTHTHREAD_API_URL='/api/health-assistant';window.HEALTHTHREAD_RECORD_URL='/api/health-record';window.HEALTHTHREAD_PARSE_URL='/api/medical-document';
  await bridge.client.initialize();if(!bridge.client.state.user)await login();await bridge.refresh();
  bridge.client.subscribe(event=>{if(!bridge.client.state.user){generation++;location.reload();return;}if(event.type==='operation'&&event.operation.state==='unknown')notify('healththread:sync',{status:'failed',message:event.operation.error?.message||'请求结果未知，原请求已保留。'});publish();});
  const refresh=()=>{if(document.visibilityState!=='hidden'&&!hasEditor())bridge.refresh().then(publish).catch(error=>notify('healththread:sync',{status:'failed',message:error.message}));};
  setInterval(refresh,4000);window.addEventListener('focus',refresh);document.addEventListener('visibilitychange',refresh);
  if(bridge.client.pendingOperations().length)setTimeout(()=>notify('healththread:sync',{status:'failed',message:'有未取得结果的原请求，请恢复回执；不要重复创建资料。'}),0);
}
export function loadData(){return bridge.snapshot();}
export function saveData(value){return bridge.saveOverlay(value);}
export function resetData(){return bridge.deleteAll();}
export function getProfileGeneration(){return generation;}
export async function flushData(){return bridge.refresh();}
export async function reloadData(){await bridge.refresh();publish();}
export function createEmptyState(){return {...structuredClone(INITIAL),records:[],sessions:[],activeSessionId:null,selectedHistory:[],factHistory:[],cardArchive:[],cardRecords:[],factVersion:0,cardVersion:0,cardDraft:'',cardStartDate:null,symptomStart:'',currentConcern:'',cardConcern:'',impact:'',questions:[],uploadedName:'',uploadState:'empty',medical:null,taskStatus:'pending',recordReviewed:false,consent:{organize:false,parse:false,voice:false},exportAt:'',deleteResult:null,cardSourceDeleted:false};}
