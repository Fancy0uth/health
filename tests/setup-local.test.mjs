import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {setupLocal} from '../scripts/setup-local.mjs';
test('first setup creates private local login settings; repeated setup preserves existing settings',async t=>{
 const project=await mkdtemp(join(tmpdir(),'ht-local-'));t.after(()=>rm(project,{recursive:true,force:true}));
 const result=await setupLocal(project);assert.equal(result.created,true);assert.ok(result.password.length>=16);
 const saved=await readFile(join(project,'.env'),'utf8');assert.match(saved,/HEALTHTHREAD_DEMO_AUTH=1/);assert.ok(saved.includes(result.password));assert.doesNotMatch(saved,/AGH_ROOT|AGH_ACCOUNT_HOME|API_KEY/);
 if(process.platform!=='win32')assert.equal((await stat(join(project,'.env'))).mode&0o777,0o600);
 await writeFile(join(project,'.env'),'CUSTOM=keep\n');assert.deepEqual(await setupLocal(project),{created:false});assert.equal(await readFile(join(project,'.env'),'utf8'),'CUSTOM=keep\n');
});
