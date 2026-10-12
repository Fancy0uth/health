import test from 'node:test';
import assert from 'node:assert/strict';
import * as chat from '../../packages/client/chat.js';
test('an async assistant reply updates the current session after a canonical refresh replaces its objects',()=>{
  assert.equal(typeof chat.appendAssistantReply,'function');
  const original=[{id:'conversation',messages:[{role:'user',text:'准备就诊资料'}]}];
  const refreshed=structuredClone(original);
  assert.equal(chat.appendAssistantReply(refreshed,'conversation',{text:'先核对原话。',run_id:'run-1'}),true);
  assert.equal(refreshed[0].messages.at(-1).text,'先核对原话。');assert.equal(original[0].messages.length,1);
  chat.appendAssistantReply(refreshed,'conversation',{text:'同一保存结果重新读取。',run_id:'run-1'});assert.equal(refreshed[0].messages.length,2);
  assert.equal(chat.appendAssistantReply([], 'conversation',{text:'迟到的旧回复'}),false);
});
test('a receipt label cannot call fixture output or an unfinished run a verified Agnes response',()=>{
  assert.equal(chat.executionLabel({runtime:{mode:'fixture'}}),'测试模型输出');
  assert.notEqual(chat.executionLabel({status:'completed'}),'Agnes 模型 · AGH 回执已核验');
  assert.equal(chat.executionLabel({runtime:{mode:'real',agh:{provider:'agnes-ai',tool_receipt_ids:['read','retrieve','stage']}}}),'Agnes 模型 · AGH 回执已核验');
});
