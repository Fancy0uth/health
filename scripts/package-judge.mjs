import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmod,copyFile,lstat,mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const NODE_VERSION='24.14.0';
export const TARGETS=Object.freeze({
 'macos-arm64':{archive:`node-v${NODE_VERSION}-darwin-arm64.tar.gz`,platform:'darwin',arch:'arm64'},
 'macos-x64':{archive:`node-v${NODE_VERSION}-darwin-x64.tar.gz`,platform:'darwin',arch:'x64'},
 'windows-x64':{archive:`node-v${NODE_VERSION}-win-x64.zip`,platform:'win32',arch:'x64'},
});
const project=fileURLToPath(new URL('../',import.meta.url));
const exact=new Set(['package.json','agents/harness.lock.json','agents/runtime/approved-assets.json','agents/runtime/host.mjs','agents/runtime/assets.mjs','agents/runtime/boundary.mjs','agents/runtime/startup.mjs','scripts/launch-judge.mjs','scripts/runtime-paths.mjs','scripts/build-agh-runtime.mjs','.runtime/agh-dist/runtime.mjs','.runtime/agh-dist/provenance.json','.runtime/agh-dist/AGH-LICENSE','.runtime/agh-dist/NOTICE']);
export function isPayloadFile(path){
 if(path.includes('\\')||path.split('/').some(p=>p==='..'||(p.startsWith('.')&&p!=='.runtime')))return false;
 if(exact.has(path))return true;
 if(/^(apps\/(web|mobile|setup)|packages\/client)\//.test(path))return /\.(html|css|js|mjs|svg|png|jpg|jpeg|webp|ico|woff2?)$/.test(path)||/\/package\.json$/.test(path);
 if(/^services\/api\//.test(path))return /\.mjs$/.test(path)||path==='services/api/package.json';
 if(/^agents\/runtime\/skills\/[a-z-]+\/SKILL\.md$/.test(path))return true;
 return /^agents\/runtime\/plugin\/(index\.mjs|package\.json|schemas\.json|LICENSE|NOTICE)$/.test(path);
}
async function walk(root,relative='',visit){
 for(const item of (await readdir(join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
  const path=relative?`${relative}/${item.name}`:item.name;
  if(item.isDirectory())await walk(root,path,visit);else await visit(path,item);
 }
}
export async function copyPayload(source,dest){
 // Restrict traversal as well as copied extensions. Never inspect account homes or databases.
 const roots=['apps/web','apps/mobile','apps/setup','packages/client','services/api','agents/runtime'];
 const candidates=new Set(exact);
 for(const root of roots){try{const info=await lstat(join(source,root));if(info.isSymbolicLink())throw new Error(`Payload symlink rejected: ${root}`);await walk(source,root,async path=>{if(isPayloadFile(path))candidates.add(path);});}catch(e){if(e.code!=='ENOENT')throw e;}}
 for(const path of [...candidates].sort()){
  let info;try{info=await lstat(join(source,path));}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(info.isSymbolicLink())throw new Error(`Payload symlink rejected: ${path}`);
  if(!info.isFile())throw new Error(`Payload must be a regular file: ${path}`);
  await mkdir(dirname(join(dest,path)),{recursive:true});await copyFile(join(source,path),join(dest,path));
 }
}
const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
export function verifyNodeArchive(bytes,checksums,filename){
 const line=checksums.split(/\r?\n/).map(l=>l.trim().split(/\s+/)).find(parts=>parts[1]===filename);
 const actual=sha256(bytes);if(!line||!/^\w{64}$/.test(line[0])||line[0]!==actual)throw new Error(`Node archive checksum mismatch or missing: ${filename}`);return actual;
}
export async function writeManifest(root,target,metadata={}){
 const files={};await walk(root,'',async path=>{if(path!=='distribution-manifest.json')files[path]=sha256(await readFile(join(root,path)));});
 const manifest={product:'HealthThread',formatVersion:1,target,nodeVersion:NODE_VERSION,...metadata,files};await writeFile(join(root,'distribution-manifest.json'),JSON.stringify(manifest,null,2)+'\n');return manifest;
}
export function launcherContents(target){
 if(target.startsWith('macos-'))return '#!/bin/sh\nROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)"\nexport HEALTHTHREAD_BUNDLED=1\nexec "$ROOT/Resources/node/bin/node" --disable-warning=ExperimentalWarning "$ROOT/Resources/app/scripts/launch-judge.mjs"\n';
 return 'Option Explicit\r\nDim shell, fs, root, q\r\nSet shell = CreateObject("WScript.Shell")\r\nSet fs = CreateObject("Scripting.FileSystemObject")\r\nroot = fs.GetParentFolderName(WScript.ScriptFullName)\r\nq = Chr(34)\r\nshell.Environment("PROCESS")("HEALTHTHREAD_BUNDLED") = "1"\r\nshell.Run q & root & "\\node\\node.exe" & q & " --disable-warning=ExperimentalWarning " & q & root & "\\app\\scripts\\launch-judge.mjs" & q, 0, False\r\n';
}
async function download(url){
 const response=await fetch(url,{signal:AbortSignal.timeout(180000)});if(!response.ok)throw new Error(`Download failed (${response.status}): ${url}`);return Buffer.from(await response.arrayBuffer());
}
async function getNode(target,cache){
 const {archive}=TARGETS[target];await mkdir(cache,{recursive:true});const base=`https://nodejs.org/dist/v${NODE_VERSION}/`;
 const sumPath=join(cache,`SHASUMS256-v${NODE_VERSION}.txt`);let sums;try{sums=await readFile(sumPath,'utf8');}catch(e){if(e.code!=='ENOENT')throw e;sums=(await download(base+'SHASUMS256.txt')).toString();await writeFile(sumPath,sums);}
 const path=join(cache,archive);let bytes;try{bytes=await readFile(path);}catch(e){if(e.code!=='ENOENT')throw e;bytes=await download(base+archive);verifyNodeArchive(bytes,sums,archive);await writeFile(path,bytes);}
 const digest=verifyNodeArchive(bytes,sums,archive);return{path,digest};
}
function instructions(target){return `HealthThread — Judge Edition\n\n1. Extract the entire ZIP before opening the app.\n${target.startsWith('macos-')?'2. Open HealthThread.app. If macOS blocks this unsigned hackathon build, use System Settings > Privacy & Security > Open Anyway only after confirming its source. Do not disable system security.\n':'2. Double-click Start HealthThread.vbs. If your organization disables Windows Script Host, use Start HealthThread.cmd (a console window will appear).\n'}3. Your browser opens the local setup page. Connect your own Agnes account there; no Node.js, Git, terminal setup, or developer credentials are needed.\n4. Keep the application running while reviewing. To stop it, end the HealthThread process in Activity Monitor / Task Manager.\n\nNode.js ${NODE_VERSION} and the pinned Agnes Harness runtime are bundled. Internet access and an authorized Agnes account are required for real model responses. This package contains no patient records or account credentials. Your account settings and application data are stored in your operating system's user application-data directory, outside this package.\n\nThis hackathon build is unsigned and not notarized. It does not install a service or require administrator rights. Choose the archive matching your computer: macOS arm64 for Apple Silicon, macOS x64 for Intel, Windows x64 for 64-bit Intel/AMD Windows.\n\nThird-party licenses: the node directory includes Node's LICENSE, and app/.runtime/agh-dist includes the Agnes Harness license and NOTICE. distribution-manifest.json records the target, runtime version, upstream archive hash, and file hashes.\n`;}
export async function packageTarget(target,{source=project,output=join(project,'dist')}={}){
 if(!TARGETS[target])throw new Error(`Unknown target ${target}; expected ${Object.keys(TARGETS).join(', ')}`);
 const proof=JSON.parse(await readFile(join(source,'.runtime/agh-dist/provenance.json'),'utf8'));const lock=JSON.parse(await readFile(join(source,'agents/harness.lock.json'),'utf8'));
 if(proof.commit!==lock.commit||proof.sha256!==sha256(await readFile(join(source,'.runtime/agh-dist/runtime.mjs'))))throw new Error('Harness build provenance mismatch. Rebuild the pinned runtime before packaging.');
 for(const required of ['scripts/launch-judge.mjs','apps/setup/index.html'])await readFile(join(source,required));
 await mkdir(output,{recursive:true});const node=await getNode(target,join(output,'.node-cache'));const temp=await mkdtemp(join(output,`.package-${target}-`));
 try{
  const unpack=join(temp,'node-unpacked');await mkdir(unpack);if(target.startsWith('macos-'))execFileSync('tar',['-xzf',node.path,'-C',unpack]);else execFileSync('unzip',['-q',node.path,'-d',unpack]);
  const nodeSource=join(unpack,(await readdir(unpack))[0]);const stage=join(temp,'stage');await mkdir(stage);
  const mac=target.startsWith('macos-');const top=join(stage,mac?'HealthThread.app':'HealthThread');const resources=mac?join(top,'Contents/Resources'):top;const app=join(resources,'app');
  await copyPayload(source,app);
  // Omit developer machine paths while retaining the exact build digest and pinned commit.
  await writeFile(join(app,'.runtime/agh-dist/provenance.json'),JSON.stringify({commit:proof.commit,sha256:proof.sha256,node:proof.node,build:proof.build},null,2)+'\n');
  const nodeDest=join(resources,'node');await mkdir(join(nodeDest,mac?'bin':''),{recursive:true});await copyFile(join(nodeSource,mac?'bin/node':'node.exe'),join(nodeDest,mac?'bin/node':'node.exe'));await copyFile(join(nodeSource,'LICENSE'),join(nodeDest,'LICENSE'));
  if(mac){
   const executable=join(top,'Contents/MacOS/HealthThread');await mkdir(dirname(executable),{recursive:true});await writeFile(executable,launcherContents(target),{mode:0o755});await chmod(join(nodeDest,'bin/node'),0o755);
   await writeFile(join(top,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleName</key><string>HealthThread</string><key>CFBundleDisplayName</key><string>HealthThread</string><key>CFBundleIdentifier</key><string>app.healththread.judge</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleExecutable</key><string>HealthThread</string><key>LSMinimumSystemVersion</key><string>13.5</string><key>LSUIElement</key><true/></dict></plist>\n`);
  }else{
   await writeFile(join(top,'Start HealthThread.vbs'),launcherContents(target));await writeFile(join(top,'Start HealthThread.cmd'),'@echo off\r\nsetlocal DisableDelayedExpansion\r\nset "HEALTHTHREAD_BUNDLED=1"\r\n"%~dp0node\\node.exe" --disable-warning=ExperimentalWarning "%~dp0app\\scripts\\launch-judge.mjs"\r\nif errorlevel 1 pause\r\n');
  }
  await writeFile(join(mac?stage:top,'READ ME.txt'),instructions(target));await copyFile(join(source,'docs/distribution/评委版使用说明.md'),join(mac?stage:top,'READ ME - Chinese.md'));await writeManifest(mac?stage:top,target,{nodeArchive:TARGETS[target].archive,nodeArchiveSHA256:node.digest,harnessCommit:lock.commit});
  const archive=resolve(output,`HealthThread-${target}.zip`);await rm(archive,{force:true});execFileSync('zip',['-q','-r',archive,...(await readdir(stage))],{cwd:stage,maxBuffer:10*1024*1024});
  const archiveDigest=sha256(await readFile(archive));await writeFile(archive+'.sha256',`${archiveDigest}  HealthThread-${target}.zip\n`);console.log(`${archive}\nSHA256 ${archiveDigest}`);return archive;
 }finally{await rm(temp,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);const targetArg=args.find(a=>a.startsWith('--target='));const target=targetArg?.slice(9)||args[0]||'all';
 for(const item of target==='all'?Object.keys(TARGETS):[target])await packageTarget(item);
}
