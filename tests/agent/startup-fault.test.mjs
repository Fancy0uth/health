import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {prepareRuntime,runtimeStatus} from '../../agents/runtime/startup.mjs';
import {createRuntime} from '../../agents/runtime/host.mjs';
import {fixtureRuntime,scriptedProvider} from './scripted-provider.mjs';
import {createApp} from '../../services/api/domain-server.mjs';
import {AgnesAgent} from '../../services/api/agnes-agent.mjs';
test('startup final readiness rejection closes provisional genuine Host and advertises unavailable, preserves input as blocked',async t=>{
 const home=await mkdtemp(join(tmpdir(),'ht-startup-fault-'));let actual,app,closeCount=0;const messages=[];
 t.after(async()=>{await app?.close();await actual?.close();await rm(home,{recursive:true,force:true});});
 const provider=scriptedProvider([]);
 const runtime=await prepareRuntime({build:async()=>{},create:async()=>{actual=await createRuntime({home,fixture:fixtureRuntime(provider)});return{...actual,isReady:async()=>{throw Object.assign(new Error('fixture configuration race'),{code:'AGNES_CONFIGURATION_CHANGED'});},close:async()=>{closeCount++;await actual.close();}};},log:m=>messages.push(m)});
 assert.equal(runtime,null);assert.equal(closeCount,1);assert.equal(actual.lifecycle().closed,true);assert.equal(actual.client.isClosed,true);assert.equal(provider.requests.length,0);assert.match(messages[0],/AGNES_CONFIGURATION_CHANGED/);assert.match(runtimeStatus(runtime),/未就绪/);assert.doesNotMatch(runtimeStatus(runtime),/已就绪/);
 app=createApp({dbPath:':memory:',demoAccounts:[{username:'fault',password:'fault-password'}],agentFactory:runtime?store=>new AgnesAgent({runtime,store}):null});await app.listen(0);const base=`http://127.0.0.1:${app.server.address().port}`;
 const capabilities=await (await fetch(base+'/api/capabilities')).json();assert.deepEqual(capabilities.analysis,{status:'not_configured',mode:null});
 const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({username:'fault',password:'fault-password'})});const auth=await login.json();const headers={Origin:base,'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':auth.csrf_token,'X-HealthThread-Epoch':String(auth.scope_epoch),'Idempotency-Key':'startup-fault-input-0001'};
 const consent=await fetch(base+'/api/consents',{method:'PATCH',headers,body:JSON.stringify({purpose:'analysis',granted:true,expected_version:1})});headers['X-HealthThread-Epoch']=consent.headers.get('x-healththread-epoch');const accepted=await (await fetch(base+'/api/entries',{method:'POST',headers,body:JSON.stringify({text:'保留启动失败原文。'})})).json();await app.jobs.drain();const run=await (await fetch(base+'/api/runs/'+accepted.run_id,{headers})).json();assert.equal(run.status,'blocked');assert.equal(run.saved_receipt.saved,true);assert.equal(app.store.get(auth.user.id,'source',accepted.source_id).text,'保留启动失败原文。');
});
