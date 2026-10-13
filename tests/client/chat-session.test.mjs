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

test('card conversation replies ask for confirmation and report only persisted completion',async()=>{
  const result=await import('../../packages/client/chat-result.js');
  const payload={intent:'offer_visit',speech:'目前饭后腹胀。',questions:[],unknowns:[]};
  assert.match(result.assistantText(payload),/确认|同意/);
  assert.doesNotMatch(result.assistantText(payload),/已生成/);
  assert.equal(typeof result.assistantMessage,'function');
  const confirmed={...payload,intent:'confirm_visit'};
  const parent={id:'chat',continuation_run_id:'child'};
  assert.match(result.assistantMessage(confirmed,parent,[],[]).text,/正在/);
  assert.equal(result.assistantMessage(confirmed,parent,[],[]).action,null);
  const child={id:'child',status:'completed',result_id:'card',runtime:{mode:'fixture'}};
  assert.equal(result.assistantMessage(confirmed,parent,[child],[]).action,null,'staged run without loaded result cannot open a card');
  const card={id:'card',kind:'visit_preparation',run_id:'child'};
  const complete=result.assistantMessage(confirmed,parent,[child],[card]);
  assert.equal(complete.action,'card');assert.equal(complete.visit_result_id,'card');assert.match(complete.text,/已生成/);
  const failed=result.assistantMessage(confirmed,parent,[{...child,status:'failed'}],[card]);
  assert.equal(failed.action,null);assert.match(failed.text,/未完成/);assert.equal(failed.visit_retry_run_id,undefined,'a saved checkpoint cannot be retried as an empty failed run');assert.equal(failed.error,undefined,'card failure must not replay the chat request');
});

test('terminal execution states never keep showing receipt verification in progress',()=>{
 for(const status of ['failed','blocked','cancelled','interrupted'])assert.doesNotMatch(chat.executionLabel({status}),/正在/);
 assert.match(chat.executionLabel({status:'running'}),/正在/);
});

test('natural v2 replies render once without exposing evidence or question metadata',async()=>{
  const {assistantText}=await import('../../packages/client/chat-result.js');
  assert.equal(assistantText({format_version:2,intent:'clarify',reply:'这种腹胀持续多久了？',speech:'饭后腹胀。',questions:['重复的问题？'],claims:[]}), '这种腹胀持续多久了？');
});
test('record and visit outcomes project independently and only show a saved record after its receipt',async()=>{
  const {assistantMessage}=await import('../../packages/client/chat-result.js');
  const payload={format_version:2,intent:'confirm_both',reply:'好的，我来整理记录和沟通卡。',questions:[],claims:[]};
  const parent={id:'parent',continuation_run_id:'visit',continuation_record_run_id:'record'};
  const staged={id:'record',status:'needs_review',fact_change_id:'change'};
  assert.equal(assistantMessage(payload,parent,[staged],[]).record_status,'saving');
  const recorded={...staged,runtime:{mode:'fixture'}};
  let message=assistantMessage(payload,parent,[recorded,{id:'visit',status:'failed'}],[]);
  assert.equal(message.record_status,'needs_review');assert.equal(message.record_change_id,'change');assert.equal(message.visit_status,'failed');assert.match(message.text,/已保存.*待.*核对/);
  message=assistantMessage(payload,parent,[{id:'record',status:'failed'},{id:'visit',status:'completed',runtime:{mode:'fixture'},result_id:'card'}],[{id:'card',kind:'visit_preparation'}]);
  assert.equal(message.record_status,'failed');assert.equal(message.visit_status,'completed');assert.equal(message.visit_result_id,'card');
});

test('natural saved record summary keeps provenance out of the conversational body',async()=>{
 const {recordSummaryText}=await import('../../packages/client/record-dialogue.js');
 const text=recordSummaryText({summary:'你说腹胀主要发生在饭后。',source_ids:[],proposals:[{value:'腹胀',effective_time:{},evidence:[]}],missing_fields:[],questions:['会影响吃饭吗？']});
 assert.match(text,/你说腹胀主要发生在饭后/);assert.match(text,/会影响吃饭吗/);assert.doesNotMatch(text,/断言|时间范围|原文依据|精度/);
});

test('new chat keeps previous conversation sources when they are not health timeline entries',async()=>{
 const {DomainClient,MemoryStorage}=await import('../../packages/client/domain-client.js');
 const client=new DomainClient({storage:new MemoryStorage(),channel:null});
 try{client.state.user={id:'user'};client.state.runs={chat:{id:'chat',workflow:'chat',source_ids:['prior-chat']}};client.refresh=async()=>client.state;
 let submitted;client.submit=async(_operation,_path,payload)=>{submitted=payload;};await client.createChat('三天了。',['prior-chat','foreign']);
 assert.deepEqual(submitted.selected_source_ids,['prior-chat']);}finally{client.dispose();}
});

test('copying a v2 card includes its natural synthesis before source evidence',async()=>{
 const {cardText}=await import('../../packages/client/presentation.js');
 const text=cardText({id:'card',payload:{format_version:2,speech:'我这三天主要是饭后腹胀，想请医生帮我了解原因。',questions:[],claims:[{text:'三天。',evidence:[],fact_refs:[]}]}});
 assert.match(text,/我这三天主要是饭后腹胀/);assert.ok(text.indexOf('我这三天')<text.indexOf('三天。'));
});

