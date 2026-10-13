import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {isPayloadFile,copyPayload,writeManifest,verifyNodeArchive,NODE_VERSION,TARGETS,launcherContents} from '../scripts/package-judge.mjs';

test('distribution allowlist excludes local credentials, source checkout, and patient data',()=>{
 for(const name of ['apps/web/index.html','apps/setup/app.js','services/api/server.mjs','agents/runtime/skills/health-record/SKILL.md','.runtime/agh-dist/runtime.mjs','scripts/launch-judge.mjs'])assert.equal(isPayloadFile(name),true,name);
 for(const name of ['.env','.env.local','.runtime/agh-account/credentials.json','.runtime/agnes-harness/package.json','services/api/patient.db','services/api/credentials.json','apps/web/secrets.json','agents/runtime/key.pem','agents/development/README.md','tests/server.test.mjs','node_modules/a.js'])assert.equal(isPayloadFile(name),false,name);
});
test('payload rejects symlinks and copies only distributable files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'judge-package-'));try{
 const source=join(root,'source'),out=join(root,'out');await mkdir(join(source,'apps/web'),{recursive:true});await writeFile(join(source,'apps/web/index.html'),'hello');await writeFile(join(source,'apps/web/.env'),'secret');
 await copyPayload(source,out);assert.equal(await readFile(join(out,'apps/web/index.html'),'utf8'),'hello');await assert.rejects(readFile(join(out,'apps/web/.env')),{code:'ENOENT'});
 await symlink(join(source,'apps/web/index.html'),join(source,'apps/web/app.js'));await assert.rejects(copyPayload(source,join(root,'out2')),/symlink/i);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('manifest binds target, Node version, and every shipped file digest',async()=>{
 const root=await mkdtemp(join(tmpdir(),'judge-manifest-'));try{
 await writeFile(join(root,'hello.txt'),'hello');const manifest=await writeManifest(root,'macos-arm64',{nodeArchiveSHA256:'abc',harnessCommit:'def'});
 assert.equal(manifest.nodeVersion,'24.14.0');assert.equal(manifest.target,'macos-arm64');assert.equal(manifest.files['hello.txt'],createHash('sha256').update('hello').digest('hex'));assert.equal(JSON.parse(await readFile(join(root,'distribution-manifest.json'),'utf8')).harnessCommit,'def');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('official Node checksum is required and mismatches fail closed',()=>{
 const bytes=Buffer.from('test archive'),filename=TARGETS['windows-x64'].archive;const digest=createHash('sha256').update(bytes).digest('hex');
 assert.equal(NODE_VERSION,'24.14.0');assert.equal(verifyNodeArchive(bytes,`${digest}  ${filename}\n`,filename),digest);
 assert.throws(()=>verifyNodeArchive(bytes,`${'0'.repeat(64)}  ${filename}\n`,filename),/checksum/i);
 assert.throws(()=>verifyNodeArchive(bytes,`${digest}  other.zip\n`,filename),/checksum/i);
});
test('desktop launchers use bundled runtimes and quote paths with spaces',()=>{
 const mac=launcherContents('macos-arm64'),win=launcherContents('windows-x64');
 assert.match(mac,/HEALTHTHREAD_BUNDLED=1/);assert.match(mac,/"\$ROOT\/Resources\/node\/bin\/node"/);assert.match(mac,/launch-judge\.mjs/);
 assert.match(win,/HEALTHTHREAD_BUNDLED/);assert.match(win,/Chr\(34\)/);assert.match(win,/node\\node\.exe/);assert.match(win,/, 0, False/);
});
