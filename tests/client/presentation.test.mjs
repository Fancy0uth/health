import test from 'node:test';
import assert from 'node:assert/strict';
let candidateHtml,claimHtml,cardText,capabilityText;
try {({candidateHtml,claimHtml,cardText,capabilityText}=await import('../../packages/client/presentation.js'));} catch(e) {if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
test('both native views expose full escaped candidate semantics, exact locators and episode association',()=>{
  assert.ok(candidateHtml,'domain evidence presentation required');
  const markup=candidateHtml({id:'proposal-1',field:'reported_text',value:'<script>原句</script>',assertion:'uncertain',temporal_scope:'past',effective_time:{raw:'去年',precision:'relative',start:null,end:null},episode_id:'episode-1',evidence:[{source_id:'source-1',source_text_version:1,quote:'<script>原句</script>',locator:{page:2,start:9,end:29}}]},{selected:true,mobile:false});
  for(const text of ['proposal-1','reported_text','uncertain','past','去年','relative','episode-1','第 2 页','[9,29)','&lt;script&gt;']) assert.ok(markup.includes(text),text);
  assert.ok(!markup.includes('<script>'));
});
test('source-only W2 claims remain unreviewed self-report and copied stale card preserves provenance',()=>{
  assert.ok(claimHtml,'claim provenance renderer required');
  const result={validity:'stale',payload:{speech:'原困扰。',questions:['要补充什么？'],unknowns:['未记录'],claims:[{text:'原困扰。',fact_refs:[],evidence:[{source_id:'source-1',source_text_version:1,quote:'原困扰。',locator:{page:null,start:0,end:5}}]}]},dependencies:[{source_id:'source-1',source_text_version:1}]};
  assert.match(claimHtml(result.payload.claims[0]),/未核对.*自述/);
  const copied=cardText(result);for(const text of ['已过期','未核对','source-1','[0,5)','原困扰。']) assert.ok(copied.includes(text));
  for(const capability of ['department','triage','audio','ocr']) assert.ok(capabilityText(capability).length>5);
});
test('primary candidate review uses patient-facing semantics; internal IDs and enums are folded',()=>{
  assert.ok(candidateHtml);
  const markup=candidateHtml({id:'candidate-secret',episode_id:'episode-secret',field:'symptom',value:'原句。',assertion:'negated',temporal_scope:'past',effective_time:{precision:'relative',raw:'去年'},evidence:[{source_id:'source-secret',source_text_version:1,quote:'原句。',locator:{page:2,start:1,end:4}}]});
  const primary=markup.replace(/<details[\s\S]*?<\/details>/g,'').replace(/<[^>]*>/g,'');
  assert.ok(primary.includes('症状'));assert.ok(primary.includes('自述否认'));assert.ok(primary.includes('既往'));assert.ok(primary.includes('相对时间'));assert.ok(primary.includes('第 2 页'));
  for(const internal of ['candidate-secret','episode-secret','source-secret','symptom','negated','UTF-16']) assert.ok(!primary.includes(internal),internal);
});
test('copying an edited card keeps its edited questions and the original source evidence',()=>{
  const result={status:'stale',payload:{speech:'原稿',questions:['原来的问题'],unknowns:[],claims:[{text:'原文内容。',fact_refs:[],evidence:[{source_id:'source-evidence',source_text_version:1,quote:'原文内容。',locator:{page:null,start:0,end:5}}]}]}};
  const copied=cardText(result,{localDraft:'用户修改后的表达稿',localQuestions:['用户修改后的问题']});
  assert.match(copied,/用户修改后的表达稿/);assert.match(copied,/用户修改后的问题/);assert.match(copied,/source-evidence/);assert.match(copied,/原文内容/);assert.match(copied,/已过期/);assert.ok(!copied.includes('原来的问题'));
});
test('copied server-saved card edit is current patient wording with original evidence retained',()=>{
 const result={user_edit:{speech:'已保存的修改',questions:['已保存的问题？'],revision:1},payload:{speech:'原稿',questions:['旧问题？'],claims:[{text:'来源原句。',evidence:[{source_id:'original-source',quote:'来源原句。',locator:{page:null,start:0,end:5}}],fact_refs:[]}],unknowns:[]}};
 const copied=cardText(result);assert.match(copied,/已保存的修改/);assert.match(copied,/已保存的问题/);assert.match(copied,/来源原句/);assert.ok(!copied.includes('旧问题'));assert.ok(!copied.includes('本机打印草稿'));
});
