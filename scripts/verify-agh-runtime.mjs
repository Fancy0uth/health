import {createRuntime} from '../agents/runtime/host.mjs';
const runtime=await createRuntime();try{await runtime.isReady();console.log(JSON.stringify({status:'ready',inference_performed:false,...runtime.readiness},null,2));}finally{await runtime.close();}
