// Provider-free observations of an unmodified native runtime, not an adapter.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

function globals() {
  const failed = [];
  const outputs = {};
  global.core = Object.fromEntries(['info', 'debug', 'warning', 'error', 'notice', 'startGroup', 'endGroup'].map(k => [k, () => {}]));
  core.setFailed = message => failed.push(message);
  core.setOutput = (key, value) => { outputs[key] = value; };
  core.exportVariable = (key, value) => { process.env[key] = value; };
  core.summary = { addRaw() { return this; }, addHeading() { return this; },
    addTable() { return this; }, addDetails() { return this; }, write: async () => {} };
  global.context = { repo: { owner: 'fixture', repo: 'project' }, eventName: 'schedule', payload: {} };
  return { failed, outputs };
}

// The test double changes only the collector's hardcoded output-directory
// boundary. Native source, schemas, handlers and collected items are unchanged.
function isolateOutputDirectory(native, root) {
  const file = path.join(native, 'constants.cjs');
  const constants = require(file);
  require.cache[require.resolve(file)].exports = { ...constants, TMP_GH_AW_PATH: root };
}

async function worker(mode, native, root) {
  const state = globals();
  global.github = {};
  isolateOutputDirectory(native, root);
  if (mode === '--produce') {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    const remote = path.join(root, 'remote.git');
    git('init', '--bare', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'Fixture Bot');
    git('config', 'user.email', 'bot@example.invalid');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.0"}\n');
    git('add', 'package.json'); git('commit', '-m', 'Initial dependency');
    git('remote', 'add', 'origin', remote); git('push', 'origin', 'main');
    git('checkout', '-b', 'dependabot/npm/update'); git('push', 'origin', 'HEAD');
    const baseline = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'package.json'), '{"version":"1.0.1"}\n');
    git('add', 'package.json'); git('commit', '-m', 'Repair compatibility');
    process.env.GITHUB_WORKSPACE = root;
    const items = [];
    const { createHandlers } = require(path.join(native, 'safe_outputs_handlers.cjs'));
    const handlers = createHandlers({ debug() {} }, item => items.push(item), {
      push_to_pull_request_branch: { target: '*', base_branch: 'main', patch_format: 'bundle',
        max: 10, patch_workspace_path: '.', current_checkout_repo: 'fixture/project' },
    });
    const result = await handlers.pushToPullRequestBranchHandler({ repo: 'fixture/project',
      branch: 'dependabot/npm/update', pull_request_number: 12, message: 'Repair compatibility' });
    if (result.isError) throw Error(JSON.stringify(result));
    return { baseline, items };
  }
  if (mode === '--collect') {
    process.env.GH_AW_SAFE_OUTPUTS = path.join(root, 'input.jsonl');
    process.env.GH_AW_SAFE_OUTPUTS_CONFIG_PATH = path.join(root, 'config.json');
    process.env.GH_AW_VALIDATION_CONFIG_PATH = path.join(root, 'validation.json');
    await require(path.join(native, 'collect_ndjson_output.cjs')).main();
    return { output: JSON.parse(state.outputs.output), failed: state.failed };
  }
  if (['--publish-fresh', '--publish-stale', '--publish-api-failure'].includes(mode)) {
    const produced = await worker('--produce', native, root);
    fs.writeFileSync(path.join(root, 'input.jsonl'), produced.items.map(x => JSON.stringify(x)).join('\n'));
    const collected = await worker('--collect', native, root);
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    const branch = 'dependabot/npm/update';
    if (mode === '--publish-stale') {
      git('branch', 'agent-repair', 'HEAD'); git('checkout', '-b', 'human-writer', produced.baseline);
      fs.writeFileSync(path.join(root, 'human.txt'), 'Competing human change\n');
      git('add', 'human.txt'); git('commit', '-m', 'Human change');
      git('push', 'origin', `HEAD:refs/heads/${branch}`); git('checkout', 'agent-repair');
    }
    const remoteBefore = git('ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0];
    const writes = [];
    global.github = { rest: {
      pulls: { get: async () => ({ data: { number: 12, state: 'open', title: 'Dependency update', labels: [],
        user: { login: 'dependabot[bot]', id: 49699333, type: 'Bot' },
        base: { ref: 'main', repo: { full_name: 'fixture/project' } },
        head: { ref: branch, sha: remoteBefore, repo: { full_name: 'fixture/project' } } } }) },
      repos: { getBranchProtection: async () => { throw Object.assign(Error('Not protected'), { status: 404 }); } },
    }, graphql: async (query, variables) => {
      if (!query.includes('createCommitOnBranch')) throw Error('Unexpected GraphQL operation');
      writes.push(variables.input);
      if (mode === '--publish-api-failure') throw Error('Fixture signed API unavailable');
      return { createCommitOnBranch: { commit: { oid: 'e'.repeat(40) } } };
    } };
    const execute = (command, args, options = {}) => {
      if (command !== 'git') throw Error('Fixture permits Git object operations only');
      const result = spawnSync(command, args, { cwd: options.cwd || root, env: process.env, encoding: 'utf8' });
      if (result.error) throw result.error;
      if (result.status !== 0 && !options.ignoreReturnCode) throw Error(result.stderr);
      return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    global.exec = { exec: async (...args) => execute(...args).exitCode,
      getExecOutput: async (...args) => execute(...args) };
    const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'))).push_to_pull_request_branch;
    const handler = await require(path.join(native, 'push_to_pull_request_branch.cjs')).main(config);
    const result = await handler(collected.output.items[0], {});
    const remoteAfter = git('ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0];
    return { result, baseline: produced.baseline, remoteBefore, remoteAfter,
      unsignedLocalFallback: mode === '--publish-api-failure' && remoteAfter !== remoteBefore &&
        !git('cat-file', '-p', remoteAfter).split('\n\n')[0].includes('\ngpgsig '),
      mutationCount: writes.length, mutationExpectedHeads: writes.map(x => x.expectedHeadOid),
      humanFileAfterApply: fs.existsSync(path.join(root, 'human.txt')) };
  }
  if (mode === '--review') {
    const calls = [];
    global.github = { rest: {
      issues: { get: async () => ({ data: { labels: [] } }) },
      pulls: { get: async () => ({ data: { requested_reviewers: [], requested_teams: [] } }),
        listReviews: async () => ({ data: [] }),
        requestReviewers: async args => { calls.push(args); return { data: {} }; } },
    } };
    const { sortMessageIndicesByTemporaryIdDependencies: sort } = require(path.join(native, 'safe_output_handler_manager.cjs'));
    const reviewer = { type: 'add_reviewer', reviewers: ['reviewer'], pull_request_number: 'aw_proposal' };
    const proposal = { type: 'create_pull_request', temporary_id: 'aw_proposal' };
    const handler = await require(path.join(native, 'add_reviewer.cjs')).main({ max: 100, target: '*' });
    return { reversedOrder: sort([reviewer, proposal]),
      temporaryIdResult: await handler(reviewer, { aw_proposal: { repo: 'fixture/project', number: 12 } }),
      numericResult: await handler({ ...reviewer, pull_request_number: 12 }, {}), calls };
  }
  throw Error('Unknown worker mode');
}

function nativeFingerprint(directory) {
  const hash = crypto.createHash('sha256');
  for (const name of fs.readdirSync(directory).filter(name => name.endsWith('.cjs')).sort())
    hash.update(name).update(fs.readFileSync(path.join(directory, name)));
  return hash.digest('hex');
}

function observe(lock, native) {
  const generated = fs.readFileSync(lock, 'utf8');
  const quoted = generated.match(/^\s+GH_AW_SAFE_OUTPUTS_CONFIG: ("[^\n]+")$/m);
  const block = generated.match(/^\s+GH_AW_VALIDATION_JSON: \|\n((?:            [^\n]*\n)+)/m);
  if (!quoted || !block) throw Error('Expected native generated collector configuration');
  const config = JSON.parse(JSON.parse(quoted[1]));
  const validation = JSON.parse(block[1].replace(/^            /gm, ''));
  const before = nativeFingerprint(native);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-assessment-'));
  try {
    const run = (mode, payload) => {
      const directory = fs.mkdtempSync(path.join(root, 'case-'));
      if (payload) {
        fs.writeFileSync(path.join(directory, 'input.jsonl'), payload.map(x => JSON.stringify(x)).join('\n'));
        fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
        fs.writeFileSync(path.join(directory, 'validation.json'), JSON.stringify(validation));
      }
      const env = { PATH: process.env.PATH, HOME: directory, RUNNER_TEMP: directory,
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
        GITHUB_REPOSITORY: 'fixture/project', LANG: 'C.UTF-8' };
      return JSON.parse(execFileSync(process.execPath, [__filename, mode, native, directory],
        { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
    };
    const produced = run('--produce');
    const collected = run('--collect', produced.items);
    const handoff = run('--collect', [
      { type: 'assign_to_user', issue_number: 12, assignees: ['reviewer'] },
      { type: 'add_reviewer', pull_request_number: 12, reviewers: ['reviewer'] },
    ]);
    const partial = run('--collect', [
      { type: 'noop', message: 'Completed inspection found no useful work' },
      { type: 'unconfigured_mutation', message: 'Invalid output' },
    ]);
    const jobs = [...generated.matchAll(/^  ([a-zA-Z_][\w-]*):\n([\s\S]*?)(?=^  [a-zA-Z_][\w-]*:\n|(?![\s\S]))/gm)];
    return {
      environmentJobs: jobs.filter(([, , text]) => text.includes('    environment: fixture-dependency-publisher')).map(([, name]) => name),
      tokenScopes: jobs.filter(([, , text]) => text.includes('id: safe-outputs-app-token')).map(([, name, text]) =>
        ({ job: name, scopes: text.split('\n').filter(line => /^          permission-/.test(line)).map(line => line.trim()) })),
      detectorAgentImages: jobs.find(([, name]) => name === 'detection')?.[2].match(/ghcr\.io\/github\/gh-aw-firewall\/agent:[^\s"\\]+/g),
      producerCapturedBaseline: produced.items[0]?.base_commit === produced.baseline,
      collectorPreservedBaseline: collected.output.items[0]?.base_commit === produced.baseline,
      nativeHandoff: { retainedTypes: handoff.output.items.map(x => x.type), errors: handoff.output.errors },
      partialCollection: { retainedTypes: partial.output.items.map(x => x.type), errors: partial.output.errors, failed: partial.failed },
      nativeSignals: ['noop', 'report_incomplete'].map(type => {
        const result = run('--collect', [{ type, [type === 'noop' ? 'message' : 'reason']: 'Synthetic terminal outcome' }]);
        return { type, retainedTypes: result.output.items.map(item => item.type), errors: result.output.errors };
      }),
      review: run('--review'),
      freshRepair: run('--publish-fresh', []),
      staleRepair: run('--publish-stale', []),
      signedApiFailure: run('--publish-api-failure', []),
      unmodifiedNativeSource: before === nativeFingerprint(native),
    };
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

if (process.argv[2]?.startsWith('--')) {
  worker(process.argv[2], process.argv[3], process.argv[4]).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.stack); process.exitCode = 1; });
} else {
  if (process.argv.length !== 4) throw Error('usage: node probe.cjs /absolute/native-delivery.lock.yml /absolute/native/actions/setup/js');
  console.log(JSON.stringify(observe(path.resolve(process.argv[2]), path.resolve(process.argv[3])), null, 2));
}
