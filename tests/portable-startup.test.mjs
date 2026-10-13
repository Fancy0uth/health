import test from 'node:test';import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {prepareRuntime} from '../agents/runtime/startup.mjs';
test('required real runtime fails startup instead of serving a model-disabled page',async()=>{
 const messages=[];const error=Object.assign(new Error('private credential must not be logged'),{code:'AGENT_NOT_CONFIGURED'});
 await assert.rejects(prepareRuntime({required:true,build:async()=>{throw error;},log:m=>messages.push(m)}));
 assert.match(messages.join('\n'),/configure:agh/);assert.doesNotMatch(messages.join('\n'),/private credential/);
});
test('npm start with missing Harness exits with installation guidance',()=>{
 const result=spawnSync(process.execPath,['scripts/start.mjs'],{cwd:new URL('../',import.meta.url),env:{...process.env,AGENT_MODE:'agnes',AGH_ROOT:'/nonexistent-healththread-source',HEALTHTHREAD_DB_PATH:'/nonexistent-no-db-write/db.sqlite'},encoding:'utf8',timeout:10000});
 assert.equal(result.status,1);assert.match(result.stderr,/npm run setup/);assert.doesNotMatch(result.stdout,/电脑版/);
});
