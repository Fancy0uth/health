import {randomBytes} from 'node:crypto';
import {AgnesAgent} from './agnes-agent.mjs';
import {DomainError} from './domain-errors.mjs';
import {loadRuntime as bundledRuntime,createRuntime as bundledCreateRuntime} from '../../agents/runtime/host.mjs';
import {AGH_ACCOUNT_HOME,AGH_ACCOUNT_PROFILE} from '../../scripts/runtime-paths.mjs';
const messages={CONFIG_BUSY:'请等待当前分析或配置完成后重试。',CONFIG_TICKET_INVALID:'连接验证已过期，请重新测试。',CONFIG_REVISION_CONFLICT:'配置已更新，请刷新后重试。',CONFIG_KEY_REQUIRED:'请输入有效的 Agnes API Key。',CONFIG_TEST_FAILED:'连接验证失败，请检查 API Key 与网络。',CONFIG_MODEL_UNAVAILABLE:'请选择验证列表中的模型。',CONFIG_RUNTIME_FAILED:'配置已保存，但运行环境启动失败，请重新配置或重试。',CONFIG_UNAVAILABLE:'模型配置服务暂时不可用。'};
const failure=(code,status=400)=>new DomainError(status,code,messages[code]);
// Credentials only live in bounded, short-lived tickets until the official credential store saves them.
export function createModelConfiguration({accountHome=AGH_ACCOUNT_HOME,accountProfile=AGH_ACCOUNT_PROFILE,loadRuntime=bundledRuntime,createRuntime=bundledCreateRuntime,clock=Date.now}={}){
 let service,runtime=null,activeAgent=null,store=null,switching=false,closed=false,generation=0,inflight=0,errorCode=null;
 let state={configured:false,model:null,revision:0,runtime_status:'unconfigured'};
 const tickets=new Map();
 const prune=()=>{for(const [id,ticket]of tickets)if(ticket.expires<=clock())tickets.delete(id);};
 const timer=setInterval(prune,30000);timer.unref();
 const snapshot=current=>({configured:current.configured===true&&current.provider?.id==='agnes-ai'&&current.provider?.credentialConfigured===true,model:current.provider?.id==='agnes-ai'?current.provider.model:null,revision:Number.isSafeInteger(current.revision)?current.revision:0});
 async function activate(){runtime=await createRuntime({accountHome,accountProfile});await runtime.isReady();if(store)activeAgent=new AgnesAgent({runtime,store});state.runtime_status='ready';errorCode=null;}
 async function discardRuntime(){const old=runtime;runtime=null;activeAgent=null;await old?.close();}
 const manager={
  get isSwitching(){return switching;},
  async initialize(){try{const {host}=await loadRuntime();service=host.createConfigurationService({home:accountHome,profile:accountProfile});state={...snapshot(await service.get()),runtime_status:'unconfigured'};if(state.configured)await activate();}catch{await discardRuntime().catch(()=>{});state.runtime_status='error';errorCode='CONFIG_UNAVAILABLE';}return manager.getStatus();},
  async getStatus(){return{...state,...(errorCode?{error_code:errorCode}:{})};},
  createAgent(domainStore){store=domainStore;if(runtime)activeAgent=new AgnesAgent({runtime,store});return{get mode(){return !switching&&state.runtime_status==='ready'?activeAgent?.mode||'real':null;},async isReady(options){return !switching&&!!activeAgent&&activeAgent.isReady(options);},async run(input){if(switching||!activeAgent)throw failure('CONFIG_UNAVAILABLE',503);return activeAgent.run(input);},close:()=>manager.close()};},
  async test(uid,{api_key:apiKey}={}){
   if(closed||!service)throw failure('CONFIG_UNAVAILABLE',503);
   if(switching||inflight>=8)throw failure('CONFIG_BUSY',409);
   if(typeof apiKey!=='string'||!apiKey.trim()||apiKey.length>8192||/[\p{C}]/u.test(apiKey))throw failure('CONFIG_KEY_REQUIRED');
   apiKey=apiKey.trim();const version=generation;inflight++;
   try{const {providers}=await service.providers();const choices=providers.filter(p=>p.id==='agnes-ai'&&p.authMethods?.includes('api-key'));if(choices.length!==1||typeof choices[0].baseUrl!=='string')throw failure('CONFIG_UNAVAILABLE',503);const baseUrl=choices[0].baseUrl;const result=await service.test({providerId:'agnes-ai',baseUrl,apiKey});
    if(!result.verified||!Array.isArray(result.models)||!result.models.length||result.models.length>2000)throw failure('CONFIG_TEST_FAILED');
    const models=result.models.map(m=>{if(typeof m.id!=='string'||!m.id||m.id.length>256||/[\p{C}\s]/u.test(m.id)||m.id.includes(apiKey))throw failure('CONFIG_TEST_FAILED');return{id:m.id,name:typeof m.name==='string'&&m.name.length<256&&!/[\p{C}]/u.test(m.name)&&!m.name.includes(apiKey)?m.name:m.id};});
    if(closed||switching||version!==generation)throw failure('CONFIG_TICKET_INVALID');prune();for(const [id,t]of tickets)if(t.uid===uid)tickets.delete(id);while(tickets.size>=16)tickets.delete(tickets.keys().next().value);const ticket=randomBytes(32).toString('base64url');tickets.set(ticket,{uid,apiKey,baseUrl,models,expires:clock()+300000});return{ticket,models};
   }catch(e){if(e instanceof DomainError)throw e;throw failure('CONFIG_TEST_FAILED');}finally{inflight--;apiKey='';}
  },
  async save(uid,{ticket,model,expected_revision:revision}={},isBusy=()=>false){
   if(closed||!service)throw failure('CONFIG_UNAVAILABLE',503);prune();const pending=tickets.get(ticket);if(!pending||pending.uid!==uid)throw failure('CONFIG_TICKET_INVALID');if(switching||isBusy())throw failure('CONFIG_BUSY',409);if(!Number.isSafeInteger(revision)||revision<0)throw failure('CONFIG_REVISION_CONFLICT',409);if(!pending.models.some(m=>m.id===model))throw failure('CONFIG_MODEL_UNAVAILABLE');
   switching=true;let persisted=false;
   try{const current=await service.get();if(current.revision!==revision)throw failure('CONFIG_REVISION_CONFLICT',409);if(isBusy())throw failure('CONFIG_BUSY',409);
    tickets.clear();generation++;const saved=await service.save({providerId:'agnes-ai',baseUrl:pending.baseUrl,apiKey:pending.apiKey,model,expectedRevision:revision});persisted=true;state={...snapshot(saved),runtime_status:'starting'};await discardRuntime();if(!state.configured||state.model!==model)throw failure('CONFIG_RUNTIME_FAILED',503);await activate();return await manager.getStatus();
   }catch(e){if(persisted){await discardRuntime().catch(()=>{});state.runtime_status='error';errorCode='CONFIG_RUNTIME_FAILED';throw failure('CONFIG_RUNTIME_FAILED',503);}if(e instanceof DomainError)throw e;if(e?.code==='CONFIG_REVISION_CONFLICT')throw failure('CONFIG_REVISION_CONFLICT',409);throw failure('CONFIG_UNAVAILABLE',503);
   }finally{if(!tickets.has(ticket))pending.apiKey='';switching=false;}
  },
  async close(){if(closed)return;closed=true;clearInterval(timer);tickets.clear();generation++;await discardRuntime();state.runtime_status='unconfigured';},
 };
 return manager;
}

// Constructor form used by the packaged launcher.
export class ModelConfiguration { constructor(options){return createModelConfiguration(options);} }
