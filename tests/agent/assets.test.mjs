import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyApprovedAssets} from '../../agents/runtime/assets.mjs';
import {TOOL_NAMES} from '../../agents/runtime/boundary.mjs';
test('reviewed source assets are exact and five plugin JSON schemas equal frozen contracts',async()=>{
 assert.match(await verifyApprovedAssets(),/^[a-f0-9]{20}$/);
 const schemas=JSON.parse(await readFile(new URL('../../agents/runtime/plugin/schemas.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(schemas).sort(),[...TOOL_NAMES].sort());
 for(const name of TOOL_NAMES)assert.deepEqual(schemas[name],JSON.parse(await readFile(new URL('../../contracts/schemas/'+name+'.json',import.meta.url),'utf8')));
});
import {execFileSync} from 'node:child_process';
test('account/source environment selection is explicit and model runtime cannot write inside protected account/source roots',async()=>{
 const sourcePath='/tmp/healththread-pinned-source',accountPath='/tmp/healththread-readonly-account';const output=execFileSync(process.execPath,['--input-type=module','-e',"const b=await import('./scripts/build-agh-runtime.mjs');const h=await import('./agents/runtime/host.mjs');console.log(JSON.stringify([b.AGH_ROOT,h.EXISTING_AGH_HOME,h.EXISTING_AGH_PROFILE]));try{await h.createRuntime({home:h.EXISTING_AGH_HOME+'/runtime'});}catch(e){console.log(e.code);}"],{cwd:new URL('../../',import.meta.url),env:{...process.env,AGH_ROOT:sourcePath,AGH_ACCOUNT_HOME:accountPath,AGH_ACCOUNT_PROFILE:'configured-profile'},encoding:'utf8'}).trim().split('\n');
 assert.deepEqual(JSON.parse(output[0]),[sourcePath,accountPath,'configured-profile']);assert.equal(output[1],'AGH_HOME_NOT_ISOLATED');
});
