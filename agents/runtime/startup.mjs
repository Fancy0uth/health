import {buildRuntime} from '../../scripts/build-agh-runtime.mjs';
import {runtimeError} from './boundary.mjs';
import {createRuntime} from './host.mjs';
export const runtimeStatus=runtime=>runtime?'独立 Host + SDK 已就绪，五个受限业务工具':'未就绪，原文仍可保存，模型任务会明确阻塞';
export async function prepareRuntime({required=false,build=buildRuntime,create=createRuntime,log=message=>console.error(message)}={}){
 let provisional;
 try{await build();provisional=await create();if(!await provisional.isReady())throw runtimeError('AGH_NOT_READY');return provisional;}
 catch(error){await provisional?.close().catch(()=>{});const code=typeof error.code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(error.code)?error.code:'AGH_SETUP_REQUIRED';log('AGH unavailable: '+code+'. 安装：npm run setup；配置 Agnes 账号：npm run configure:agh；检查：npm run verify:agh-runtime。详见 README.md。');if(required)throw error;return null;}
}
