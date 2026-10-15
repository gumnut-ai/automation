const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { configuration, MCP, ALLOWED_TOOLS } = require('./config.cjs');
const { sanitizeArgs, runLauncher } = require('./runtime/launcher.cjs');
const { PassThrough } = require('node:stream');
const { EventEmitter } = require('node:events');
const identity = { number: '17', repository: 'example/project', sha: 'a'.repeat(40), branch: 'main' };

async function parsed(config) {
  const { stdout } = await exec('python3', ['-c', 'import shlex,json,sys;print(json.dumps(shlex.split(sys.argv[1])))', config.claude_args]);
  return JSON.parse(stdout);
}

test('configuration preserves the existing model, helper and tools without an archived helper file', async () => {
  const config = configuration(identity);
  const argv = await parsed(config);
  const value = flag => argv[argv.indexOf(flag) + 1];
  assert.equal(value('--model'), 'claude-opus-5-5');
  assert.equal(value('--effort'), 'medium');
  assert.equal(value('--max-turns'), '50');
  assert.deepEqual(JSON.parse(value('--agents')), require('./agents.json'));
  assert.deepEqual(JSON.parse(value('--mcp-config')), MCP);
  assert.equal(value('--allowedTools'), ALLOWED_TOOLS);
  const sanitized = sanitizeArgs({ argv, repository: '/separate/caller', mcpConfig: { mcpServers: {} } });
  assert.deepEqual(JSON.parse(sanitized[sanitized.indexOf('--agents') + 1]), require('./agents.json'));
  assert.match(config.prompt, /trusted target branch: main/);
  assert.match(config.prompt, /\.github\/claude-review\/INSTRUCTIONS.md/);
});

test('configuration rejects identities that can escape the initial policy prompt or outputs', () => {
  for (const patch of [{ number: '1\nprompt=oops' }, { number: '9007199254740992' }, { repository: 'example/project\n' }, { sha: 'main' }, { branch: 'main\nprompt=oops' }]) {
    assert.throws(() => configuration({ ...identity, ...patch }));
  }
});

test('shared executable archives caller HEAD when invoked outside the caller checkout', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'shared-review-caller-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const caller = path.join(directory, 'caller');
  await fs.mkdir(caller);
  await exec('git', ['init', '--quiet', caller]);
  await exec('git', ['-C', caller, 'config', 'user.email', 'fixture@example.invalid']);
  await exec('git', ['-C', caller, 'config', 'user.name', 'fixture']);
  await fs.writeFile(path.join(caller, 'trusted-policy.txt'), 'caller trusted policy');
  await exec('git', ['-C', caller, 'add', 'trusted-policy.txt']);
  await exec('git', ['-C', caller, 'commit', '--quiet', '-m', 'fixture']);
  await fs.writeFile(path.join(caller, 'untracked-secret'), 'do not archive');
  const config = configuration(identity);
  assert.ok(!config.launcher.startsWith(caller));
  const argv = await parsed(config);
  let source;
  let cleaned = false;
  const code = await runLauncher({ argv, env: { GITHUB_WORKSPACE: caller, PATH: process.env.PATH },
    input: new PassThrough(), output: new PassThrough(),
    startServices: async ({ sessionDir }) => {
      source = path.join(sessionDir, 'source');
      assert.equal(await fs.readFile(path.join(source, 'trusted-policy.txt'), 'utf8'), 'caller trusted policy');
      await assert.rejects(fs.access(path.join(source, 'untracked-secret')));
      await assert.rejects(fs.access(path.join(source, 'claude-review/runtime/launcher.cjs')));
      return { network: 'fixture', modelURL: 'http://model-proxy:10001', mcpConfig: { mcpServers: {} }, close: async () => { cleaned = true; } };
    },
    spawnDocker: () => {
      const child = new EventEmitter();
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      process.nextTick(() => child.emit('close', 0));
      return child;
    }, dockerExec: async () => {},
  });
  assert.equal(code, 0); assert.equal(cleaned, true);
  await assert.rejects(fs.access(source));
});
