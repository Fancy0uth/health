import {readFile,readdir,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {runtimeError} from './boundary.mjs';
const root=fileURLToPath(new URL('./',import.meta.url));
export async function verifyApprovedAssets(){
 const bytes=await readFile(join(root,'approved-assets.json'));const expected=JSON.parse(bytes);const actual={};
 async function walk(relative){for(const name of (await readdir(join(root,relative))).sort()){const path=relative+'/'+name;const info=await lstat(join(root,path));if(info.isSymbolicLink())throw runtimeError('AGH_ASSET_SYMLINK');if(info.isDirectory())await walk(path);else actual[path]=createHash('sha256').update(await readFile(join(root,path))).digest('hex');}}
 await walk('plugin');await walk('skills');
 if(JSON.stringify(actual)!==JSON.stringify(expected.files))throw runtimeError('AGH_UNAPPROVED_ASSET_REVISION');
 // Immutable deploy generation: upgrades create a separate home and retain prior traces honestly.
 return createHash('sha256').update(bytes).digest('hex').slice(0,20);
}
