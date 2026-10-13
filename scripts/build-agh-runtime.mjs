import { createRequire } from 'node:module';
import { resolve,join,dirname } from 'node:path';
import { mkdir,readFile,readdir,writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {PROJECT,AGH_ROOT} from './runtime-paths.mjs';
export {PROJECT,AGH_ROOT};
export async function buildRuntime(){
 const lock=JSON.parse(await readFile(join(PROJECT,'agents/harness.lock.json'),'utf8'));
 let commit;try{commit=execFileSync('git',['rev-parse','HEAD'],{cwd:AGH_ROOT,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();}catch{throw Object.assign(new Error('Harness 尚未安装。请运行 npm run setup。'),{code:'AGH_SOURCE_MISSING'});}
 if(commit!==lock.commit)throw Object.assign(new Error('Harness 版本不匹配。请核对 AGH_ROOT，或在新目录运行 npm run setup。'),{code:'AGH_PIN_MISMATCH'});
 if(execFileSync('git',['diff','HEAD','--name-only'],{cwd:AGH_ROOT,encoding:'utf8'}).trim())throw new Error('AGH_SOURCE_DIRTY');
 const req=createRequire(join(AGH_ROOT,'packages/cli/package.json')); let build;try{({build}=req('esbuild'));}catch{throw Object.assign(new Error('Harness 依赖未安装。请运行 npm run setup:agh。'),{code:'AGH_DEPENDENCIES_MISSING'});}
 const packages=join(AGH_ROOT,'packages'); const textMap=async(dir,ext)=>Object.fromEntries(await Promise.all((await readdir(dir)).filter(n=>n.endsWith('.'+ext)).map(async n=>[n.slice(0,-ext.length-1),await readFile(join(dir,n),'utf8')])));
 const manifests=async p=>Promise.all((JSON.parse(await readFile(join(packages,p,'package.json'),'utf8')).agnes.extensions||[]).map(n=>readFile(join(packages,p,n,'agnes.extension.json'),'utf8').then(JSON.parse)));
 const defines={AGNES_VERSION:'"0.0.0"',AGNES_COMPOSED_WORKER:'true',AGNES_PACKAGED_BUILTINS:'true',AGNES_BASE_PRESET_TEXT:JSON.stringify(await readFile(join(packages,'base/presets/base.yaml'),'utf8')),AGNES_PROFILE_TEMPLATE_TEXTS:JSON.stringify(await textMap(join(packages,'host/templates'),'yaml')),AGNES_CC_HOOK_MAP_TEXT:JSON.stringify(await readFile(join(packages,'base/extensions/hooks-runner/generated/cc-hook-map.json'),'utf8')),AGNES_CONFORMANCE_FIXTURE_TEXTS:JSON.stringify(await textMap(join(packages,'ai/fixtures/conformance'),'jsonl'))};
 const baseManifests=await manifests('base');
 const contents=`export * as host from '@agnes/host'; export * as sdk from '@agnes/sdk'; export * as local from '@agnes/daemon/local'; export * as base from '@agnes/base'; export * as ai from '@agnes/ai'; export * as packages from '@agnes/package-manager'; export * as resources from '@agnes/resource-control-runtime'; export const baseManifests=${JSON.stringify(baseManifests)};`;
 const output=join(PROJECT,'.runtime/agh-dist/runtime.mjs'); await mkdir(dirname(output),{recursive:true,mode:0o700});
 await build({stdin:{contents,resolveDir:join(packages,'cli'),sourcefile:'healththread-runtime-entry.mjs'},outfile:output,bundle:true,platform:'node',format:'esm',target:'node24',packages:'bundle',define:defines,legalComments:'eof',banner:{js:"import { createRequire as __aghRequire } from 'node:module'; const require=__aghRequire(import.meta.url);"},plugins:[{name:'bundle-jiti-transform',setup(b){b.onLoad({filter:/[\\/]jiti[\\/]lib[\\/]jiti\.mjs$/},({path})=>{const dist=join(dirname(path),'../dist');return {loader:'js',contents:`import {createRequire} from 'node:module'; import create from ${JSON.stringify(join(dist,'jiti.cjs'))}; import transform from ${JSON.stringify(join(dist,'babel.cjs'))}; export function createJiti(id,opts={}){return create(id,{...opts,transform:opts.transform||transform},{onError:e=>{throw e},nativeImport:id=>import(id),createRequire});} export default createJiti;`};});}}],logLevel:'warning'});
 await writeFile(join(dirname(output),'AGH-LICENSE'),await readFile(join(AGH_ROOT,'LICENSE')));
 await writeFile(join(dirname(output),'NOTICE'),'Built from AgnesAI-Labs/agnes-harness at '+commit+'. Upstream Apache-2.0 LICENSE is included. Jiti bundling adapts packages/cli build packaging. Bundled dependency legal comments are retained in runtime.mjs.\n');
 const digest=createHash('sha256').update(await readFile(output)).digest('hex');
 await writeFile(join(dirname(output),'provenance.json'),JSON.stringify({commit,aghRoot:AGH_ROOT,sha256:digest,node:process.version,build:'public Host + SDK + daemon/local; compiled ai/base; no model-facing native tools'},null,2)+'\n'); return output;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(await buildRuntime());
