import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, readFile, writeFile, rm, chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'healththread-setup-'));
  t.after(() => rm(base, {recursive: true, force: true}));
  const project = join(base, 'project');
  const source = join(base, 'upstream');
  await mkdir(join(project, 'agents'), {recursive: true});
  await mkdir(source);
  git(source, 'init');
  git(source, 'config', 'user.email', 'test@example.invalid');
  git(source, 'config', 'user.name', 'Fixture');
  await writeFile(join(source, 'package.json'), JSON.stringify({packageManager: 'pnpm@10.34.5'}));
  await writeFile(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  await writeFile(join(source, '.gitignore'), 'node_modules/\n');
  await writeFile(join(source, 'source.txt'), 'pinned content');
  git(source, 'add', '.');
  git(source, 'commit', '-m', 'Pinned fixture');
  const commit = git(source, 'rev-parse', 'HEAD');
  await writeFile(join(project, 'agents/harness.lock.json'), JSON.stringify({repository: source, commit}));
  // HEAD deliberately differs from the lock: a clone of latest must not pass.
  await writeFile(join(source, 'source.txt'), 'newer content');
  git(source, 'commit', '-am', 'Later fixture');
  const aghRoot = join(project, '.runtime/agnes-harness');
  let installs = 0;
  const installDependencies = async (root, packageManager) => {
    assert.equal(packageManager, 'pnpm@10.34.5');
    assert.equal(await readFile(join(root, 'source.txt'), 'utf8'), 'pinned content');
    installs++;
    await mkdir(join(root, 'node_modules'), {recursive: true});
  };
  return {project, source, aghRoot, commit, installDependencies, installs: () => installs};
}

test('installer checks out the locked commit and skips a completed dependency install', async t => {
  const {setupHarness} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  await setupHarness(f);
  assert.equal(git(f.aghRoot, 'rev-parse', 'HEAD'), f.commit);
  assert.equal(git(f.aghRoot, 'rev-parse', '--is-shallow-repository'), 'true');
  await setupHarness(f);
  assert.equal(f.installs(), 1);
  await rm(join(f.aghRoot, 'node_modules'), {recursive: true});
  await setupHarness(f);
  assert.equal(f.installs(), 2);
});

test('installer preserves dirty and wrong-revision checkouts without installing', async t => {
  const {setupHarness} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  await setupHarness(f);
  await writeFile(join(f.aghRoot, 'source.txt'), 'teammate work');
  await assert.rejects(setupHarness(f), /dirty|uncommitted/i);
  assert.equal(await readFile(join(f.aghRoot, 'source.txt'), 'utf8'), 'teammate work');
  git(f.aghRoot, 'checkout', '--', 'source.txt');
  git(f.aghRoot, 'fetch', 'origin');
  git(f.aghRoot, 'checkout', '--detach', git(f.source, 'rev-parse', 'HEAD'));
  await assert.rejects(setupHarness(f), /commit|revision/i);
  assert.equal(f.installs(), 1);
});

test('installer leaves an unrelated destination untouched', async t => {
  const {setupHarness} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  await mkdir(f.aghRoot, {recursive: true});
  await writeFile(join(f.aghRoot, 'keep.txt'), 'keep me');
  await assert.rejects(setupHarness(f), /checkout|Git|git/i);
  assert.equal(await readFile(join(f.aghRoot, 'keep.txt'), 'utf8'), 'keep me');
  assert.equal(f.installs(), 0);
});

test('installer retries a failed dependency install without marking it complete', async t => {
  const {setupHarness} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  await assert.rejects(setupHarness({...f, installDependencies: async () => {throw new Error('offline');}}), /offline/);
  await setupHarness(f);
  assert.equal(f.installs(), 1);
});

test('a failed repair cannot reuse an earlier successful install marker', async t => {
  const {setupHarness} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  await setupHarness(f);
  await rm(join(f.aghRoot, 'node_modules'), {recursive: true});
  await assert.rejects(setupHarness({...f, installDependencies: async root => {
    await mkdir(join(root, 'node_modules'));
    throw new Error('interrupted install');
  }}), /interrupted install/);
  await setupHarness(f);
  assert.equal(f.installs(), 2);
});

test('installer rejects Node versions below upstream minimum', async () => {
  const {assertSupportedNode} = await import('../scripts/setup-agh.mjs');
  assert.throws(() => assertSupportedNode('24.9.9'), /24\.10/);
  assert.throws(() => assertSupportedNode('22.20.0'), /24\.10/);
  assert.doesNotThrow(() => assertSupportedNode('24.10.0'));
  assert.doesNotThrow(() => assertSupportedNode('26.0.0'));
});