test('assistant transport preserves record view receipt fields through the live reply',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
 const source=(await readFile(new URL('../../packages/client/chat.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const context=vm.createContext({window:{HEALTHTHREAD_API_URL:'/api/health-assistant'},requestAgent:async()=>({answer:'已保存，待核对。',record_status:'needs_review',record_change_id:'change',record_source_id:'source'})});vm.runInContext(source,context);
 const reply=await vm.runInContext("askAssistant('请保存')",context);assert.equal(reply.record_status,'needs_review');assert.equal(reply.record_change_id,'change');assert.equal(reply.record_source_id,'source');
});

test('recovering an accepted both action follows the record even when the card fails',async()=>{
 const {NativeBridge}=await import('../../packages/client/native-bridge.js');
 const bridge=new NativeBridge({subscribe(){},pendingOperations:()=>[{id:'operation',path:'/api/health-assistant',body:{question:'保存'}}],retryOperation:async()=>({run_id:'parent'})});
 bridge.linkChatSource=()=>{};bridge.refresh=async()=>{};const followed=[];
 bridge.wait=async id=>{followed.push(id);if(id==='parent')return {continuation_run_id:'visit',continuation_record_run_id:'record'};if(id==='visit')throw Object.assign(new Error('failed'),{code:'DEPENDENCY_UNAVAILABLE'});return {status:'needs_review'};};
 await bridge.recover();assert.deepEqual(followed,['parent','visit','record']);
});

for(const code of ['DEPENDENCY_UNAVAILABLE','INVALID_AGENT_OUTPUT','OUTPUT_REPAIR_EXHAUSTED'])test(`assistant runtime ${code} becomes a readable retry message while preserving diagnostics`,async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');
 const source=(await readFile(new URL('../../packages/client/chat.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export ','');
 const original=Object.assign(new Error(code+' provider diagnostic'),{code});
 const context=vm.createContext({window:{HEALTHTHREAD_API_URL:'/api/health-assistant'},requestAgent:async()=>{throw original;}});vm.runInContext(source,context);
 await assert.rejects(vm.runInContext("askAssistant('有点腹胀')",context),error=>{assert.match(error.message,/暂时.*回复|回复.*未完成/);assert.match(error.message,/重试/);assert.doesNotMatch(error.message,/DEPENDENCY|INVALID|REPAIR|provider/);assert.equal(error.code,code);assert.equal(error.cause,original);return true;});
});

test('retry transport carries the exact failed source instead of creating a new user turn',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');const source=(await readFile(new URL('../../packages/client/chat.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'').replaceAll('export ','');
 let body;const context=vm.createContext({window:{HEALTHTHREAD_API_URL:'/api/health-assistant'},requestAgent:async(_path,payload)=>{body=payload;return {answer:'回复'};}});vm.runInContext(source,context);
 await vm.runInContext("askAssistant('原问题',{retry_source_id:'saved-question'})",context);assert.equal(body.retry_source_id,'saved-question');
});

test('failed authorized children expose separate direct retry targets without conversational consent loops',async()=>{
 const {assistantMessage}=await import('../../packages/client/chat-result.js');
 const payload={format_version:2,intent:'confirm_both',reply:'我来整理。'};const parent={id:'parent',continuation_run_id:'visit',continuation_record_run_id:'record'};
 const message=assistantMessage(payload,parent,[{id:'visit',status:'failed'},{id:'record',status:'blocked'}]);
 assert.equal(message.visit_retry_run_id,'visit');assert.equal(message.record_retry_run_id,'record');assert.doesNotMatch(message.text,/回复“重试/);
 const cancelled=assistantMessage(payload,parent,[{id:'visit',status:'cancelled'},{id:'record',status:'needs_review',execution_error:{}}]);assert.equal(cancelled.visit_retry_run_id,undefined);assert.equal(cancelled.record_retry_run_id,undefined);
});
test('direct action retry follows only a currently linked failed child',async()=>{
 const {NativeBridge}=await import('../../packages/client/native-bridge.js');let retried,waited;
 const bridge=new NativeBridge({subscribe(){},state:{runs:{parent:{id:'parent',workflow:'chat',continuation_run_id:'failed'},failed:{id:'failed',status:'failed'}}},retryRun:async id=>{retried=id;return {run_id:'retry'};}});bridge.refresh=async()=>{};bridge.wait=async(id,options)=>{waited={id,options};};
 assert.equal(typeof bridge.retryAssistantAction,'function');await bridge.retryAssistantAction('failed');assert.equal(retried,'failed');assert.equal(waited.id,'retry');assert.equal(waited.options.requireRuntime,true);
 await assert.rejects(bridge.retryAssistantAction('unlinked'),error=>error.code==='RUN_NOT_RETRYABLE');
});

test('default poll budget includes the server queue and execution window and waits for staged receipt',async()=>{
 const {readFile}=await import('node:fs/promises'),vm=await import('node:vm');let now=0,reads=0;class ClockDate extends Date{static now(){return now;}}
 const code=(await readFile(new URL('../../packages/client/domain-client.js',import.meta.url),'utf8')).replaceAll('export ','');const context=vm.createContext({Date:ClockDate,crypto:globalThis.crypto,structuredClone,setTimeout,clearTimeout,AbortController,fetch:async()=>{}});vm.runInContext(code,context);const client=vm.runInContext('new DomainClient({storage:new MemoryStorage(),channel:null,pollMs:1})',context);
 client.ticket=()=>({});client.verifySession=async()=>{};client.check=()=>{};client.refresh=async()=>{};client.read=async path=>{if(path.includes('/results/'))return {id:'card'};reads++;now+=140000;return {id:'run',status:'completed',result_id:'card',...(reads>1?{runtime:{mode:'real'}}:{})};};
 try{const run=await client.pollRun('run',{requireRuntime:true});assert.equal(reads,2);assert.equal(run.runtime.mode,'real');}finally{client.dispose();}
});
