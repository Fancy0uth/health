import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
let count = 0;
async function scan(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await scan(path);
    else if (/\.(?:mjs|js)$/.test(entry.name)) {
      const check = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      if (check.status !== 0) throw new Error(relative(root, path) + '\n' + check.stderr);
      count++;
    } else if (entry.name.endsWith('.json')) JSON.parse(await readFile(path, 'utf8'));
  }
}
for (const directory of ['apps', 'packages', 'services', 'scripts', 'contracts', 'agents', 'tests']) await scan(join(root, directory));
console.log(`Syntax and JSON checks passed: ${count} JavaScript modules.`);
