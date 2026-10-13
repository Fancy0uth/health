import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHealthThreadServer} from '../services/api/server.mjs';
import {AgnesAgent} from '../services/api/agnes-agent.mjs';
import {prepareRuntime,runtimeStatus} from '../agents/runtime/startup.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const mode=process.env.AGENT_MODE||'agnes';
if(!['agnes','disabled'].includes(mode))throw new Error('AGENT_MODE 必须为 agnes 或 disabled。');
let runtime;try{runtime=mode==='agnes'?await prepareRuntime({required:true}):null;}catch{process.exit(1);}
let demoAccounts=[];
if(process.env.HEALTHTHREAD_DEMO_AUTH==='1'){
 if(!process.env.HEALTHTHREAD_DEMO_USERNAME||!process.env.HEALTHTHREAD_DEMO_PASSWORD)throw new Error('Explicit demo username and password are required.');
 demoAccounts=[{username:process.env.HEALTHTHREAD_DEMO_USERNAME,password:process.env.HEALTHTHREAD_DEMO_PASSWORD}];
}
const app=createHealthThreadServer({demoAccounts,databasePath:resolve(root,process.env.HEALTHTHREAD_DB_PATH||'.runtime/healththread-domain.sqlite'),agentFactory:runtime?store=>new AgnesAgent({runtime,store}):null});
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||4173);await app.listen(port,host);
console.log(`HealthThread: http://${host}:${port}/\n电脑版：/web/\n手机版：/mobile/\nAGH：${runtimeStatus(runtime)}`);
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await app.close();process.exit(0);});
