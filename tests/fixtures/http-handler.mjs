import {Readable} from 'node:stream';
// Exercise the actual HTTP router without a listening socket. Socket-level suites remain separate.
export async function request(app,path,{method='GET',body,headers={}}={}){
 const text=body===undefined?'':Buffer.isBuffer(body)?body:typeof body==='string'?body:JSON.stringify(body),req=Readable.from(text?[Buffer.from(text)]:[]);
 Object.assign(req,{url:path,method,headers:{host:'fixture.local',origin:'http://fixture.local',...(body!==undefined?{'content-type':'application/json'}:{}),...headers},socket:{encrypted:false,remoteAddress:'127.0.0.1'}});
 const out={status:null,headers:{},body:null};const res={headersSent:false,writeHead(status,values){out.status=status;out.headers=Object.fromEntries(Object.entries(values).map(([k,v])=>[k.toLowerCase(),v]));this.headersSent=true;},end(bytes){out.body=bytes===undefined?null:Buffer.isBuffer(bytes)?bytes.toString('utf8'):bytes;}};
 await app.server.listeners('request')[0](req,res);if(out.headers['content-type']?.startsWith('application/json'))out.body=JSON.parse(out.body);return out;
}
export async function login(app,username,password){const r=await request(app,'/api/auth/login',{method:'POST',body:{username,password}});return {uid:r.body.user.id,headers:{cookie:r.headers['set-cookie'].split(';')[0],'x-csrf-token':r.body.csrf_token,'x-healththread-epoch':String(r.body.scope_epoch),'idempotency-key':'fixture-router-'+username+'-0001'}};}
