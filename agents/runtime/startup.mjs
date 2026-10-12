import {buildRuntime} from '../../scripts/build-agh-runtime.mjs';
import {runtimeError} from './boundary.mjs';
import {createRuntime} from './host.mjs';
export const runtimeStatus=runtime=>runtime?'独立 Host + SDK 已就绪，五个受限业务工具':'未就绪，原文仍可保存，模型任务会明确阻塞';
export async function prepareRuntime({build=buildRuntime,create=createRuntime,log=message=>console.error(message)}={}){
 let provisional;
 try{await build();provisional=await create();if(!await provisional.isReady())throw runtimeError('AGH_NOT_READY');return provisional;}
 catch(error){await provisional?.close().catch(()=>{});log('AGH unavailable: '+(typeof error.code==='string'?error.code:'AGH_SETUP_REQUIRED')+'. See agents/runtime/README.md for isolated runtime setup.');return null;}
}
