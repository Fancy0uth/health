// Synthetic acceptance smoke only, using the configured Agnes route through actual Host + SDK.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DomainStore} from '../services/api/domain-store.mjs';
import {DispatchQueue} from '../services/api/domain-jobs.mjs';
import {AgnesAgent} from '../services/api/agnes-agent.mjs';
import {createRuntime} from '../agents/runtime/host.mjs';
const evidenceRoot=resolve('.runtime/evidence');await mkdir(evidenceRoot,{recursive:true,mode:0o700});
const directory=await mkdtemp(join(evidenceRoot,'real-synthetic-'));
const runtime=await createRuntime();const store=new DomainStore({dbPath:join(directory,'synthetic.sqlite'),demoAccounts:[{username:'synthetic',password:'synthetic-'+randomUUID()}]});
const uid=store.db.prepare('SELECT id FROM users WHERE username=?').get('synthetic').id;store.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});
const agent=new AgnesAgent({runtime,store});const queue=new DispatchQueue(store,agent);const evidence={label:'REAL_AGNES_SYNTHETIC',started_at:new Date().toISOString(),readiness:runtime.readiness,cases:[]};
async function capture(name,runId){await queue.drain();const run=store.internalRun(runId);const binding=store.all('runtime_binding',uid).find(b=>b.run_id===runId);const factChange=run.fact_change_id?store.get(uid,'fact_change',run.fact_change_id):null;const result=run.result_id?store.get(uid,'result',run.result_id):null;const row={name,run_id:run.id,workflow:run.workflow,status:run.status,error:run.error?.code||run.execution_error?.code||null,repair_attempts:run.repair_attempts||0,agh:run.runtime?.agh||null,diagnostic:binding?.diagnostic||null,sdk_evidence:binding?.evidence||null,candidate_values:factChange?.proposals?.map(c=>({field:c.field,value:c.value,assertion:c.assertion,temporal_scope:c.temporal_scope}))||null,result:result?.payload||null};evidence.cases.push(row);console.log(JSON.stringify({name,status:row.status,error:row.error,repairs:row.repair_attempts,receipts:run.tool_receipts.length,diagnostic:row.diagnostic}));return run;}
try{
 const w1=store.accept(uid,'entry',{text:'目前没有头痛。'},'synthetic-w1-'+randomUUID());await capture('W1',w1.run_id);
 const w2=store.accept(uid,'visit',{current_concern:'今天想向医生说明夜间咳嗽。'},'synthetic-w2-'+randomUUID());await capture('W2',w2.run_id);
 const w3=store.accept(uid,'document',{text:'医嘱：每日记录症状。\n医嘱：三天后复诊。',name:'合成就诊资料'},'synthetic-w3-'+randomUUID());const staged=await capture('W3-extract',w3.run_id);
 if(staged.status==='needs_review'&&!staged.execution_error){const change=store.get(uid,'fact_change',staged.fact_change_id);const confirmed=store.confirm(uid,change.id,{expected_profile_revision:store.profile(uid).profile_revision,accepted_change_ids:change.proposals.map(c=>c.id)},'synthetic-confirm-'+randomUUID());if(confirmed.continuation_run_id)await capture('W3-continuation',confirmed.continuation_run_id);}
}finally{evidence.finished_at=new Date().toISOString();await writeFile(join(directory,'evidence.json'),JSON.stringify(evidence,null,2)+'\n',{mode:0o600});await queue.close();store.close();console.log('Sanitized synthetic evidence: '+join(directory,'evidence.json'));}
