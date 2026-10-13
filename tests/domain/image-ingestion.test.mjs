import test from 'node:test';
import assert from 'node:assert/strict';
import {extractDocument} from '../../services/api/document-extraction.mjs';
import {DomainStore} from '../../services/api/domain-store.mjs';
import {readFileSync} from 'node:fs';
const png=readFileSync(new URL('../fixtures/medical-note.png',import.meta.url));
function fixture(t){const s=new DomainStore({demoAccounts:[{username:'a',password:'password-123'},{username:'b',password:'password-123'}]});t.after(()=>s.close());const uid=s.login('a','password-123').user.id;s.setConsent(uid,{purpose:'analysis',granted:true,expected_version:1});return{s,uid};}
async function accept(t){const {s,uid}=fixture(t);const document=await extractDocument(png,'image/png',s.limits);const a=s.accept(uid,'document',{text:document.text,name:'test.png'},crypto.randomUUID(),document);const r=s.claimRun(a.run_id);return{s,uid,a,r,tools:s.toolsFor(r.id)};}
function transcription(x,status='readable'){x.tools.healththread_read_source({source_id:x.a.source_id});return x.tools.healththread_stage_result({kind:'transcription',operation_key:'result-'+x.r.id,dependencies:[{source_id:x.a.source_id,source_text_version:1}],payload:{status,text:status==='unreadable'?'':'诊断：腹胀。',uncertainties:status==='unreadable'?['影像模糊，无法辨认文字。']:[],source_id:x.a.source_id,source_text_version:1}});}
test('image extraction rejects malformed, mismatched and unsupported active content',async()=>{
 assert.equal((await extractDocument(png,'image/png')).media_type,'image/png');
 const jpg=readFileSync(new URL('../fixtures/medical-note.jpg',import.meta.url));assert.equal((await extractDocument(jpg,'image/jpeg')).media_type,'image/jpeg');await assert.rejects(extractDocument(jpg.subarray(0,jpg.length-4),'image/jpeg'));
 await assert.rejects(extractDocument(Buffer.from('hello'),'image/png'));
 await assert.rejects(extractDocument(png,'image/jpeg'));
 await assert.rejects(extractDocument(Buffer.from('<html>active</html>'),'text/html'),{code:'UNSUPPORTED_DOCUMENT'});
 await assert.rejects(extractDocument(png,'image/png',{uploadBytes:10}),{code:'PAYLOAD_TOO_LARGE'});
 assert.equal((await extractDocument(Buffer.from('诊断：腹胀。'),'text/plain')).text,'诊断：腹胀。');
});
test('original saved before OCR; transcript waits for verification then queues separate analysis idempotently',async t=>{
 const x=await accept(t),{s,uid,a,r}=x;assert.equal(r.workflow,'transcription');assert.equal(s.get(uid,'source',a.source_id).text,'');assert.deepEqual(s.original(uid,a.document_id).bytes,png);assert.equal(s.documentView(uid,a.document_id).extraction_status,'transcribing');
 transcription(x);assert.equal(s.documentView(uid,a.document_id).transcript,null);s.setRuntime(r.id,{mode:'fixture'});const d=s.documentView(uid,a.document_id);assert.equal(d.transcript.text,'诊断：腹胀。');assert.equal(d.source_id,a.source_id);assert.equal(s.get(uid,'source',a.source_id).text,'');assert.notEqual(d.analysis_source_id,a.source_id);assert.equal(s.internalRun(d.analysis_run_id).workflow,'document');s.setRuntime(r.id,{mode:'fixture'});assert.equal(s.all('document_transcript',uid).length,1);assert.equal(s.all('document',uid).length,1);
 const analysis=s.claimRun(d.analysis_run_id),at=s.toolsFor(analysis.id);at.healththread_read_source({source_id:d.analysis_source_id});at.healththread_retrieve_context({});at.healththread_stage_candidates({candidates:[],base_profile_revision:analysis.base_profile_revision,operation_key:'stage-'+analysis.id,overview:{summary:'资料记载腹胀',regions:[{id:'abdomen',label:'腹部',summary:'资料记载腹胀',status:'documented',source_ids:[d.analysis_source_id]}]}});s.setRuntime(analysis.id,{mode:'fixture'});const care=s.claimRun(s.internalRun(analysis.id).continuation_run_id);assert.equal(s.toolsFor(care.id).healththread_get_confirmed_instructions({document_id:a.document_id}).source.text,'诊断：腹胀。');
});
test('unreadable image retains original and inspectable uncertainty with no medical analysis; retry possible',async t=>{
 const x=await accept(t);transcription(x,'unreadable');x.s.setRuntime(x.r.id,{mode:'fixture'});const d=x.s.documentView(x.uid,x.a.document_id);assert.equal(d.extraction_status,'unreadable');assert.equal(d.analysis_run_id,null);assert.equal(d.transcript.uncertainties.length,1);const retry=x.s.retry(x.uid,x.r.id,crypto.randomUUID());assert.equal(x.s.internalRun(retry.run_id).workflow,'transcription');assert.deepEqual(x.s.original(x.uid,x.a.document_id).bytes,png);
});
test('ownership and cancellation protect original and prevent transcript finalization',async t=>{
 const x=await accept(t),foreign=x.s.login('b','password-123').user.id;assert.throws(()=>x.s.original(foreign,x.a.document_id),{code:'NOT_FOUND'});transcription(x);x.s.cancel(x.uid,x.r.id);assert.throws(()=>x.s.setRuntime(x.r.id,{mode:'fixture'}));assert.equal(x.s.all('document_transcript',x.uid).length,0);
});
test('failed transcription checkpoint retry preserves original and does not publish unverified text',async t=>{
 const x=await accept(t);transcription(x);x.s.transaction(()=>{const r=x.s.internalRun(x.r.id);r.execution_error={code:'DEPENDENCY_UNAVAILABLE'};x.s.save('run',r);});const retry=x.s.retry(x.uid,x.r.id,crypto.randomUUID());assert.equal(x.s.internalRun(retry.run_id).workflow,'transcription');assert.equal(x.s.documentView(x.uid,x.a.document_id).transcript,null);assert.equal(x.s.get(x.uid,'result',x.s.internalRun(x.r.id).result_id).validity,'stale');
});
test('partial transcript is immutable with uncertainty and deletion erases transcript, derived source and original',async t=>{
 const x=await accept(t);x.tools.healththread_read_source({source_id:x.a.source_id});const result=x.tools.healththread_stage_result({kind:'transcription',operation_key:'result-'+x.r.id,dependencies:[{source_id:x.a.source_id,source_text_version:1}],payload:{status:'partial',text:'诊断：[无法辨认]。',uncertainties:['诊断词模糊。'],source_id:x.a.source_id,source_text_version:1}});x.s.setRuntime(x.r.id,{mode:'fixture'});const d=x.s.documentView(x.uid,x.a.document_id);assert.equal(d.transcript.status,'partial');assert.throws(()=>x.s.save('document_transcript',{...d.transcript,text:'猜测诊断'}));assert.throws(()=>x.s.save('source',{...x.s.get(x.uid,'source',d.analysis_source_id),text:'猜测诊断'}));x.s.deleteData(x.uid,x.a.source_id,crypto.randomUUID());assert.equal(x.s.all('document_transcript',x.uid).length,0);assert.throws(()=>x.s.original(x.uid,x.a.document_id),{code:'NOT_FOUND'});assert.throws(()=>x.s.get(x.uid,'source',d.analysis_source_id),{code:'NOT_FOUND'});
});
import {syntheticPdf} from '../fixtures/pdf.mjs';
test('export preserves original MIME and exact bytes for PNG JPEG text and legacy PDF',async t=>{
 const {s,uid}=fixture(t);const inputs=[['image/png',png],['image/jpeg',readFileSync(new URL('../fixtures/medical-note.jpg',import.meta.url))],['text/plain',Buffer.from('医嘱：记录体温。')],['application/pdf',syntheticPdf(['Synthetic source'])]];
 for(const [mediaType,bytes]of inputs){const document=await extractDocument(bytes,mediaType,s.limits);if(mediaType==='application/pdf')delete document.media_type;const a=s.accept(uid,'document',{text:document.text,name:'fixture'},crypto.randomUUID(),document);const original=s.exportData(uid).originals.find(o=>o.source_id===a.source_id);assert.equal(original.media_type,mediaType);assert.equal(original.media_type,s.get(uid,'document',a.document_id).media_type);assert.deepEqual(Buffer.from(original.base64,'base64'),bytes);}
});
test('baseline/progressive JPEG headers and scan data must be complete before acceptance',async()=>{
 for(const name of ['baseline-validation.jpg','progressive-validation.jpg']){const bytes=readFileSync(new URL('../fixtures/'+name,import.meta.url));assert.equal((await extractDocument(bytes,'image/jpeg')).media_type,'image/jpeg');const sos=bytes.indexOf(Buffer.from([255,218]));assert.ok(sos>0);const end=Buffer.from([255,217]);const truncated=Buffer.concat([bytes.subarray(0,sos+2),end]);await assert.rejects(extractDocument(truncated,'image/jpeg'),{code:'INVALID_DOCUMENT'});const headerEnd=sos+2+bytes.readUInt16BE(sos+2);await assert.rejects(extractDocument(Buffer.concat([bytes.subarray(0,headerEnd),end]),'image/jpeg'),{code:'INVALID_DOCUMENT'});const badLength=Buffer.from(bytes);badLength.writeUInt16BE(2,sos+2);await assert.rejects(extractDocument(badLength,'image/jpeg'),{code:'INVALID_DOCUMENT'});}
});
