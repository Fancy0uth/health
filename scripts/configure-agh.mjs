import {createInterface} from 'node:readline';
import {pathToFileURL} from 'node:url';

const PROVIDER = 'agnes-ai';
const messages = Object.freeze({
 ACCOUNT_EXISTS:'An account already exists in this profile. Setup stopped without changing it. Use a new AGH_ACCOUNT_HOME for a separate account.',
 PROVIDER_UNAVAILABLE:'The bundled Agnes API-key provider is unavailable. Rebuild the pinned runtime.',
 KEY_REQUIRED:'An Agnes API key is required.',
 MODEL_REQUIRED:'Set AGNES_MODEL together with HEALTHTHREAD_AGNES_API_KEY for noninteractive setup.',
 MODEL_UNAVAILABLE:'Choose a model from the verified Agnes catalogue.',
 TEST_FAILED:'The Agnes credential or model catalogue could not be verified. Nothing was saved.',
 TERMINAL_REQUIRED:'Interactive setup needs a terminal to hide the API key.',
 CONFIGURATION_FAILED:'Agnes configuration failed. Check the runtime, connection, and account directory, then try again.',
 CLI_ARGUMENTS:'Setup does not accept command-line arguments or API keys. Run npm run configure:agh.',
});
function failure(code){return Object.assign(new Error(messages[code]),{code});}

// Only public Host ConfigurationService calls persist credentials. Never serialize keys here.
export async function configureAgnes({service,prompts,env={},write=()=>{}}){
 try {
  const current=await service.get();
  if(current.configured||current.provider||current.accounts?.length||current.revision!==0)throw failure('ACCOUNT_EXISTS');
  const {providers}=await service.providers();
  const matches=providers.filter(p=>p.id===PROVIDER&&p.authMethods?.includes('api-key'));
  if(matches.length!==1||typeof matches[0].baseUrl!=='string')throw failure('PROVIDER_UNAVAILABLE');
  const baseUrl=matches[0].baseUrl;
  const noninteractive=env.HEALTHTHREAD_AGNES_API_KEY!==undefined;
  if(noninteractive&&!env.AGNES_MODEL)throw failure('MODEL_REQUIRED');
  let apiKey=noninteractive?env.HEALTHTHREAD_AGNES_API_KEY:await prompts.secret('Agnes API key (hidden; Enter or Ctrl+C cancels): ');
  if(apiKey===null||apiKey===undefined||(!noninteractive&&!apiKey.trim()))return {status:'cancelled'};
  if(typeof apiKey!=='string'||!apiKey.trim()||/[\p{C}]/u.test(apiKey))throw failure('KEY_REQUIRED');
  apiKey=apiKey.trim();
  write('Verifying the Agnes connection and available models…\n');
  const result=await service.test({providerId:PROVIDER,baseUrl,apiKey});
  if(result.verified!==true||!Array.isArray(result.models)||!result.models.length)throw failure('TEST_FAILED');
  const models=result.models;
  // IDs originate in the pinned runtime, narrowed by the provider. Reject unsafe display data.
  if(models.some(m=>typeof m.id!=='string'||!m.id||m.id.length>256||/[\p{C}\s]/u.test(m.id)||m.id.includes(apiKey)))throw failure('TEST_FAILED');
  let model=env.AGNES_MODEL;
  if(!noninteractive){
   write(models.map((m,index)=>`${index+1}. ${m.id}`).join('\n')+'\n');
   const choice=await prompts.ask('Model number (Enter cancels): ');
   if(choice===null||choice===undefined||!choice.trim())return {status:'cancelled'};
   if(!/^[1-9][0-9]*$/.test(choice.trim()))throw failure('MODEL_UNAVAILABLE');
   model=models[Number(choice.trim())-1]?.id;
  }
  if(!models.some(m=>m.id===model))throw failure('MODEL_UNAVAILABLE');
  if(!noninteractive){
   const confirmation=await prompts.ask('Save this verified Agnes account? Type yes to save: ');
   if(confirmation?.trim().toLowerCase()!=='yes')return {status:'cancelled'};
  }
  // Expected revision also protects against another setup saving while prompts are open.
  const saved=await service.save({providerId:PROVIDER,baseUrl,apiKey,model,expectedRevision:0});
  apiKey='';
  if(!saved.configured||saved.provider?.id!==PROVIDER||saved.provider?.model!==model||!saved.provider?.credentialConfigured)throw failure('CONFIGURATION_FAILED');
  write('Agnes account configured. Credentials were saved by the Agnes credential store.\n');
  return {status:'configured',model};
 }catch(error){
  // Do not propagate upstream error text: network and credential failures can contain secrets.
  if(Object.hasOwn(messages,error?.code)&&error.message===messages[error.code])throw failure(error.code);
  throw failure('CONFIGURATION_FAILED');
 }
}

export function createTerminalPrompts({input=process.stdin,output=process.stdout}={}){
 return {
  async ask(prompt){
   if(!input.isTTY)throw failure('TERMINAL_REQUIRED');
   return new Promise(resolve=>{
    const reader=createInterface({input,output,terminal:true});let finished=false;
    const finish=value=>{if(finished)return;finished=true;reader.close();resolve(value);};
    reader.once('SIGINT',()=>finish(null));reader.once('close',()=>finish(null));reader.question(prompt,finish);
   });
  },
  async secret(prompt){
   if(!input.isTTY||typeof input.setRawMode!=='function')throw failure('TERMINAL_REQUIRED');
   return new Promise(resolve=>{
    let value='',finished=false;const wasRaw=!!input.isRaw;
    const finish=result=>{if(finished)return;finished=true;input.off('data',onData);input.off('end',onEnd);input.off('error',onEnd);input.setRawMode(wasRaw);input.pause();output.write('\n');resolve(result);};
    const onEnd=()=>finish(null);
    const onData=chunk=>{
     for(const character of chunk.toString('utf8')){
      if(character==='\u0003'||character==='\u0004'){finish(null);return;}
      if(character==='\r'||character==='\n'){finish(value);return;}
      if(character==='\u007f'||character==='\b'){value=value.slice(0,-1);continue;}
      if(!/[\p{C}]/u.test(character))value+=character;
     }
    };
    output.write(prompt);input.setRawMode(true);input.on('data',onData);input.once('end',onEnd);input.once('error',onEnd);input.resume();
   });
  },
 };
}

export async function main(){
 try{
  if(process.argv.length>2)throw failure('CLI_ARGUMENTS');
  const {loadRuntime}=await import('../agents/runtime/host.mjs');
  const {AGH_ACCOUNT_HOME,AGH_ACCOUNT_PROFILE}=await import('./runtime-paths.mjs');
  const {host}=await loadRuntime();
  const service=host.createConfigurationService({home:AGH_ACCOUNT_HOME,profile:AGH_ACCOUNT_PROFILE});
  const result=await configureAgnes({service,prompts:createTerminalPrompts(),env:process.env,write:text=>process.stdout.write(text)});
  if(result.status==='cancelled')process.stdout.write('Setup cancelled. Nothing was saved.\n');
 }catch(error){
  const code=Object.hasOwn(messages,error?.code)?error.code:'CONFIGURATION_FAILED';
  process.stderr.write(messages[code]+'\n');process.exitCode=1;
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
