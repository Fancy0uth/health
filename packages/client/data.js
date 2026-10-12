import {INITIAL,NAV,DEMO_SESSIONS} from './demo-data.js';
import {nativeBridge} from './native-bridge.js';
import {openLogin} from './auth-ui.js';
export {INITIAL,NAV,DEMO_SESSIONS};
const bridge=nativeBridge();
let generation=0;
const notify=(type,detail)=>window.dispatchEvent(new CustomEvent(type,{detail}));
function hasEditor(){return ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName);}
function publish(){if(!hasEditor())notify('healththread:state',{state:loadData()});}
if(typeof window!=='undefined'){
  window.HEALTHTHREAD_CONFIG={storageMode:'domain'};
  window.HEALTHTHREAD_API_URL='/api/health-assistant';window.HEALTHTHREAD_RECORD_URL='/api/health-record';window.HEALTHTHREAD_PARSE_URL='/api/medical-document';
  await openLogin(bridge.client,{initialize:true});await bridge.refresh();
  bridge.client.subscribe(event=>{if(!bridge.client.state.user){generation++;location.reload();return;}if(event.type==='operation'&&event.operation?.state==='unknown')notify('healththread:sync',{status:'failed',message:event.operation.error?.message||'请求结果未知，原请求已保留。'});publish();});
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
