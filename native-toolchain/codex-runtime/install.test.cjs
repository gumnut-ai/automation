const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const version = '0.156.1';

function fixture(t, mode = 'success') {
  // Spaces and shell metacharacters exercise the packaged action path boundary.
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'codex runtime $fixture-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const shared = path.join(dir, 'shared');
  for (const item of ['actions/codex-runtime', 'native-toolchain/codex-runtime']) {
    fs.cpSync(path.join(root, item), path.join(shared, item), { recursive: true });
  }
  const bin = path.join(dir, 'bin');
  const temp = path.join(dir, 'runner temp');
  const cache = path.join(dir, 'tool cache');
  const caller = path.join(dir, 'untrusted checkout');
  const home = path.join(dir, 'original home');
  for (const item of [bin, temp, cache, caller, home]) fs.mkdirSync(item);
  fs.writeFileSync(path.join(caller, '.npmrc'), 'ignore-scripts=false\nregistry=https://invalid.example\n');
  fs.writeFileSync(path.join(home, '.npmrc'), 'ignore-scripts=false\n');
  fs.writeFileSync(path.join(bin, 'npm'), `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync('npm-call.json', JSON.stringify({ args: process.argv.slice(2), env: process.env, cwd: process.cwd(), homeFiles: fs.readdirSync(process.env.HOME) }));
if (${JSON.stringify(mode)} === 'npm-failure') process.exit(37);
if (${JSON.stringify(mode)} === 'missing-binary') process.exit(0);
fs.mkdirSync('node_modules/.bin', { recursive: true });
fs.writeFileSync('node_modules/.bin/codex', ${JSON.stringify(`#!/bin/sh\n[ "$#" = 1 ] && [ "$1" = --version ] || exit 90\necho codex-cli ${version}\nexit ${mode === 'version-failure' ? 42 : 0}\n`)}, { mode: 0o755 });
`, { mode: 0o755 });
  const runtime = path.join(temp, 'gh-aw/codex-runtime');
  const link = path.join(cache, `scheduled-care-codex/${version}/bin/codex`);
  const action = fs.readFileSync(path.join(shared, 'actions/codex-runtime/action.yml'), 'utf8');
  const run = action.match(/^      run: (.+)$/m)?.[1];
  assert.ok(run, 'execute the real packaged composite command');
  return { dir, runtime, link, run: () => spawnSync('bash', ['-c', run], {
    cwd: caller,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, HOME: home,
      GITHUB_ACTION_PATH: path.join(shared, 'actions/codex-runtime'),
      RUNNER_TEMP: temp, RUNNER_TOOL_CACHE: cache,
      OPENAI_API_KEY: 'fixture-secret', NODE_OPTIONS: '--trace-warnings',
      npm_config_registry: 'https://invalid.example', npm_config_ignore_scripts: 'false',
    },
  }) };
}

test('packaged action installs its own lock, isolates npm state and preserves native discovery', (t) => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /codex-cli 0\.156\.1/);
  for (const name of ['package.json', 'package-lock.json']) {
    assert.deepEqual(fs.readFileSync(path.join(f.runtime, name)), fs.readFileSync(path.join(__dirname, name)));
  }
  const call = JSON.parse(fs.readFileSync(path.join(f.runtime, 'npm-call.json')));
  assert.deepEqual(call.args, ['ci', '--ignore-scripts', '--prefix', f.runtime,
    '--cache', path.join(f.dir, 'runner temp/gh-aw/npm-cache')]);
  assert.equal(call.cwd, f.runtime);
  assert.deepEqual(call.homeFiles, []);
  assert.match(call.env.HOME, /codex-install-home\./);
  assert.equal(fs.existsSync(call.env.HOME), false, 'temporary HOME is removed');
  // macOS inserts its text-encoding variable when launching Node, even via env -i.
  const inherited = Object.keys(call.env).filter((key) =>
    !(process.platform === 'darwin' && key === '__CF_USER_TEXT_ENCODING'));
  assert.deepEqual(inherited.sort(), ['HOME', 'PATH']);
  assert.equal(fs.readlinkSync(f.link), path.join(f.runtime, 'node_modules/.bin/codex'));
  assert.equal(fs.realpathSync(f.link), fs.realpathSync(path.join(f.runtime, 'node_modules/.bin/codex')));
});

test('npm failure propagates and does not publish a discovery link', (t) => {
  const f = fixture(t, 'npm-failure');
  assert.equal(f.run().status, 37);
  assert.equal(fs.existsSync(path.dirname(f.link)), false);
  const call = JSON.parse(fs.readFileSync(path.join(f.runtime, 'npm-call.json')));
  assert.equal(fs.existsSync(call.env.HOME), false);
});

test('a missing platform command fails installation', (t) => {
  const f = fixture(t, 'missing-binary');
  assert.notEqual(f.run().status, 0);
});

test('version command failure propagates', (t) => {
  const f = fixture(t, 'version-failure');
  assert.equal(f.run().status, 42);
});

test('existing runtime is rejected before invoking npm', (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.runtime, { recursive: true });
  fs.writeFileSync(path.join(f.runtime, '.npmrc'), 'ignore-scripts=false');
  assert.notEqual(f.run().status, 0);
  assert.equal(fs.existsSync(path.join(f.runtime, 'npm-call.json')), false);
});

test('existing native discovery link is never overwritten', (t) => {
  const f = fixture(t);
  fs.mkdirSync(path.dirname(f.link), { recursive: true });
  fs.symlinkSync('/fixture-existing-target', f.link);
  assert.notEqual(f.run().status, 0);
  assert.equal(fs.readlinkSync(f.link), '/fixture-existing-target');
});

test('reviewed lock covers the wrapper and all optional platform binaries', () => {
  const manifest = require('./package.json');
  const lock = require('./package-lock.json');
  assert.deepEqual(manifest.dependencies, { '@openai/codex': version });
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  const wrapper = lock.packages['node_modules/@openai/codex'];
  assert.equal(wrapper.version, version);
  const platforms = ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64'];
  assert.equal(Object.keys(wrapper.optionalDependencies).length, platforms.length);
  for (const platform of platforms) {
    const name = `@openai/codex-${platform}`;
    assert.equal(wrapper.optionalDependencies[name], `npm:@openai/codex@${version}-${platform}`);
    const pkg = lock.packages[`node_modules/${name}`];
    assert.equal(pkg.version, `${version}-${platform}`);
    assert.equal(pkg.optional, true);
    assert.equal(pkg.resolved, `https://registry.npmjs.org/@openai/codex/-/codex-${version}-${platform}.tgz`);
    assert.equal(Buffer.from(pkg.integrity.replace(/^sha512-/, ''), 'base64').length, 64);
  }
  assert.equal(Buffer.from(wrapper.integrity.replace(/^sha512-/, ''), 'base64').length, 64);
});
