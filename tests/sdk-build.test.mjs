import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { buildSdk } from '../scripts/build-agh-sdk.mjs';

test('the bundled public AGH SDK loads with its real CommonJS dependencies', { skip: !process.env.AGH_ROOT }, async () => {
  const path = await buildSdk();
  const sdk = await import(pathToFileURL(path).href);
  assert.equal(typeof sdk.createClient, 'function');
  assert.equal(typeof sdk.memoryJournal, 'function');
});
