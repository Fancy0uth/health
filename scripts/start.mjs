import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHealthThreadServer} from '../services/api/server.mjs';
import {AgnesAgent} from '../services/api/agnes-agent.mjs';
import {createRuntime} from '../agents/runtime/host.mjs';
import {buildRuntime} from './build-agh-runtime.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
let runtime=null;
if((process.env.AGENT_MODE||'agnes')==='agnes'){
 try{await buildRuntime();runtime=await createRuntime();await runtime.isReady();}
 catch(error){console.error('AGH unavailable: '+(typeof error.code==='string'?error.code:'AGH_SETUP_REQUIRED')+'. See agents/runtime/README.md for isolated runtime setup.');}
}
let demoAccounts=[];
if(process.env.HEALTHTHREAD_DEMO_AUTH==='1'){
 if(!process.env.HEALTHTHREAD_DEMO_USERNAME||!process.env.HEALTHTHREAD_DEMO_PASSWORD)throw new Error('Explicit demo username and password are required.');
 demoAccounts=[{username:process.env.HEALTHTHREAD_DEMO_USERNAME,password:process.env.HEALTHTHREAD_DEMO_PASSWORD}];
}
const app=createHealthThreadServer({demoAccounts,databasePath:resolve(root,process.env.HEALTHTHREAD_DB_PATH||'.runtime/healththread-domain.sqlite'),agentFactory:runtime?store=>new AgnesAgent({runtime,store}):null});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4173);await app.listen(port,host);
console.log(`HealthThread: http://${host}:${port}/\n电脑版：/web/\n手机版：/mobile/\nAGH：${runtime?'独立 Host + SDK 已就绪，五个受限业务工具':'未就绪，原文仍可保存，模型任务会明确阻塞'}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
