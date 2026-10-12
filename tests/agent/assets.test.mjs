import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {verifyApprovedAssets} from '../../agents/runtime/assets.mjs';
import {TOOL_NAMES} from '../../agents/runtime/boundary.mjs';
test('reviewed source assets are exact and five plugin JSON schemas equal frozen contracts',async()=>{
 assert.match(await verifyApprovedAssets(),/^[a-f0-9]{20}$/);
 const schemas=JSON.parse(await readFile(new URL('../../agents/runtime/plugin/schemas.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(schemas).sort(),[...TOOL_NAMES].sort());
 for(const name of TOOL_NAMES)assert.deepEqual(schemas[name],JSON.parse(await readFile(new URL('../../contracts/schemas/'+name+'.json',import.meta.url),'utf8')));
});
