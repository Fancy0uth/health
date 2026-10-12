import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import {check,fail,LIMITS} from './domain-errors.mjs';
const execute=promisify(execFile);
const executable=name=>['/opt/homebrew/bin/','/usr/local/bin/','/usr/bin/'].map(dir=>dir+name).find(existsSync);
export const pdfAvailable=()=>Boolean(executable('pdfinfo')&&executable('pdftotext'));
export async function extractPdf(bytes,options={}){
 const limits={...LIMITS,...options};check(Buffer.isBuffer(bytes)&&bytes.length<=limits.uploadBytes,'PAYLOAD_TOO_LARGE',413);check(bytes.subarray(0,5).toString()==='%PDF-','UNSUPPORTED_DOCUMENT',415);check(bytes.subarray(Math.max(0,bytes.length-1024)).includes(Buffer.from('%%EOF')),'PDF_CORRUPT',422);check(pdfAvailable(),'PDF_NOT_CONFIGURED',503);
 const directory=await mkdtemp(join(tmpdir(),'healththread-pdf-'));
 try{const file=join(directory,'input.pdf');await writeFile(file,bytes,{mode:0o600});const execOptions={encoding:'utf8',timeout:Math.min(limits.deadlineMs,15000),maxBuffer:limits.pdfTextBytes+65536,signal:options.signal,env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}};
  const {stdout:info}=await execute(executable('pdfinfo'),[file],execOptions);check(!/^Encrypted:\s+yes/im.test(info),'PDF_ENCRYPTED',422);const count=Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);check(Number.isSafeInteger(count)&&count>0,'PDF_CORRUPT',422);check(count<=limits.pdfPages,'PDF_PAGE_LIMIT',413);
  const {stdout}=await execute(executable('pdftotext'),['-enc','UTF-8','-layout',file,'-'],execOptions);check(Buffer.byteLength(stdout)<=limits.pdfTextBytes,'PDF_TEXT_LIMIT',413);const parts=stdout.split('\f');if(parts.at(-1)==='')parts.pop();check(parts.length===count,'PDF_CORRUPT',422);check(parts.some(t=>t.trim()),'PDF_NO_TEXT',422);let text='';const pages=[];parts.forEach((p,i)=>{const start=text.length;text+=p;pages.push({page:i+1,start,end:text.length});});return {text,pages,bytes};
 }catch(e){if(e.status)throw e;if(e.code==='ABORT_ERR')fail(499,'UPLOAD_CANCELLED');if(e.killed)fail(504,'PDF_TIMEOUT');if(e.code==='ERR_CHILD_PROCESS_STDIO_MAXBUFFER')fail(413,'PDF_TEXT_LIMIT');if(/password|encrypted/i.test(e.stderr||''))fail(422,'PDF_ENCRYPTED');fail(422,'PDF_CORRUPT');}
 finally{await rm(directory,{recursive:true,force:true});}
}
