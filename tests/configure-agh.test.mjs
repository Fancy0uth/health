import test from 'node:test';
import assert from 'node:assert/strict';
import {configureAgnes, createTerminalPrompts} from '../scripts/configure-agh.mjs';
import {PassThrough} from 'node:stream';

const key='secret-key-never-print';
function setup({snapshot,providers,result,answers=[key,'2','yes'],env={}}={}) {
 const saved=[],tested=[],messages=[];
 const service={
  async get(){return snapshot??{configured:false,revision:0,provider:null,accounts:[]};},
  async providers(){return {providers:providers??[{id:'agnes-ai',authMethods:['api-key'],baseUrl:'https://api.agnes.ai/v1'}]};},
  async test(input){tested.push(input);return result??{verified:true,models:[{id:'first'},{id:'second'}]};},
  async save(input){saved.push(input);return {configured:true,provider:{id:'agnes-ai',model:input.model,credentialConfigured:true}};},
 };
 const prompts={async secret(){return answers.shift();},async ask(){return answers.shift();}};
 return {saved,tested,messages,service,run:()=>configureAgnes({service,prompts,env,write:text=>messages.push(text)})};
}
test('only saves a verified selected model through the configuration service without printing key',async()=>{
 const s=setup();assert.equal((await s.run()).status,'configured');
 assert.equal(s.saved.length,1);assert.deepEqual(s.saved[0],{providerId:'agnes-ai',baseUrl:'https://api.agnes.ai/v1',apiKey:key,model:'second',expectedRevision:0});
 assert.equal(s.messages.join('').includes(key),false);
});
test('refuses any existing account before asking for credentials or testing',async()=>{
 for(const snapshot of [{configured:true,revision:1,provider:{id:'other'}},{configured:false,revision:1,accounts:[{providerId:'agnes-ai'}]}]) {
 const s=setup({snapshot,answers:[]});await assert.rejects(s.run(),{code:'ACCOUNT_EXISTS'});assert.equal(s.tested.length,0);assert.equal(s.saved.length,0);
 }
});
test('rejects a missing or mismatched registry provider',async()=>{
 const s=setup({providers:[{id:'other',authMethods:['api-key'],baseUrl:'https://other.invalid'}]});await assert.rejects(s.run(),{code:'PROVIDER_UNAVAILABLE'});assert.equal(s.saved.length,0);assert.equal(s.tested.length,0);
});
test('rejects unverified catalogue and model outside verified catalogue',async()=>{
 for(const options of [{result:{verified:false,models:[{id:'first'}]}},{env:{HEALTHTHREAD_AGNES_API_KEY:key,AGNES_MODEL:'unknown'}}]){
 const s=setup(options);await assert.rejects(s.run());assert.equal(s.saved.length,0);
 }
});
test('cancellation at any prompt never saves',async()=>{
 for(const answers of [[null],[key,null],[key,'1',null],[key,'1','no']]){
 const s=setup({answers});assert.equal((await s.run()).status,'cancelled');assert.equal(s.saved.length,0);
 }
});
test('noninteractive input requires both explicit environment values',async()=>{
 const s=setup({env:{HEALTHTHREAD_AGNES_API_KEY:key,AGNES_MODEL:'first'},answers:[]});await s.run();assert.equal(s.saved[0].model,'first');
 const partial=setup({env:{HEALTHTHREAD_AGNES_API_KEY:key},answers:[]});await assert.rejects(partial.run(),{code:'MODEL_REQUIRED'});assert.equal(partial.saved.length,0);
});
test('provider failures cannot leak keys or arbitrary upstream errors',async()=>{
 const s=setup();s.service.test=async()=>{throw new Error(key);};await assert.rejects(s.run(),error=>!error.message.includes(key)&&error.code==='CONFIGURATION_FAILED');assert.equal(s.saved.length,0);
});
test('hidden terminal input suppresses credential echo and restores terminal mode',async()=>{
 const input=new PassThrough(),output=new PassThrough();let raw=false,display='';input.isTTY=true;input.setRawMode=value=>{raw=value;input.isRaw=value;};output.on('data',chunk=>{display+=chunk;});
 const prompts=createTerminalPrompts({input,output});const pending=prompts.secret('API key: ');input.write(key+'\r');assert.equal(await pending,key);assert.equal(display.includes(key),false);assert.equal(raw,false);input.destroy();output.destroy();
});

test('genuine bundled Host persists and reloads the isolated Agnes account',async t=>{
 const {mkdtemp,rm,readFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {loadRuntime}=await import('../agents/runtime/host.mjs');
 const {host}=await loadRuntime();
 const home=await mkdtemp(join(tmpdir(),'healththread-configure-'));
 t.after(()=>rm(home,{recursive:true,force:true}));
 let offered=[];
 const request=async(url,options)=>{
  assert.equal(String(url),'https://api.agnes-ai.cn/v1/models');
  assert.equal(options.headers.Authorization,'Bearer '+key);
  return new Response(JSON.stringify({data:offered.map(id=>({id}))}),{headers:{'content-type':'application/json'}});
 };
 const service=host.createConfigurationService({home,profile:'local-dev',request});
 const catalogue=await service.test({providerId:'agnes-ai'});
 offered=[catalogue.models[0].id];
 const messages=[];
 await configureAgnes({service,env:{HEALTHTHREAD_AGNES_API_KEY:key,AGNES_MODEL:offered[0]},write:value=>messages.push(value)});
 const reloaded=await host.createConfigurationService({home,profile:'local-dev',request}).get();
 assert.equal(reloaded.configured,true);assert.equal(reloaded.provider.id,'agnes-ai');assert.equal(reloaded.provider.model,offered[0]);
 assert.equal(messages.join('').includes(key),false);
 assert.equal((await readFile(join(home,'profiles/local-dev/configuration.json'),'utf8')).includes(key),false);
 await assert.rejects(configureAgnes({service,env:{HEALTHTHREAD_AGNES_API_KEY:key,AGNES_MODEL:offered[0]}}),{code:'ACCOUNT_EXISTS'});
});
