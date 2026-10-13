import {writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PROJECT} from './runtime-paths.mjs';
export async function setupLocal(project=PROJECT){
 const username='demo',password='Ht-'+randomBytes(18).toString('base64url');
 const text=`# Local settings; never commit this file.\nHOST=127.0.0.1\nPORT=4173\nAGENT_MODE=agnes\nHEALTHTHREAD_DB_PATH=.runtime/healththread-domain.sqlite\nHEALTHTHREAD_DEMO_AUTH=1\nHEALTHTHREAD_DEMO_USERNAME=${username}\nHEALTHTHREAD_DEMO_PASSWORD=${password}\n`;
 try{await writeFile(join(project,'.env'),text,{flag:'wx',mode:0o600});return{created:true,username,password};}
 catch(error){if(error.code==='EEXIST')return{created:false};throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await setupLocal();
 console.log(result.created?`已创建本机 .env（仅用于本地测试）。\n网页账号：${result.username}\n网页密码：${result.password}\n此账号与 Agnes 模型账号不同，请保存以上登录信息。`:'保留现有 .env。请确认其中已启用本地测试登录并设置账号密码。');
}
