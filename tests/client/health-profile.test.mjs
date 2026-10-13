import test from 'node:test';
import assert from 'node:assert/strict';
let ui={};try{ui=await import('../../packages/client/health-profile.js');}catch(e){if(e.code!=='ERR_MODULE_NOT_FOUND')throw e;}
const comparison={fact_id:'old',revision:2,relation:'conflict',requires_resolution:true,old_snapshot:{value:'以前的原句',revision:2,effective_time:{raw:'去年'},evidence:[{source_id:'s-old',quote:'以前的原句'}]}};
const proposal={id:'new',value:'这次的原句',comparisons:[comparison],evidence:[{source_id:'s-new',quote:'这次的原句'}]};
test('reconciliation requires a choice for selected conflicts and keeps exact prior revision',()=>{
  assert.equal(typeof ui.selectedResolutions,'function');
  assert.throws(()=>ui.selectedResolutions({proposals:[proposal]},['new'],{}),/选择/);
  const choices={[ui.resolutionKey('new','old',2)]:'keep_existing'};
  assert.deepEqual(ui.selectedResolutions({proposals:[proposal]},['new'],choices),[{candidate_id:'new',fact_id:'old',revision:2,action:'keep_existing'}]);
  assert.deepEqual(ui.selectedResolutions({proposals:[proposal]},[],choices),[]);
});
test('reconciliation markup presents both exact sources and explicit defer without selecting a default',()=>{
  assert.equal(typeof ui.comparisonMarkup,'function');
  const html=ui.comparisonMarkup(proposal,{},'web');
  for(const word of ['以前的原句','这次的原句','去年','v2','s-old','s-new','keep_existing','replace','keep_both','defer'])assert.ok(html.includes(word),word);
  assert.doesNotMatch(html,/<option value="replace" selected/);
});
test('health profile renders typed observations and does not invent missing units, scores, or dates',()=>{
  assert.equal(typeof ui.healthProfileMarkup,'function');
  const profile={observations:[{dimension:'measurement',value:'体温 37.8',fact_id:'f',revision:1,review_status:'confirmed',source_refs:[{source_id:'s'}]}],current_problems:[{fact_id:'f',revision:1,value:'体温 37.8',review_status:'confirmed'}],unknowns:[{dimension:'self_rating',status:'not_recorded'}]};
  const html=ui.healthProfileMarkup(profile,'current_problems','web');
  assert.match(html,/体征与测量/);assert.match(html,/体温 37.8/);assert.doesNotMatch(html,/℃|2026|评分 0/);assert.match(html,/已核对/);assert.match(html,/s/);
  const unknown=ui.healthProfileMarkup(profile,'unknowns','mobile');assert.match(unknown,/自评程度/);assert.match(unknown,/未记录/);assert.doesNotMatch(unknown,/没有症状/);
  assert.match(ui.healthProfileMarkup(null,'current_problems','web'),/尚无结构化画像/);
});
test('care explanation remains separate from exact instruction and stale tasks accept feedback',()=>{
  assert.equal(typeof ui.careDetailsMarkup,'function');
  const html=ui.careDetailsMarkup({id:'task',version:4,text:'医嘱原句：明日复诊。',explanation:'带着原资料向医生核对。',questions:['需要带哪些资料？'],instruction_refs:[{fact_id:'f',revision:2}],validity:'stale'},'未保存的反馈','mobile',false);
  for(const word of ['医嘱原句：明日复诊。','模型解释','需要带哪些资料？','v2','未保存的反馈','已过期','care-feedback'])assert.ok(html.includes(word),word);
  assert.doesNotMatch(html,/data-action="care-feedback"[^>]*disabled/);
});
test('document status distinguishes running, failed, and actual reviewable candidates',()=>{
 assert.equal(typeof ui.documentStatusLabel,'function');
 assert.equal(ui.documentStatusLabel({analysis:'running',run_status:'running',proposals:[]}), '正在分析');
 const running=ui.documentAnalysisMarkup({source_id:'doc',analysis:'running',proposals:[]},'web');assert.match(running,/正在分析/);assert.doesNotMatch(running,/解析完成|暂无可确认候选/);
 const failed=ui.documentAnalysisMarkup({source_id:'doc',analysis:'failed',proposals:[]},'mobile');assert.match(failed,/重试分析/);assert.match(failed,/data-action="retry-medical"/);assert.match(failed,/data-id="doc"/);
 assert.equal(ui.documentStatusLabel({analysis:'complete',proposals:[{id:'p'}]}),'待核对');
});
test('measurement preserves its literal value without appending the unit twice',()=>{
 const html=ui.comparisonMarkup({id:'p',health_observations:[{dimension:'measurement',value:'今早体温37.2摄氏度',unit:'摄氏度',observed_at:'今早'}]});assert.equal((html.match(/摄氏度/g)||[]).length,1);assert.match(html,/今早体温37.2摄氏度/);
 const separate=ui.comparisonMarkup({id:'p',health_observations:[{dimension:'measurement',value:'37.2',unit:'摄氏度'}]});assert.match(separate,/37.2/);assert.match(separate,/摄氏度/);
});
test('event time uses literal observation times without inventing normalized dates or claiming missing source time',()=>{
 assert.equal(typeof ui.eventTimeText,'function');
 assert.equal(ui.eventTimeText({health_observations:[{dimension:'onset',value:'今天早饭后'}]}),'今天早饭后');
 assert.equal(ui.eventTimeText({health_observations:[{dimension:'measurement',value:'体温37.2摄氏度',observed_at:'今早'}]}),'今早');
 assert.equal(ui.eventTimeText({}),'未标准化（以原文为准）');
 const fact={fact_id:'f',revision:1,value:'本次身体感受',health_observations:[{dimension:'onset',value:'今天早饭后'}]};
 const current=ui.healthProfileMarkup({current_problems:[fact]},'current_problems');assert.match(current,/事件时间：今天早饭后/);assert.doesNotMatch(current,/事件时间：未记录/);
 const event=ui.healthProfileMarkup({events:[{id:'e',version:1,status:'active',facts:[fact]}]},'events');assert.match(event,/事件时间：今天早饭后/);assert.doesNotMatch(event,/事件时间：未记录/);
});
test('pending review summary includes deferred document proposals and excludes resolved rows',()=>{
 assert.equal(typeof ui.pendingReviewItems,'function');const rows=ui.pendingReviewItems({records:[{id:'record',proposals:[{id:'done',proposal_status:'confirmed'}]}],documents:[{source_id:'doc',review_state:'exceptions',proposals:[{id:'deferred',proposal_status:'deferred'},{id:'kept',proposal_status:'kept_existing'},{id:'new'}]}]});assert.equal(rows.length,1);assert.equal(rows[0].sourceId,'doc');assert.equal(rows[0].medical,true);assert.equal(rows[0].count,2);
});
test('care generation failure has a source-bound retry and disappears after its newer result',()=>{
 const runs={old:{id:'failed-care',document_id:'doc',workflow:'care_plan',status:'failed',source_ids:['source'],created_at:'2026-10-13T10:00:00Z'}};
 const failed=ui.careProgressMarkup(runs,'mobile');assert.match(failed,/医嘱解释未完成/);assert.match(failed,/data-action="retry-care-plan"/);assert.match(failed,/data-id="failed-care"/);assert.match(failed,/原医嘱/);
 runs.current={id:'new-care',document_id:'doc',workflow:'care_plan',status:'completed',parent_run_id:'failed-care',created_at:'2026-10-13T10:01:00Z'};assert.equal(ui.careProgressMarkup(runs),'');
});