test('installer resolves its default and relative override under the supplied project', async t => {
  const {setupHarness} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  const first = await setupHarness({...f, aghRoot: undefined});
  assert.equal(first.root, f.aghRoot);
  const second = await setupHarness({...f, aghRoot: 'alternate/harness'});
  assert.equal(second.root, join(f.project, 'alternate/harness'));
  assert.equal(git(second.root, 'rev-parse', 'HEAD'), f.commit);
});

test('dependency installer invokes the exact upstream pnpm with frozen lockfile', {skip:process.platform==='win32'}, async t => {
  const {installPinnedDependencies} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  const bin = join(f.project, 'bin');
  await mkdir(bin);
  const command = join(bin, 'npx');
  await writeFile(command, `#!${process.execPath}\nimport {writeFileSync} from 'node:fs';\nwriteFileSync('install-args.json',JSON.stringify(process.argv.slice(2)));\n`);
  await chmod(command, 0o755);
  const original = process.env.PATH;
  const originalNpm = process.env.npm_execpath;
  delete process.env.npm_execpath;
  process.env.PATH = `${bin}:${original}`;
  t.after(() => {process.env.PATH = original;if(originalNpm!==undefined)process.env.npm_execpath=originalNpm;});
  await installPinnedDependencies(f.project, 'pnpm@10.34.5');
  assert.deepEqual(JSON.parse(await readFile(join(f.project, 'install-args.json'), 'utf8')), ['--yes', '--package=pnpm@10.34.5', 'pnpm', 'install', '--frozen-lockfile']);
  await assert.rejects(installPinnedDependencies(f.project, 'pnpm@latest'), /exact pnpm/);
});

test('dependency installer uses the active npm JavaScript runner without a shell', async t => {
  const {installPinnedDependencies} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  const cli = join(f.project, 'npm cli.cjs');
  await writeFile(cli, "require('node:fs').writeFileSync('npm-args.json',JSON.stringify(process.argv.slice(2)));\n");
  const original = process.env.npm_execpath;
  process.env.npm_execpath = cli;
  t.after(() => {if(original === undefined)delete process.env.npm_execpath;else process.env.npm_execpath=original;});
  const originalPath=process.env.PATH;
  process.env.PATH='';
  t.after(()=>{process.env.PATH=originalPath;});
  await installPinnedDependencies(f.project, 'pnpm@10.34.5');
  assert.deepEqual(JSON.parse(await readFile(join(f.project, 'npm-args.json'), 'utf8')), ['exec', '--yes', '--package=pnpm@10.34.5', '--', 'pnpm', 'install', '--frozen-lockfile']);
});

test('Git timeout terminates its owned process group even with inherited descendant pipes', {skip: process.platform === 'win32'}, async t => {
  const {setupHarness} = await import('../scripts/setup-agh.mjs');
  const f = await fixture(t);
  const bin = join(f.project, 'timeout-bin');
  await mkdir(bin);
  const ready = join(f.project, 'descendant.pid');
  const command = join(bin, 'git');
  await writeFile(command, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const {writeFileSync}=require('node:fs');const child=spawn(process.execPath,['-e','setTimeout(()=>{},1500)'],{stdio:'inherit'});writeFileSync(${JSON.stringify(ready)},String(child.pid));setInterval(()=>{},1000);\n`);
  await chmod(command, 0o755);
  const original = process.env.PATH;
  process.env.PATH = `${bin}:${original}`;
  t.after(() => {process.env.PATH=original;});
  t.mock.timers.enable({apis:['setTimeout']});
  const outcome = setupHarness(f);
  const rejected = assert.rejects(outcome, /180-second setup timeout/);
  let pid;
  for(let attempt=0;attempt<200&&!pid;attempt++) {
    try {pid=Number(await readFile(ready,'utf8'));} catch {await delay(10);}
  }
  assert.ok(pid, 'fake Git must start its descendant');
  t.after(() => {try {process.kill(pid,'SIGKILL');} catch {}});
  const started=Date.now();
  t.mock.timers.tick(180_000);
  await rejected;
  assert.ok(Date.now()-started<1000,'timeout must not wait for descendant pipes to close');
  let alive=true;
  for(let attempt=0;attempt<500&&alive;attempt++) {
    try {process.kill(pid,0);await new Promise(resolve=>setImmediate(resolve));} catch {alive=false;}
  }
  assert.equal(alive,false,'owned Git descendant must be terminated');
});
