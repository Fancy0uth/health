import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {AGH_ROOT} from './runtime-paths.mjs';
const project = fileURLToPath(new URL('../', import.meta.url));
export async function buildSdk(aghRoot = AGH_ROOT) {
  if (!aghRoot) throw new Error('请设置 AGH_ROOT 指向已经安装依赖的 Agnes Harness 源码目录。');
  const source = resolve(aghRoot);
  const lock = JSON.parse(await readFile(resolve(project, 'agents/harness.lock.json'), 'utf8'));
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: source, encoding: 'utf8' }).trim();
  if (commit !== lock.commit) throw new Error('AGH 源码版本与 agents/harness.lock.json 不一致；请核对 SDK 接口后更新固定版本。');
  const require = createRequire(resolve(source, 'packages/sdk/package.json'));
  const { build } = require('esbuild');
  const output = resolve(project, '.runtime/agnes-sdk.mjs');
  await mkdir(resolve(project, '.runtime'), { recursive: true });
  await build({ stdin: { contents: "export { createClient, memoryJournal } from '@agnes/sdk';", resolveDir: resolve(source, 'packages/sdk'), sourcefile: 'healththread-sdk-entry.mjs' }, outfile: output, bundle: true, platform: 'node', format: 'esm', target: 'node24', packages: 'bundle', banner: { js: "import { createRequire as __sdkCreateRequire } from 'node:module'; const require = __sdkCreateRequire(import.meta.url);" }, logLevel: 'silent' });
  return output;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(await buildSdk());
