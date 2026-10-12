import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {extractPdf} from '../../services/api/pdf.mjs';
import {syntheticPdf} from '../fixtures/pdf.mjs';
const execute=promisify(execFile);
test('genuine Poppler rejects encrypted/no-text/corrupt PDFs and preserves exact two-page offsets',async()=>{
 // Skipping encryption/text validation or merging page offsets would admit false source evidence.
 await assert.rejects(extractPdf(await readFile(new URL('../fixtures/encrypted-synthetic.pdf',import.meta.url))),{code:'PDF_ENCRYPTED'});await assert.rejects(extractPdf(syntheticPdf([''])),{code:'PDF_NO_TEXT'});await assert.rejects(extractPdf(Buffer.from('%PDF-1.4\ncorrupt\n%%EOF')),{code:'PDF_CORRUPT'});
 const out=await extractPdf(syntheticPdf(['Instruction: record symptoms daily.','Instruction: return after three days.']));assert.equal(out.text,'Instruction: record symptoms daily.\nInstruction: return after three days.\n');assert.deepEqual(out.pages,[{page:1,start:0,end:36},{page:2,start:36,end:74}]);
});
for(const scenario of ['timeout','cancel','epoch'])test(`isolated PDF ${scenario} dependency fault cleans temp directory and preserves API boundary`,{timeout:10000},async()=>{
 const {stdout}=await execute(process.execPath,[fileURLToPath(new URL('../fixtures/pdf-boundary-worker.mjs',import.meta.url)),scenario]);const result=JSON.parse(stdout.trim());assert.equal(result.scenario,scenario);assert.equal(result.code,{timeout:'PDF_TIMEOUT',cancel:'UPLOAD_CANCELLED',epoch:'SCOPE_EPOCH_CONFLICT'}[scenario]);if(scenario==='epoch'){assert.equal(result.status,409);assert.equal(result.sources,0);assert.equal(result.documents,0);}
});
