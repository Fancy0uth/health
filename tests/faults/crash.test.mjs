import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {DispatchQueue} from '../../services/api/domain-jobs.mjs';
for(const phase of ['before_commit','queued','running','needs_review','continuation'])test(`SIGKILL ${phase} preserves atomic receipt and exact durable recovery phase`,{timeout:10000},async t=>{
 // Removing transaction atomicity, restart interruption, or checkpoint durability breaks this test.
 const dir=await mkdtemp(join(tmpdir(),'ht-process-crash-')),dbPath=join(dir,'domain.sqlite');const child=fork(fileURLToPath(new URL('../fixtures/crash-worker.mjs',import.meta.url)),[dbPath,phase],{stdio:['ignore','ignore','pipe','ipc']});let store,queue;let stderr='';child.stderr.on('data',x=>stderr+=x);t.after(async()=>{if(child.exitCode===null&&!child.signalCode)child.kill('SIGKILL');await queue?.close();store?.close();await rm(dir,{recursive:true,force:true});});
 const barrier=await Promise.race([once(child,'message').then(([m])=>m),once(child,'exit').then(([code])=>{throw new Error(`child exited ${code}: ${stderr}`);})]);const exited=once(child,'exit');child.kill('SIGKILL');const [code,signal]=await exited;assert.equal(code,null);assert.equal(signal,'SIGKILL');store=new DomainStore({dbPath});
 if(phase==='before_commit'){assert.equal(store.all('source',barrier.uid).length,0);assert.equal(store.all('entry',barrier.uid).length,0);assert.equal(store.all('run',barrier.uid).length,0);assert.equal(store.all('dispatch',barrier.uid).length,0);assert.equal(store.db.prepare('SELECT count(*) n FROM receipts').get().n,0);return;}
 const a=barrier.accepted;assert.equal(store.get(barrier.uid,'source',a.source_id).text,'医嘱：记录症状。');assert.deepEqual(store.accept(barrier.uid,'document',{text:'医嘱：记录症状。'},'crash-accept-key-000001'),{entry_id:a.entry_id,source_id:a.source_id,document_id:a.document_id,run_id:a.run_id,operation_id:a.operation_id,saved:true});assert.equal(store.all('entry',barrier.uid).length,1);assert.equal(store.get(barrier.uid,'operation',a.operation_id).saved,true);
 const run=store.get(barrier.uid,'run',a.run_id);assert.equal(run.status,phase==='running'?'interrupted':phase==='continuation'?'completed':phase);
 if(phase==='running'){assert.equal(run.error.code,'RUN_INTERRUPTED');assert.equal(store.all('fact_revision',barrier.uid).length,0);}
 if(phase==='needs_review'){assert.equal(store.get(barrier.uid,'fact_change',a.fact_change_id).proposals[0].value,'医嘱：记录症状。');assert.equal(store.profile(barrier.uid).facts.length,0);}
 if(phase==='continuation'){assert.equal(store.profile(barrier.uid).facts.length,1);assert.equal(store.get(barrier.uid,'run',a.confirmation.continuation_run_id).status,'queued');assert.equal(store.all('care_task',barrier.uid).length,0);}
 if(phase==='queued'||phase==='continuation'){queue=new DispatchQueue(store,null);await queue.drain();const resumed=store.get(barrier.uid,'run',phase==='queued'?a.run_id:a.confirmation.continuation_run_id);assert.equal(resumed.status,'blocked');assert.equal(resumed.error.code,'AGENT_NOT_CONFIGURED');assert.equal(store.all('source',barrier.uid).length,1);}
});
