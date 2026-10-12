import {check} from './domain-errors.mjs';
const calendarDate=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,10)===x;
const valid=(x)=>check(x,'INVALID_AGENT_OUTPUT',422);
export function keys(value,allowed,required=allowed) {valid(value && typeof value==='object'&&!Array.isArray(value));valid(Object.keys(value).every(k=>allowed.includes(k)));valid(required.every(k=>Object.hasOwn(value,k)));}
export function validateEvidence(evidence,readSource) {
 valid(Array.isArray(evidence)&&evidence.length>0&&evidence.length<=20);
 return evidence.map(e=>{keys(e,['source_id','source_text_version','locator','quote']);keys(e.locator,['page','start','end']);const s=readSource(e.source_id),{start,end,page}=e.locator;
 valid(s.text_version===e.source_text_version&&Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>=0&&end>start&&end<=s.text.length&&typeof e.quote==='string'&&s.text.slice(start,end)===e.quote);
 valid(start===0||/[。！？!?\n；;]/.test(s.text[start-1]));valid(end===s.text.length||/[。！？!?\n；;]/.test(s.text[end-1]));
 if(s.pages?.length)valid(Number.isSafeInteger(page)&&s.pages.some(p=>p.page===page&&start>=p.start&&end<=p.end));else valid(page===null);
 return {source:s,evidence:e};});
}
export function validateCandidate(c,readSource) {
 keys(c,['field','value','assertion','temporal_scope','effective_time','evidence','proposal_kind','fact_id','expected_version','episode_id'],['field','value','assertion','temporal_scope','effective_time','evidence','proposal_kind']);
 valid(['reported_text','symptom','diagnosis','medication','instruction','allergy','test','observation'].includes(c.field));
 valid(['affirmed','negated','uncertain'].includes(c.assertion)&&['current','past','unknown'].includes(c.temporal_scope));
 valid(['new','correction','retraction'].includes(c.proposal_kind));
 const refs=validateEvidence(c.evidence,readSource);
 // Intentionally conservative: preserve a complete source sentence verbatim, not an inferred diagnosis or dose.
 valid(typeof c.value==='string'&&refs.every(({evidence:e})=>e.quote===c.value));
 for(const {source:s,evidence:e} of refs){const {start,end}=e.locator;valid(start===0||/[。！？!?\n；;]/.test(s.text[start-1]));valid(end===s.text.length||/[。！？!?\n；;]/.test(s.text[end-1]));}
 // Each reference must support the rendered value itself. Unrelated sentences cannot lend semantics.
 const quote=c.value;
 const neg=/(否认|未见|没有|无|未发现|\bno\b|\bdenies\b|\bwithout\b)/i.test(quote);
 const uncertain=/(考虑|待排|可能|疑似|不确定|不详|\bpossible\b|\bsuspected\b|\bmay\b)/i.test(quote);
 valid(!/(未提及|未询问|不详|not mentioned|not assessed)/i.test(quote));
 valid(c.assertion===(uncertain?'uncertain':neg?'negated':'affirmed'));
 const past=/(既往|曾|以前|过去|去年|\bhistory of\b|\bpreviously\b)/i.test(quote);
 const current=/(目前|现在|今日|今天|当前|\bcurrently\b|\btoday\b)/i.test(quote);
 valid(!(past&&current));
 valid(c.temporal_scope===(past?'past':current?'current':'unknown'));
 if(c.field==='instruction')valid(refs.every(x=>x.source.kind==='medical_document')&&/(请|嘱|建议|按时|每日|每天|复查|复诊|\btake\b|\breturn\b|\brecord\b)/i.test(quote)&&!neg&&!uncertain&&!past);
 if(c.field==='diagnosis')valid(/(诊断|确诊|考虑|待排|疑似|diagnos)/i.test(quote));
 if(c.field==='medication')valid(/(服用|用药|药物|口服|静滴|\bmedication\b|\btake\b)/i.test(quote));
 if(c.field==='allergy')valid(/(过敏|allerg)/i.test(quote));
 if(c.field==='test')valid(/(检查|检验|报告|化验|test|scan)/i.test(quote));
 const time=c.effective_time;keys(time,['raw','precision','start','end','timezone','anchor_source_id']);valid(['exact','interval','relative','unknown'].includes(time.precision));valid(refs.some(x=>x.source.id===time.anchor_source_id));
 valid(time.timezone===null||time.timezone==='Asia/Shanghai'||time.timezone==='UTC');
 if(time.precision==='unknown')valid((time.raw===null||(typeof time.raw==='string'&&time.raw.length>0&&quote.includes(time.raw)))&&time.start===null&&time.end===null);
 else {valid(typeof time.raw==='string'&&time.raw.length>0&&quote.includes(time.raw));if(time.precision==='relative')valid(time.start===null&&time.end===null);else {valid(calendarDate(time.start)&&time.raw.includes(time.start));valid(time.end===null||(calendarDate(time.end)&&time.raw.includes(time.end)&&time.end>=time.start));valid(time.precision!=='interval'||time.end!==null);}}
 return structuredClone(c);
}
