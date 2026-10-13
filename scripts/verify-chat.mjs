// Opt-in real provider smoke: only synthetic text, isolated account and database.
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PROJECT} from './runtime-paths.mjs';
import {createRuntime} from '../agents/runtime/host.mjs';
import {createApp} from '../services/api/domain-server.mjs';
import {AgnesAgent} from '../services/api/agnes-agent.mjs';
const root=join(PROJECT,'.runtime/evidence');await mkdir(root,{recursive:true});
const directory=await mkdtemp(join(root,'chat-smoke-'));
let runtime,app;
try{
 runtime=await createRuntime();
 if(runtime.readiness.fixture)throw new Error('REAL_PROVIDER_REQUIRED');
 const username='synthetic-smoke',password=randomUUID();
 app=createApp({dbPath:join(directory,'synthetic.sqlite'),demoAccounts:[{username,password}],agentFactory:store=>new AgnesAgent({runtime,store})});
 await app.listen(0);const base=`http://127.0.0.1:${app.server.address().port}`;
 let cookie='',csrf='',epoch='1';
 async function request(path,method='GET',body){
  const response=await fetch(base+path,{method,headers:{Origin:base,'Content-Type':'application/json',...(cookie?{Cookie:cookie,'X-CSRF-Token':csrf,'X-HealthThread-Epoch':epoch,'Idempotency-Key':randomUUID()}: {})},...(body?{body:JSON.stringify(body)}:{})});
  if(response.headers.has('set-cookie'))cookie=response.headers.get('set-cookie').split(';')[0];
  if(response.headers.has('x-healththread-epoch'))epoch=response.headers.get('x-healththread-epoch');
  const value=await response.json();if(!response.ok)throw new Error(`HTTP_${response.status}`);return value;
 }
 const login=await request('/api/auth/login','POST',{username,password});csrf=login.csrf_token;epoch=String(login.scope_epoch);
 await request('/api/consents','PATCH',{purpose:'analysis',granted:true,expected_version:1});
 console.log('正在通过真实 Agnes 模型发送一条合成测试消息，可能产生少量模型费用…');
 const accepted=await request('/api/health-assistant','POST',{question:'你好，我想了解如何整理就诊前要向医生说明的信息。'});
 await app.jobs.drain();
 const run=await request('/api/runs/'+accepted.run_id);
 const result=run.result_id?app.store.get(login.user.id,'result',run.result_id):null;
 const binding=app.store.all('runtime_binding',login.user.id).find(b=>b.run_id===run.id);
 const success=run.status==='completed'&&!run.execution_error&&!run.error&&result?.kind==='assistant_reply'&&!!result.payload?.speech&&binding?.evidence?.correlations?.length>=3;
 const evidence={label:'REAL_AGNES_CHAT_SMOKE',passed:!!success,run_id:run.id,status:run.status,error:run.execution_error?.code||run.error?.code||null,reply:result?.payload||null,sdk_evidence:binding?.evidence||null};
 await writeFile(join(directory,'evidence.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(success?'通过：网页同用的对话接口已收到真实模型回复，SDK 工具回执核验成功。':`未通过：状态 ${run.status}，错误 ${evidence.error||'RECEIPT_NOT_VERIFIED'}。请检查 Agnes 账号额度、网络和模型配置。`);
 console.log('合成测试记录：'+join(directory,'evidence.json'));
 if(!success)process.exitCode=1;
}catch(error){console.error('对话检查失败。请先运行 npm run setup、npm run configure:agh、npm run verify:agh-runtime，再检查网络和 Agnes 账号。');process.exitCode=1;}
finally{if(app)await app.close();else await runtime?.close();}
