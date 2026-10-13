import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyApprovedAssets} from '../../agents/runtime/assets.mjs';
for(const name of ['health-assistant','health-record','visit-preparation','post-visit'])test(`${name} ships chapter-four understanding and uncertainty constraints`,async()=>{
 const skill=await readFile(new URL(`../../agents/runtime/skills/${name}/SKILL.md`,import.meta.url),'utf8');
 for(const section of ['问题事件 + 时间 + 证据','部位与表现','时间与变化','主观程度','影响与情境','伴随与否定','测量与资料','背景与处理','证据与状态','当前关注问题','按时间串联的事件','经确认的相关背景','待核对的冲突与未知'])assert.ok(skill.includes(section),`${name}: missing ${section}`);
 assert.match(skill,/不.*逐项.*填.*表/);
 assert.match(skill,/没提到.*不.*没有/);
 assert.match(skill,/同一指标.*单位.*时间范围/);
 assert.match(skill,/自评.*不等于.*急重/);
});
test('framework instructions are included in approved deployed runtime assets',async()=>assert.match(await verifyApprovedAssets(),/^[a-f0-9]{20}$/));
