import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {AGH_ROOT} from '../scripts/runtime-paths.mjs';
import { buildSdk } from '../scripts/build-agh-sdk.mjs';

test('the bundled public AGH SDK loads with its real CommonJS dependencies', { skip: !existsSync(join(AGH_ROOT,'package.json')) }, async () => {
  const path = await buildSdk();
  const sdk = await import(pathToFileURL(path).href);
  assert.equal(typeof sdk.createClient, 'function');
  assert.equal(typeof sdk.memoryJournal, 'function');
});
