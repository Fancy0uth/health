import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
const project=fileURLToPath(new URL('../',import.meta.url));
function paths(extra={}){const env={...process.env};for(const key of ['AGH_ROOT','AGH_ACCOUNT_HOME','AGH_HOME','AGH_ACCOUNT_PROFILE'])delete env[key];return JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',`const b=await import(${JSON.stringify(new URL('../scripts/build-agh-runtime.mjs',import.meta.url).href)});const h=await import(${JSON.stringify(new URL('../agents/runtime/host.mjs',import.meta.url).href)});console.log(JSON.stringify([b.AGH_ROOT,h.EXISTING_AGH_HOME,h.EXISTING_AGH_PROFILE]));`],{cwd:'/tmp',env:{...env,...extra},encoding:'utf8'}));}
test('an unconfigured clone resolves Harness and account inside itself, independent of cwd',()=>{assert.deepEqual(paths(),[join(project,'.runtime/agnes-harness'),join(project,'.runtime/agh-account'),'local-dev']);});
test('relative overrides are project relative and account override wins over legacy alias',()=>{assert.deepEqual(paths({AGH_ROOT:'vendor/harness',AGH_ACCOUNT_HOME:'private/account',AGH_HOME:'ignored'}),[join(project,'vendor/harness'),join(project,'private/account'),'local-dev']);});
