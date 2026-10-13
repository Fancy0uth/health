import {createRuntime} from '../agents/runtime/host.mjs';
let runtime;
try{
 runtime=await createRuntime();await runtime.isReady();
 console.log(JSON.stringify({status:'ready',inference_performed:false,...runtime.readiness},null,2));
}catch(error){
 const code=typeof error.code==='string'&&/^[A-Z][A-Z0-9_]+$/.test(error.code)?error.code:'AGH_SETUP_REQUIRED';
 console.error(`${code}: 请先运行 npm run setup 和 npm run configure:agh，再重新检查。此检查不执行模型推理；真实对话请运行 npm run verify:chat。`);process.exitCode=1;
}finally{await runtime?.close();}
