// The former prototype's assistant-JSON normalization is intentionally retired.
// Real Host + SDK workflow/receipt/cancellation tests live in tests/agent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {AgnesAgent} from '../services/api/agnes-agent.mjs';
test('adapter fails closed without a controlled Host runtime and trusted store',async()=>{
 const agent=new AgnesAgent({});await assert.rejects(agent.isReady(),{code:'AGENT_NOT_CONFIGURED'});
});
test('fixture runtime is explicitly labeled and cannot certify real Agnes execution',()=>{
 const agent=new AgnesAgent({runtime:{readiness:{fixture:true}},store:{}});assert.equal(agent.mode,'fixture');
});
