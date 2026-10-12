// Faults at a fixed subprocess dependency boundary, never a production delay/force switch.
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {promisify} from 'node:util';
import {stat} from 'node:fs/promises';
import {dirname} from 'node:path';
import assert from 'node:assert/strict';
import {syntheticPdf} from './pdf.mjs';
const scenario=process.argv[2];let file,arrived,release;const barrier=new Promise(r=>arrived=r);const hold=new Promise(r=>release=r);const controller=new AbortController();
childProcess.execFile=(binary,args,options,callback)=>{
 file=args.find(x=>x.endsWith('input.pdf'));assert.ok(options.timeout<=15000);assert.equal(options.env.PATH,'/usr/bin:/bin');
 if(scenario==='epoch'&&binary.endsWith('/pdfinfo'))queueMicrotask(()=>callback(null,'Pages: 1\nEncrypted: no\n',''));
 else if(scenario==='epoch'){arrived();hold.then(()=>callback(null,'Synthetic PDF source.\n\f',''));}
 else if(scenario==='timeout')queueMicrotask(()=>callback(Object.assign(new Error('isolated subprocess timeout'),{killed:true,signal:'SIGTERM'})));
 else {assert.equal(options.signal,controller.signal);options.signal.addEventListener('abort',()=>callback(Object.assign(new Error('isolated cancellation'),{code:'ABORT_ERR'})),{once:true});queueMicrotask(()=>controller.abort());}
 return {};
};
childProcess.execFile[promisify.custom]=(binary,args,options)=>new Promise((resolve,reject)=>childProcess.execFile(binary,args,options,(error,stdout,stderr)=>error?reject(error):resolve({stdout,stderr})));
syncBuiltinESMExports();
if(scenario==='epoch'){
 const [{createApp},{request,login}]=await Promise.all([import('../../services/api/domain-server.mjs'),import('./http-handler.mjs')]);const app=createApp({dbPath:':memory:',demoAccounts:[{username:'pdf-owner',password:'synthetic-pdf-password'}]});await app.jobs.close();
 try{const auth=await login(app,'pdf-owner','synthetic-pdf-password');app.store.setConsent(auth.uid,{purpose:'analysis',granted:true,expected_version:1});auth.headers['x-healththread-epoch']=String(app.store.user(auth.uid).epoch);const form=new FormData();form.set('file',new File([syntheticPdf(['Synthetic PDF source.'])],'synthetic.pdf',{type:'application/pdf'}));const encoded=new Request('http://fixture.local/api/documents',{method:'POST',body:form});const pending=request(app,'/api/documents',{method:'POST',body:Buffer.from(await encoded.arrayBuffer()),headers:{...auth.headers,'content-type':encoded.headers.get('content-type')}});await Promise.race([barrier,pending.then(r=>{throw new Error(JSON.stringify(r));})]);
  const erased=await request(app,'/api/data/all',{method:'DELETE',body:{},headers:{...auth.headers,'idempotency-key':'pdf-delete-epoch-key-001'}});assert.equal(erased.status,202);release();const result=await pending;assert.equal(result.status,409);assert.equal(result.body.error.code,'SCOPE_EPOCH_CONFLICT');assert.equal(app.store.all('source',auth.uid).length,0);assert.equal(app.store.all('document',auth.uid).length,0);assert.equal(app.store.all('run',auth.uid).length,0);assert.equal(app.store.user(auth.uid).all_clear_epoch,1);console.log(JSON.stringify({scenario,status:result.status,code:result.body.error.code,sources:0,documents:0}));
 }finally{release();await app.close();}
}else{
 const {extractPdf}=await import('../../services/api/pdf.mjs');await assert.rejects(extractPdf(syntheticPdf(),{signal:controller.signal}),{code:scenario==='timeout'?'PDF_TIMEOUT':'UPLOAD_CANCELLED'});console.log(JSON.stringify({scenario,code:scenario==='timeout'?'PDF_TIMEOUT':'UPLOAD_CANCELLED'}));
}
await assert.rejects(stat(dirname(file)),{code:'ENOENT'});
