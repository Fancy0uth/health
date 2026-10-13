import test from 'node:test';
import assert from 'node:assert/strict';
import {eligibleChatRetries} from '../../packages/client/chat-result.js';

const run=(id,status,extra={})=>({id,status,workflow:'chat',conversation_id:'conversation',created_at:'2026-10-13T01:00:00Z',source_ids:['source'],...extra});
test('chat retry restores failed, blocked and interrupted latest turns only',()=>{
  for(const status of ['failed','blocked','interrupted'])assert.deepEqual(eligibleChatRetries([run('latest',status)]).map(r=>r.id),['latest']);
  for(const extra of [{status:'cancelled'},{deleted:true},{result_id:'reply'},{fact_change_id:'change'}])assert.deepEqual(eligibleChatRetries([run('latest','failed',extra)]),[]);
});
test('chat retry follows retry lineage, blocks active conversations, and excludes previous turns',()=>{
  const failed=run('old','failed');
  assert.deepEqual(eligibleChatRetries([failed,run('retry','interrupted',{parent_run_id:'old'})]).map(r=>r.id),['retry']);
  for(const status of ['queued','running','completed'])assert.deepEqual(eligibleChatRetries([failed,run('next',status,{created_at:'2026-10-13T02:00:00Z',source_ids:['new-source']})]),[]);
  assert.deepEqual(eligibleChatRetries([failed,run('other','running',{conversation_id:'other'})]).map(r=>r.id),['old']);
});
