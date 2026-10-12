import {readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
const root=fileURLToPath(new URL('../',import.meta.url));
async function discover(dir){const out=[];for(const e of await readdir(dir,{withFileTypes:true})){const path=join(dir,e.name);if(e.isDirectory())out.push(...await discover(path));else if(e.name.endsWith('.test.mjs'))out.push(path);}return out;}
const files=(await discover(join(root,'tests'))).sort();
const child=spawn(process.execPath,['--test',...process.argv.slice(2),...files],{cwd:root,stdio:'inherit'});child.on('error',()=>{process.exitCode=1;});child.on('exit',(code)=>{process.exitCode=code??1;});
