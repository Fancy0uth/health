import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOL_NAMES, assertTools, assertAgnes, createBindings } from '../../agents/runtime/boundary.mjs';
test('tool admission rejects missing, extra, duplicate and hidden tools', () => {
  assert.doesNotThrow(() => assertTools([...TOOL_NAMES]));
  for (const names of [TOOL_NAMES.slice(1), [...TOOL_NAMES,'shell'], [...TOOL_NAMES,TOOL_NAMES[0]], ['run_code']]) assert.throws(() => assertTools(names), /TOOL_BOUNDARY/);
});
test('provider admission fails closed on unconfigured or non Agnes routes', () => {
  for (const config of [{}, {configured:true,provider:{id:'other',credentialConfigured:true,route:'account-x',model:'x'}}]) assert.throws(() => assertAgnes(config));
  assert.equal(assertAgnes({configured:true,provider:{id:'agnes-ai',credentialConfigured:true,route:'account-x',model:'agnes-3.0-flash'}}).route,'account-x');
});
test('trusted bindings reject forged keys, nested execution, revoked scopes, and third repair', async () => {
  const bindings=createBindings();
  const signal=new AbortController();
  const calls=[];
  bindings.reserve('trusted',{runId:'r',signal:signal.signal,tools:{healththread_read_source: args=>({source:args,receipt:{id:'receipt'}})},repair:()=>calls.push('repair')});
  assert.throws(()=>bindings.lookup('forged'), /SCOPE/);
  assert.throws(()=>bindings.context({session:{key:'trusted',depth:1,generationDepth:0}}), /SCOPE/);
  assert.equal((await bindings.execute('healththread_read_source',{source_id:'s'},{session:{key:'trusted',depth:0,generationDepth:0,toolUseId:'t'}})).receipt.id,'receipt');
  bindings.reject('trusted','bad1'); bindings.reject('trusted','bad2');
  assert.throws(()=>bindings.reject('trusted','bad3'),/REPAIR_LIMIT/);
  assert.equal(calls.length,2);
  signal.abort(); assert.throws(()=>bindings.lookup('trusted'));
});
