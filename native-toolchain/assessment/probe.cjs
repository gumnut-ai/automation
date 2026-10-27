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
  global.context = { repo: { owner: 'fixture', repo: 'project' }, eventName: 'schedule', payload: { repository: { default_branch: 'main' } } };
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
  const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json')));
  if (mode === '--produce') {
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    const remote = path.join(root, 'remote.git');
    git('init', '--bare', remote);
    git('init', '-b', 'main');
    git('config', 'user.name', 'Fixture Bot');
    git('config', 'user.email', 'bot@example.invalid');
    fs.writeFileSync(path.join(root, 'sample.txt'), 'Before repair\n');
    git('add', 'sample.txt'); git('commit', '-m', 'Initial dependency');
    git('remote', 'add', 'origin', remote); git('push', 'origin', 'main');
    const branch = `dependabot/npm/${path.basename(root).toLowerCase()}`;
    git('checkout', '-b', branch); git('push', 'origin', 'HEAD');
    const baseline = git('rev-parse', 'HEAD');
    fs.writeFileSync(path.join(root, 'sample.txt'), 'After repair\n');
    git('add', 'sample.txt'); git('commit', '-m', 'Repair compatibility');
    process.env.GITHUB_WORKSPACE = root;
    const items = [];
    const { createHandlers } = require(path.join(native, 'safe_outputs_handlers.cjs'));
    const handlers = createHandlers({ debug() {} }, item => items.push(item), {
      push_to_pull_request_branch: { ...config.push_to_pull_request_branch, base_branch: 'main',
        patch_workspace_path: '.', current_checkout_repo: 'fixture/project' },
    });
    const result = await handlers.pushToPullRequestBranchHandler({ repo: 'fixture/project',
      branch, pull_request_number: 12, message: 'Repair compatibility' });
    if (result.isError) throw Error(JSON.stringify(result));
    return { baseline, branch, items };
  }
  if (mode === '--collect') {
    process.env.GH_AW_SAFE_OUTPUTS = path.join(root, 'input.jsonl');
    process.env.GH_AW_SAFE_OUTPUTS_CONFIG_PATH = path.join(root, 'config.json');
    process.env.GH_AW_VALIDATION_CONFIG_PATH = path.join(root, 'validation.json');
    await require(path.join(native, 'collect_ndjson_output.cjs')).main();
    return { output: JSON.parse(state.outputs.output), failed: state.failed };
  }
  if (mode.startsWith('--publish-')) {
    const produced = await worker('--produce', native, root);
    if (mode === '--publish-protected-file') {
      fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
      fs.writeFileSync(path.join(root, '.github/workflows/active.yml'), 'name: Hidden control edit\n');
      execFileSync('git', ['add', '.github'], { cwd: root });
      execFileSync('git', ['commit', '-m', 'Unadvertised control edit'], { cwd: root, stdio: 'pipe' });
      const bundle = require(path.join(native, 'generate_git_bundle.cjs')).getBundlePathForBranchInRepo(produced.items[0].branch, 'fixture/project');
      execFileSync('git', ['bundle', 'create', bundle, `${produced.baseline}..HEAD`], { cwd: root });
    }
    fs.writeFileSync(path.join(root, 'input.jsonl'), produced.items.map(x => JSON.stringify(x)).join('\n'));
    const collected = await worker('--collect', native, root);
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    const branch = produced.branch;
    if (mode === '--publish-stale') {
      git('branch', 'agent-repair', 'HEAD'); git('checkout', '-b', 'human-writer', produced.baseline);
      fs.writeFileSync(path.join(root, 'human.txt'), 'Competing human change\n');
      git('add', 'human.txt'); git('commit', '-m', 'Human change');
      git('push', 'origin', `HEAD:refs/heads/${branch}`); git('checkout', 'agent-repair');
    }
    const remoteBefore = git('ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0];
    const writes = [];
    const labels = mode === '--publish-unlabelled' ? [] : (config.push_to_pull_request_branch.required_labels || []);
    global.github = { rest: {
      pulls: { get: async () => ({ data: { number: 12, state: 'open', title: 'Dependency update', labels: labels.map(name => ({ name })),
        user: { login: 'dependabot[bot]', id: 49699333, type: 'Bot' },
        base: { ref: 'main', repo: { full_name: 'fixture/project' } },
        head: { ref: mode === '--publish-default' ? 'main' : branch, sha: remoteBefore,
          repo: { full_name: mode === '--publish-foreign' ? 'foreign/project' : 'fixture/project' } } } }) },
      repos: { get: async () => ({ data: { default_branch: 'main' } }),
        getBranchProtection: async () => {
          if (mode === '--publish-protected-branch') return { data: {} };
          throw Object.assign(Error('Not protected'), { status: 404 });
        } },
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
    const handler = await require(path.join(native, 'push_to_pull_request_branch.cjs')).main(config.push_to_pull_request_branch);
    const result = await handler(collected.output.items[0], {});
    const remoteAfter = git('ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0];
    return { result, baseline: produced.baseline, remoteBefore, remoteAfter,
      unsignedLocalFallback: mode === '--publish-api-failure' && writes.length > 0 && remoteAfter !== remoteBefore &&
        !git('cat-file', '-p', remoteAfter).split('\n\n')[0].includes('\ngpgsig '),
      mutationCount: writes.length, mutationExpectedHeads: writes.map(x => x.expectedHeadOid),
      humanFileAfterApply: fs.existsSync(path.join(root, 'human.txt')) };
  }
  if (mode === '--review') {
    const calls = [];
    global.github = { rest: {
      issues: { get: async () => ({ data: { labels: (config.add_reviewer?.required_labels || []).map(name => ({ name })) } }),
        addAssignees: async args => { calls.push(args); return { data: {} }; } },
      pulls: { get: async () => ({ data: { requested_reviewers: [], requested_teams: [] } }),
        listReviews: async () => ({ data: [] }),
        requestReviewers: async args => { calls.push(args); return { data: {} }; } },
    } };
    const { sortMessageIndicesByTemporaryIdDependencies: sort } = require(path.join(native, 'safe_output_handler_manager.cjs'));
    const reviewer = { type: 'add_reviewer', reviewers: ['reviewer'], pull_request_number: 'aw_proposal' };
    const proposal = { type: 'create_pull_request', temporary_id: 'aw_proposal' };
    const handler = await require(path.join(native, 'add_reviewer.cjs')).main(config.add_reviewer);
    return { reversedOrder: sort([reviewer, proposal]),
      temporaryIdResult: await handler(reviewer, { aw_proposal: { repo: 'fixture/project', number: 12 } }),
      numericResult: await handler({ ...reviewer, pull_request_number: 12 }, {}),
      assignment: config.assign_to_user ? await (await require(path.join(native, 'assign_to_user.cjs')).main(config.assign_to_user))(
        { type: 'assign_to_user', issue_number: 12, assignees: ['reviewer'] }, {}) : null, calls };
  }
  if (mode.startsWith('--create-')) {
    const cfg = config.create_pull_request;
    const textOnly = Boolean(cfg.allowed_files?.length);
    const sampleFile = textOnly ? 'README.md' : 'sample.txt';
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' }).trim();
    git('init', '--bare', path.join(root, 'remote.git')); git('init', '-b', 'main');
    git('config', 'user.name', 'Fixture Bot'); git('config', 'user.email', 'bot@example.invalid');
    fs.appendFileSync(path.join(root, '.git/info/exclude'), '\n/remote.git/\n');
    fs.writeFileSync(path.join(root, sampleFile), 'Original\n');
    git('add', '.'); git('commit', '-m', 'Baseline');
    git('remote', 'add', 'origin', path.join(root, 'remote.git')); git('push', 'origin', 'main');
    git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    const baseline = git('rev-parse', 'HEAD');
    process.env.GITHUB_SHA = baseline; process.env.GITHUB_WORKSPACE = root;
    process.env.GH_AW_WORKFLOW_ID = 'native-assessment';
    context.payload = { repository: { default_branch: 'main' } };
    const branch = (cfg.allowed_branches?.[0] || 'proposal/*').replace('*', path.basename(root).toLowerCase());
    git('checkout', '-b', branch);
    if (mode === '--create-protected' || mode === '--create-rename') {
      fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
      if (mode === '--create-rename') git('mv', sampleFile, '.github/workflows/active.yml');
      else fs.writeFileSync(path.join(root, '.github/workflows/active.yml'), 'name: Forbidden candidate\n');
    } else {
      fs.writeFileSync(path.join(root, sampleFile), 'Updated\n');
      if (!textOnly) {
        fs.writeFileSync(path.join(root, 'artifact.bin'), Buffer.from([0, 255, 128, 1, 0, 17]));
        fs.writeFileSync(path.join(root, 'tool.sh'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      }
    }
    git('add', '.'); git('commit', '-m', 'Candidate');
    const items = [];
    const handlers = require(path.join(native, 'safe_outputs_handlers.cjs')).createHandlers({ debug() {} }, item => items.push(item), {
      create_pull_request: { ...cfg, base_branch: 'main', patch_workspace_path: '.', current_checkout_repo: 'fixture/project' },
    });
    const produced = await handlers.createPullRequestHandler({ branch: mode === '--create-default' ? 'main' : branch,
      ...(mode === '--create-foreign' ? { repo: 'foreign/project' } : {}),
      title: 'Fixture proposal', body: 'Synthetic change', temporary_id: 'aw_proposal' });
    if (produced.isError) return { phase: 'producer', result: produced, writes: [] };
    if (mode === '--create-unexpected-bundle') {
      // The agent can write artifact files directly, bypassing its capture tool.
      // Keep the advertised safe patch, but add a bundle containing a protected edit.
      fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
      fs.writeFileSync(path.join(root, '.github/workflows/active.yml'), 'name: Hidden control edit\n');
      git('add', '.github'); git('commit', '-m', 'Unadvertised protected change');
      const bundleFilePath = require(path.join(native, 'generate_git_bundle.cjs')).getBundlePathForBranchInRepo(branch, 'fixture/project');
      git('bundle', 'create', bundleFilePath, `${baseline}..${branch}`);
    }
    fs.writeFileSync(path.join(root, 'input.jsonl'), items.map(x => JSON.stringify(x)).join('\n'));
    const collected = await worker('--collect', native, root);
    if (!collected.output.items.length) return { phase: 'collector', result: collected, writes: [] };
    // Publication gets a fresh dispatch checkout, not the agent's local branch.
    git('checkout', 'main'); git('branch', '-D', branch);
    const writes = [];
    global.github = { rest: {
      repos: { get: async () => ({ data: { default_branch: 'main' } }) },
      pulls: { list: async () => ({ data: [] }), create: async args => {
        writes.push(args); return { data: { number: 12, html_url: 'https://github.com/fixture/project/pull/12', head: { ref: args.head } } };
      } }, issues: { addLabels: async () => ({ data: {} }) },
    } };
    global.exec = { getExecOutput: async (command, args, opts = {}) => {
      if (command !== 'git') throw Error('Only local Git is permitted');
      const r = spawnSync(command, args, { cwd: opts.cwd || root, env: process.env, encoding: 'utf8' });
      if (r.error) throw r.error;
      if (r.status && !opts.ignoreReturnCode) throw Error(r.stderr);
      return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
    } };
    exec.exec = async (...args) => (await exec.getExecOutput(...args)).exitCode;
    const prompts = path.join(root, 'gh-aw/prompts'); fs.mkdirSync(prompts, { recursive: true });
    fs.copyFileSync(path.join(native, '../md/safe_outputs_disclosure_header.md'), path.join(prompts, 'safe_outputs_disclosure_header.md'));
    const result = await (await require(path.join(native, 'create_pull_request.cjs')).main(cfg))(collected.output.items[0], {});
    const remoteHead = git('ls-remote', 'origin', `refs/heads/${branch}`).split('\t')[0];
    return { mode, sampleFile, result, writes, remoteHead, baseline,
      defaultBranchUnchanged: git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0] === baseline,
      protectedFilePublished: remoteHead ? spawnSync('git', ['cat-file', '-e', `${remoteHead}:.github/workflows/active.yml`], { cwd: root }).status === 0 : false,
      binary: remoteHead && !textOnly && mode === '--create-fresh' ? execFileSync('git', ['show', `${remoteHead}:artifact.bin`], { cwd: root }).equals(Buffer.from([0, 255, 128, 1, 0, 17])) : null,
      executable: remoteHead && !textOnly ? git('ls-tree', remoteHead, 'tool.sh').startsWith('100755') : null };
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
  // Simulate GitHub resolving trusted admission output before a step executes.
  const fixtureBindings = [];
  for (const [type, value] of Object.entries(config)) {
    if (typeof value?.target === 'string' && value.target.includes('${{')) {
      fixtureBindings.push({ type, field: 'target', expression: value.target, value: '12' });
      value.target = '12';
    }
  }
  const validation = JSON.parse(block[1].replace(/^            /gm, ''));
  const before = nativeFingerprint(native);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'native-assessment-'));
  try {
    const run = (mode, payload) => {
      const directory = fs.mkdtempSync(path.join(root, 'case-'));
      fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
      fs.writeFileSync(path.join(directory, 'validation.json'), JSON.stringify(validation));
      if (payload) {
        fs.writeFileSync(path.join(directory, 'input.jsonl'), payload.map(x => JSON.stringify(x)).join('\n'));
        fs.writeFileSync(path.join(directory, 'config.json'), JSON.stringify(config));
        fs.writeFileSync(path.join(directory, 'validation.json'), JSON.stringify(validation));
      }
      const env = { PATH: process.env.PATH, HOME: directory, RUNNER_TEMP: directory,
        GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
        GITHUB_REPOSITORY: 'fixture/project', LANG: 'C.UTF-8' };
      try {
        return JSON.parse(execFileSync(process.execPath, [__filename, mode, native, directory],
          { cwd: directory, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
      } finally {
        // Native transport paths are fixed under /tmp/gh-aw. Unique branch names
        // isolate them without replacing native path helpers or touching other runs.
        const artifacts = '/tmp/gh-aw';
        for (const name of fs.existsSync(artifacts) ? fs.readdirSync(artifacts) : [])
          if (name.startsWith('aw-') && name.includes(path.basename(directory).toLowerCase()) && /\.(patch|bundle)$/.test(name))
            fs.rmSync(path.join(artifacts, name));
      }
    };
    const produced = config.push_to_pull_request_branch ? run('--produce') : null;
    const collected = produced ? run('--collect', produced.items) : null;
    const handoff = run('--collect', [
      { type: 'assign_to_user', issue_number: 12, assignees: ['reviewer'] },
      { type: 'add_reviewer', pull_request_number: 12, reviewers: ['reviewer'] },
    ].filter(item => config[item.type]));
    const partial = run('--collect', [
      { type: 'noop', message: 'Completed inspection found no useful work' },
      { type: 'unconfigured_mutation', message: 'Invalid output' },
    ]);
    const jobs = [...generated.matchAll(/^  ([a-zA-Z_][\w-]*):\n([\s\S]*?)(?=^  [a-zA-Z_][\w-]*:\n|(?![\s\S]))/gm)];
    return {
      fixtureBindings,
      environmentJobs: jobs.filter(([, , text]) => /^    environment:/m.test(text)).map(([, name, text]) =>
        ({ job: name, environment: text.match(/^    environment: (.*)$/m)?.[1] })),
      tokenScopes: jobs.filter(([, , text]) => text.includes('id: safe-outputs-app-token') || text.includes('id: native_job_token')).map(([, name, text]) =>
        ({ job: name, scopes: text.split('\n').filter(line => /^          permission-/.test(line)).map(line => line.trim()) })),
      detectorAgentImages: jobs.find(([, name]) => name === 'detection')?.[2].match(/ghcr\.io\/github\/gh-aw-firewall\/agent:[^\s"\\]+/g),
      producerCapturedBaseline: produced ? produced.items[0]?.base_commit === produced.baseline : null,
      collectorPreservedBaseline: produced ? collected.output.items[0]?.base_commit === produced.baseline : null,
      nativeHandoff: { retainedTypes: handoff.output.items.map(x => x.type), errors: handoff.output.errors },
      partialCollection: { retainedTypes: partial.output.items.map(x => x.type), errors: partial.output.errors, failed: partial.failed },
      nativeSignals: ['noop', 'report_incomplete'].map(type => {
        const result = run('--collect', [{ type, [type === 'noop' ? 'message' : 'reason']: 'Synthetic terminal outcome' }]);
        return { type, retainedTypes: result.output.items.map(item => item.type), errors: result.output.errors };
      }),
      review: config.add_reviewer ? run('--review') : null,
      freshRepair: produced ? run('--publish-fresh', []) : null,
      staleRepair: produced ? run('--publish-stale', []) : null,
      signedApiFailure: produced && config.push_to_pull_request_branch.signed_commits !== false ? run('--publish-api-failure', []) : null,
      unauthorizedRepair: produced ? [
        ...(config.push_to_pull_request_branch.required_labels?.length ? ['unlabelled'] : []),
        'foreign', 'default', 'protected-branch', 'protected-file',
      ].map(type => ({ type, ...run(`--publish-${type}`, []) })) : [],
      creations: config.create_pull_request ? ['fresh', 'protected', 'rename', 'foreign', 'default', 'unexpected-bundle'].map(type => ({ type, ...run(`--create-${type}`, []) })) : [],
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
