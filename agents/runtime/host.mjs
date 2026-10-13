import {mkdir,readFile,writeFile,readdir,stat,realpath,cp} from 'node:fs/promises';
import {join,resolve,dirname,basename,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {AGH_ROOT} from '../../scripts/build-agh-runtime.mjs';
import {verifyApprovedAssets} from './assets.mjs';
import {assertAgnes,assertTools,createBindings,runtimeError,TOOL_NAMES} from './boundary.mjs';
const project=fileURLToPath(new URL('../../',import.meta.url));
const source=fileURLToPath(new URL('./',import.meta.url));
const packageId='@healththread/runtime';
import {AGH_ACCOUNT_HOME,AGH_ACCOUNT_PROFILE} from '../../scripts/runtime-paths.mjs';
export const EXISTING_AGH_HOME=AGH_ACCOUNT_HOME;
export const EXISTING_AGH_PROFILE=AGH_ACCOUNT_PROFILE;
const quiet={debug(){},info(){},warn(){},error(){}};
const inside=(root,p)=>{const rel=relative(root,p);if(rel==='..'||rel.startsWith('..'+sep))throw runtimeError('AGH_SKILL_PATH');return p;};
async function futureRealpath(path){try{return await realpath(path);}catch(error){if(error.code!=='ENOENT')throw error;return join(await futureRealpath(dirname(path)),basename(path));}}
export async function loadRuntime(){
 const artifact=join(project,'.runtime/agh-dist/runtime.mjs');
 const proof=JSON.parse(await readFile(join(dirname(artifact),'provenance.json'),'utf8'));
 const lock=JSON.parse(await readFile(join(project,'agents/harness.lock.json'),'utf8'));
 if(proof.commit!==lock.commit||proof.sha256!==createHash('sha256').update(await readFile(artifact)).digest('hex'))throw runtimeError('AGH_BUILD_PROVENANCE');
 return import(pathToFileURL(artifact).href);
}
export async function createRuntime({home,fixture,runConnection=false,accountHome=EXISTING_AGH_HOME,accountProfile=EXISTING_AGH_PROFILE}={}){
 const assetGeneration=await verifyApprovedAssets();home??=join(resolve(project,process.env.HEALTHTHREAD_AGH_HOME||'.runtime/agh-home'),'releases',assetGeneration);
 accountHome=await futureRealpath(resolve(accountHome));home=await futureRealpath(resolve(home));for(const protectedRoot of [accountHome,await futureRealpath(resolve(AGH_ROOT))])if(home===protectedRoot||home.startsWith(protectedRoot+sep))throw runtimeError('AGH_HOME_NOT_ISOLATED');
 const api=await loadRuntime();const {host:H,sdk,local:L,base:B,packages:P,resources:R}=api;
 home=resolve(home);const profileName='healththread'; const dataDir=join(home,'data'),profileDir=join(home,'profiles',profileName),workspace=join(home,'workspace'),cacheDir=join(home,'cache');
 for(const dir of [home,dataDir,profileDir,workspace,cacheDir])await mkdir(dir,{recursive:true,mode:0o700});
 const bindings=createBindings();const bridgeId=randomUUID();
 const configuration=fixture?{get:async()=>fixture.status,profileInput:async()=>fixture.profileInput}:H.createConfigurationService({home:accountHome,profile:accountProfile});
 const selected=assertAgnes(await configuration.get());
 const providerInput=await configuration.profileInput();
 const routes=providerInput.provider.routes.filter(r=>r.route===selected.route);
 if(routes.length!==1)throw runtimeError('AGNES_ROUTE_REQUIRED');
 const bootstrapProfile=await H.resolveProfile({builtin:'local-dev',user:{name:profileName,dataDir,cacheDir,policy:{capabilityCeiling:['hooks','slots','events','resources','ui','artifacts'],workspacePackages:'deny'},computerUse:{enabled:false}}},{platform:{os:process.platform,arch:process.arch,capabilities:{}},agnesVersion:'0.0.0',now:new Date().toISOString(),homeDir:home});
 await P.snapshotPolicy(profileDir,bootstrapProfile,'0.0.0');
 const manager=P.createPackageManager({dataDir,cwd:source,agnesVersion:'0.0.0'});
 const packageSource=P.parseSource('file:./plugin');
 const preview=await manager.inspect(profileDir,packageSource);
 let inventory=await manager.inventory(profileDir);
 if(inventory.packages.length===0){await manager.install(profileDir,packageSource,{expectedIntegrity:preview.integrity});inventory=await manager.inventory(profileDir);const pkg=inventory.packages[0];await manager.trust(profileDir,packageId,{integrity:pkg.entry.integrity,capabilityHash:pkg.capabilityHash});await manager.setEnabled(profileDir,packageId,true,{expectedInstalledIntegrity:preview.integrity});}
 inventory=await manager.inventory(profileDir);const pkg=inventory.packages[0];
 if(inventory.packages.length!==1||pkg?.id!==packageId||pkg.entry.integrity!==preview.integrity||!pkg.trusted||!pkg.entry.state.enabled||pkg.blockers.length)throw runtimeError('AGH_PLUGIN_NOT_READY');
 const pinId=P.activeRuntimePinId({packageId,integrity:pkg.entry.integrity});
 if(!(await manager.listRuntimePins(profileDir)).some(p=>p.pinId===pinId))await manager.pinRuntimeSnapshot(profileDir,{pinId,operationId:randomUUID(),packageId,purpose:'active',selector:{kind:'installed',expectedIntegrity:pkg.entry.integrity,expectedTreeIntegrity:pkg.entry.treeIntegrity}});
 const snapshots=await manager.runtimePluginSnapshots(profileDir);
 if(snapshots.length!==1||!snapshots[0].trusted||snapshots[0].snapshot.packageId!==packageId)throw runtimeError('AGH_PLUGIN_PIN_REQUIRED');
 const skillsPath=join(workspace,'.agh/skills'); await mkdir(skillsPath,{recursive:true,mode:0o700});
 const skillNames=['health-record','visit-preparation','post-visit','health-assistant'];
 for(const name of skillNames){const expected=await readFile(join(source,'skills',name,'SKILL.md'));await mkdir(join(skillsPath,name),{recursive:true,mode:0o700});const target=join(skillsPath,name,'SKILL.md');try{if(!expected.equals(await readFile(target)))throw runtimeError('AGH_SKILL_REVISION');}catch(e){if(e.code!=='ENOENT')throw e;await writeFile(target,expected,{mode:0o600,flag:'wx'});}}
 const canonicalRoot=await realpath(skillsPath);
 const checked=async path=>inside(canonicalRoot,await realpath(path));
 const fs={async list(p){return(await readdir(await checked(p),{withFileTypes:true})).map(e=>({name:e.name,kind:e.isDirectory()?'dir':e.isFile()?'file':'symlink'}));},async stat(p){const s=await stat(await checked(p));return{kind:s.isDirectory()?'dir':'file',size:s.size,mtimeMs:s.mtimeMs};},async read(p){const path=await checked(p);if((await stat(path)).size>262144)throw runtimeError('AGH_SKILL_SIZE');return readFile(path);},realpath:checked};
 const root={scope:'workspace',rootKey:'workspace-agnes',priority:500,path:skillsPath,workspaceKey:B.workspaceSkillKey(await realpath(workspace))};
 const scan=await B.discoverSkillRoot(fs,root);
 const candidates=scan.candidates;
 if(candidates.length!==skillNames.length||candidates.some(s=>!skillNames.includes(s.name))||scan.skipped?.length)throw runtimeError('AGH_SKILL_DISCOVERY');
 const barrier=H.createExtensionActivationBarrier();
 const skills=R.createSkillCandidateRegistry({barrier,canRead:(_resource,session)=>{try{bindings.lookup(session.sessionKey);return true;}catch{return false;}}});
 skills.replaceRoot('workspace-agnes',candidates);skills.setControl({desired:candidates.map(s=>({resourceId:s.resourceId,state:'enabled'})),trust:candidates.map(s=>({resourceId:s.resourceId,revision:s.revision,capabilityHash:s.capabilityHash,state:'trusted'}))});
 await skills.activate(randomUUID(),async()=>{});
 if(skills.actual().length!==skillNames.length||skills.actual().some(s=>s.actual!=='ready'||s.trust!=='trusted'||s.desired!=='enabled'||!s.resolution.winner))throw runtimeError('AGH_SKILL_NOT_READY');
 const profile=await H.resolveProfile({builtin:'local-dev',lock:P.lockState(P.readLock(profileDir,{profile:profileName,agnesVersion:'0.0.0'}),{profileDir}).lock,user:{name:profileName,dataDir,cacheDir,packages:[{id:'@agnes/code',source:'builtin',tombstone:true},{id:packageId,source:'file:./plugin',enabled:true}],provider:{...providerInput.provider,routes,catalog:{include:[]}},...(providerInput.adapters?{adapters:providerInput.adapters}:{}),presets:{default:'healththread',allowed:['healththread']},policy:{capabilityCeiling:['hooks','slots','events','resources','ui','artifacts'],workspacePackages:'deny'},computerUse:{enabled:false},commandHooks:{trustedUnconfined:[]}}},{platform:{os:process.platform,arch:process.arch,capabilities:{}},agnesVersion:'0.0.0',now:new Date().toISOString(),homeDir:home});
 await P.snapshotPolicy(profileDir,profile,'0.0.0');
 const jiti=H.createLoader({cacheDir,hostRoot:dirname(fileURLToPath(import.meta.url)),agnesVersion:'0.0.0'});const external=H.createJitiPackageLoader(jiti);
 const declarations=['approval','principals','artifacts','checkpoint','ledger','verifier','repair','harness'].map(n=>({export:n+'Plugin',id:'seam:'+n,runtime:'in-process',default:true}));
 const loader={async importPackage(id,dir){if(id==='@agnes/ai')return H.readNamedExports(id,join(source,'compiled-ai.mjs'),api.ai);if(id==='@agnes/base'){const{extensionEntry,...module}=H.readNamedExports(id,join(source,'compiled-base.mjs'),B,declarations);return{...module,embeddedExtensions:api.baseManifests};}if(id!==packageId)throw runtimeError('AGH_PACKAGE_BOUNDARY');return external.importPackage(id,dir);}};
 let harness,client,endpoint;let registryHash;
 const assertRegistry=()=>{if(!harness)throw runtimeError('AGH_HOST_NOT_READY');const snapshot=harness.kernel.tools.snapshot(0);assertTools([...snapshot.byName.keys()]);for(const tool of snapshot.byName.values())if(tool.source.trust!=='trusted'||tool.packageIdentity!==packageId)throw runtimeError('AGH_TOOL_PROVENANCE');if(registryHash&&snapshot.hash!==registryHash)throw runtimeError('AGH_REGISTRY_CHANGED');return snapshot;};
 const bridge={bindings,assertRegistry,async admit(key){bindings.lookup(key);assertRegistry();const session=harness.kernel.get(key);if(!session)throw runtimeError('AGH_SCOPE_INVALID');const rows=await H.scanAll(q=>session.scan(q),{type:'tool/result',fromSeq:1,toSeq:session.lastSeq});for(const row of rows)if(row.data.isError===true)bindings.reject(key,'tool-result:'+row.seq);},assertRequest(request,ctx){bindings.lookup(ctx.session.key);assertTools(request.toolNames);if(request.model!==selected.model)throw runtimeError('AGNES_MODEL_REQUIRED');}};
 const bridgeSymbol=Symbol.for('healththread.bootstrap.bridge');globalThis[bridgeSymbol]??=new Map();globalThis[bridgeSymbol].set(bridgeId,bridge);
 try{
 const prompter= L.createPrompterBridge();
 harness=await H.createHost(profile,{dataDir,profileDir,workspaceRoot:workspace,hostRoot:dirname(fileURLToPath(import.meta.url)),homeDir:home,loader,extensionLoader:jiti,packageDirs:new Map(profile.packages.filter(p=>p.enabled).map(p=>[p.id,p.id===packageId?P.packageDir(dataDir,profileName,p.id):source])),log:quiet,prompter:prompter.prompter,runtimePluginSnapshots:snapshots,skillResources:skills.snapshot(),activationBarrier:barrier,ordinaryPluginLayers:{deployment:{'ext:healththread/runtime':{enabled:true,config:{bridgeId}}}},...(fixture?{providerFactory:()=>({...fixture.provider,infer:fixture.provider.infer.bind(fixture.provider)})}: {})});
 const allowedRows=new Set(['seam:approval','seam:principals','seam:artifacts','seam:checkpoint','seam:ledger','seam:verifier','seam:repair','seam:harness','ext:healththread/runtime']);
 await harness.extensionRows.apply(harness.extensionRows.current().filter(row=>allowedRows.has(row.id)));
 registryHash=assertRegistry().hash;
 const infer=harness.provider.infer.bind(harness.provider);harness.provider.infer=function(request,opts){assertRegistry();assertTools(request.tools.map(t=>t.name));assertTools(opts.toolNames);if(request.route!==selected.route||request.model!==selected.model)throw runtimeError('AGNES_ROUTE_REQUIRED');if(!JSON.stringify(request).includes('<active_skill>'))throw runtimeError('AGH_SKILL_NOT_PRELOADED');return infer(request,opts);};
 const workspaces=new L.WorkspaceCatalog(new L.MemoryWorkspaceStore(),new L.MemorySessionWorkspaces(),H.resolveWorkspaceDirectory,()=>Date.now());await workspaces.add(workspace);
 endpoint=L.createLocalEndpoint(harness,{workspaces});prompter.bind(endpoint.prompter);
 client=sdk.createClient({transport:{kind:'inproc',endpoint},auth:{kind:'local'},journal:sdk.memoryJournal(),timeouts:{request:120000,initialize:10000}});await client.initialize();
 const readiness={tools:[...TOOL_NAMES],toolFingerprints:Object.fromEntries([...assertRegistry().byName].map(([name,tool])=>[name,tool.definitionFingerprint])),registryHash,profileHash:profile.hash,skills:skills.actual().map(({name,resourceId,revision,actual,trust,desired})=>({name,resourceId,revision,actual,trust,desired})),plugins:snapshots.map(s=>({id:s.snapshot.packageId,integrity:s.snapshot.integrity,treeIntegrity:s.snapshot.treeIntegrity,snapshotId:s.snapshot.snapshotId,trusted:s.trusted,pinId})),provider:selected.provider,route:selected.route,model:selected.model,fixture:!!fixture,assetGeneration};
 await writeFile(join(home,'installation.json'),JSON.stringify(readiness,null,2)+'\n',{mode:0o600});
 const children=new Set(),pending=new Set();let closePromise;
 const close=()=>closePromise??=(async()=>{await Promise.allSettled([...pending]);await Promise.allSettled([...children].map(child=>child.close()));try{await client.close();}finally{try{await endpoint.close();}finally{await harness.close();}}})();
 return Object.freeze({client,bindings,workspace,selected,readiness,
  lifecycle(){return{activeRunConnections:children.size,pendingRunConnections:pending.size,retainedSdkSessions:client.sessions.size,closed:!!closePromise};},
  async isReady(){if(closePromise)throw runtimeError('AGH_RUNTIME_CLOSED');assertRegistry();if(configuration){const current=assertAgnes(await configuration.get());if(current.route!==selected.route||current.model!==selected.model)throw runtimeError('AGNES_CONFIGURATION_CHANGED');}return true;},
  async openRun(){
   if(closePromise||runConnection)throw runtimeError('AGH_RUNTIME_CLOSED');
   const opening=(async()=>{let child;try{child=await createRuntime({home:join(home,'runs',randomUUID()),fixture,runConnection:true,accountHome,accountProfile});await child.isReady();if(closePromise)throw runtimeError('AGH_RUNTIME_CLOSED');const handle=Object.freeze({...child,async close(){try{await child.close();}finally{children.delete(handle);}}});children.add(handle);return handle;}catch(error){await child?.close();throw error;}})();
   pending.add(opening);try{return await opening;}finally{pending.delete(opening);}
  },close});
 }catch(error){await client?.close().catch(()=>{});await endpoint?.close().catch(()=>{});await harness?.close().catch(()=>{});throw error;}finally{globalThis[bridgeSymbol].delete(bridgeId);}
}
