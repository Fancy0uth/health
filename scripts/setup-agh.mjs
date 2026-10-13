import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {access, mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export function assertSupportedNode(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number);
  if (!(major > 24 || (major === 24 && minor >= 10))) {
    throw new Error(`Node.js 24.10 or newer is required; found ${version}. Upgrade Node.js and rerun setup:agh.`);
  }
}

async function exists(path) {
  try {await access(path); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}
}

function run(command, args, cwd, inherit = false) {
  return new Promise((resolvePromise, reject) => {
    const grouped = command === 'git' && process.platform !== 'win32';
    const child = spawn(command, args, {cwd, detached: grouped, stdio: inherit ? 'inherit' : ['ignore', 'pipe', 'pipe']});
    let output = '';
    let timedOut = false;
    const timer = command === 'git' ? setTimeout(() => {
      timedOut = true;
      if (child.pid) {
        if (grouped) {try {process.kill(-child.pid, 'SIGKILL');} catch {child.kill('SIGKILL');}}
        else {
          const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], {stdio: 'ignore'});
          killer.on('error', () => child.kill('SIGKILL'));
          killer.unref();
        }
      }
      child.stdout?.destroy();child.stderr?.destroy();child.unref();
      reject(new Error('Git exceeded the 180-second setup timeout. Check your GitHub connection or proxy, then rerun setup:agh. Existing checkouts were preserved.'));
    }, 180_000) : undefined;
    child.stdout?.on('data', data => {output += data;});
    // Git diagnostics can contain authenticated remote URLs; keep captured stderr private.
    child.stderr?.resume();
    child.on('error', error => {clearTimeout(timer); reject(new Error(`Cannot run ${command}: ${error.code}. Install it and rerun setup:agh.`));});
    child.on('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('Git exceeded the 180-second setup timeout. Check your GitHub connection or proxy, then rerun setup:agh. Existing checkouts were preserved.'));
      else if (code === 0) resolvePromise(output.trim());
      else reject(new Error(`${command} failed (exit ${code}). Check repository access, network connectivity, and local permissions; rerun setup:agh.`));
    });
  });
}

export async function installPinnedDependencies(root, packageManager) {
  if (!/^pnpm@\d+\.\d+\.\d+(?:\+sha\d+\.[a-f0-9]+)?$/.test(packageManager)) {
    throw new Error('Harness package.json must pin an exact pnpm version in packageManager.');
  }
  const version = packageManager.split('+')[0];
  if (process.env.npm_execpath) {
    await run(process.execPath, [process.env.npm_execpath, 'exec', '--yes', `--package=${version}`, '--', 'pnpm', 'install', '--frozen-lockfile'], root, true);
  } else if (process.platform === 'win32') {
    throw new Error('On Windows, start this installer with npm run setup:agh so the npm JavaScript runner is available.');
  } else {
    await run('npx', ['--yes', `--package=${version}`, 'pnpm', 'install', '--frozen-lockfile'], root, true);
  }
}

async function validateCheckout(root, commit) {
  let top;
  try {top = await run('git', ['rev-parse', '--show-toplevel'], root);} catch {
    throw new Error(`AGH_ROOT is not a Git checkout: ${root}. Choose a new empty destination; existing files were preserved.`);
  }
  if (await realpath(top) !== await realpath(root)) {
    throw new Error(`AGH_ROOT must be the root of its own Git checkout: ${root}. Existing files were preserved.`);
  }
  const actual = await run('git', ['rev-parse', 'HEAD'], root);
  if (actual !== commit) throw new Error(`Harness commit mismatch: expected ${commit}, found ${actual}. Preserve this checkout and choose a new AGH_ROOT, or explicitly switch it yourself.`);
  const dirty = await run('git', ['status', '--porcelain', '--untracked-files=normal'], root);
  if (dirty) throw new Error(`Harness checkout has uncommitted changes: ${root}. Commit or preserve your work before retrying; setup will not reset it.`);
}

export async function setupHarness(options = {}) {
  assertSupportedNode();
  const defaults = options.project ? {} : await import('./runtime-paths.mjs');
  const project = options.project ?? defaults.PROJECT;
  const root = resolve(project, options.aghRoot ?? defaults.AGH_ROOT ?? '.runtime/agnes-harness');
  const installDependencies = options.installDependencies ?? installPinnedDependencies;
  const onProgress = options.onProgress ?? (() => {});
  const lock = JSON.parse(await readFile(join(project, 'agents/harness.lock.json'), 'utf8'));
  if (typeof lock.repository !== 'string' || !lock.repository.trim() || !/^[a-f0-9]{40}$/.test(lock.commit)) {
    throw new Error('agents/harness.lock.json must contain a repository and a full 40-character commit.');
  }
  if (!await exists(root)) {
    await mkdir(dirname(root), {recursive: true});
    const staging = await mkdtemp(join(dirname(root), '.agnes-setup-'));
    const checkout = join(staging, 'checkout');
    try {
      onProgress('Downloading the pinned Agnes Harness revision (Git timeout: 180 seconds)…');
      await mkdir(checkout);
      await run('git', ['init'], checkout);
      await run('git', ['remote', 'add', 'origin', lock.repository], checkout);
      await run('git', ['fetch', '--depth=1', 'origin', lock.commit], checkout);
      await run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout);
      await validateCheckout(checkout, lock.commit);
      if (await exists(root)) throw new Error('AGH_ROOT appeared during setup. Existing destination was preserved; retry setup.');
      await rename(checkout, root);
    } finally {await rm(staging, {recursive: true, force: true});}
  }
  await validateCheckout(root, lock.commit);
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^pnpm@\d+\.\d+\.\d+(?:\+sha\d+\.[a-f0-9]+)?$/.test(manifest.packageManager ?? '')) {
    throw new Error('Harness package.json must pin an exact pnpm version in packageManager.');
  }
  const lockfile = await readFile(join(root, 'pnpm-lock.yaml'));
  const fingerprint = createHash('sha256').update(lock.commit).update(manifest.packageManager).update(lockfile).update(`${process.version}:${process.platform}:${process.arch}`).digest('hex');
  const gitDir = await run('git', ['rev-parse', '--absolute-git-dir'], root);
  const marker = join(gitDir, 'healththread-install.json');
  let prior;
  try {prior = JSON.parse(await readFile(marker, 'utf8'));} catch (error) {if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;}
  if (prior?.fingerprint !== fingerprint || !await exists(join(root, 'node_modules'))) {
    onProgress('Installing Agnes Harness dependencies from its pinned lockfile…');
    await rm(marker, {force: true});
    await installDependencies(root, manifest.packageManager);
    await validateCheckout(root, lock.commit);
    await writeFile(marker, JSON.stringify({fingerprint}) + '\n');
  }
  return {root, commit: lock.commit};
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  setupHarness({onProgress: message => console.log(message)}).then(({root, commit}) => {
    console.log(`Agnes Harness ready at ${root} (${commit}).`);
    console.log('Next: npm run build:agh-runtime');
  }).catch(error => {
    console.error(`Agnes Harness setup failed: ${error.message}`);
    process.exitCode = 1;
  });
}
