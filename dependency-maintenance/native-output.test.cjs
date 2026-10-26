const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { guardPushClient } = require("./delivery.cjs");
const { correctOutputTransport } = require("./compile.cjs");

const actions = process.env.GH_AW_SETUP_DIR || process.env.GH_AW_ACTIONS_DIR;
function collectNative(root, items, corrected = true) {
  const config = { push_to_pull_request_branch: { max: 10 }, handoff_dependency_pr: { inputs: {
    action: { type: 'string', required: true }, pull_request_number: { type: 'number', required: true },
    head_sha: { type: 'string', required: true }, reviewer: { type: 'string', required: true },
  } } };
  const validation = { push_to_pull_request_branch: { defaultMax: 1, fields: {
    branch: { type: 'string' }, message: { type: 'string', required: true },
    pull_request_number: { issueOrPRNumber: true }, repo: { type: 'string' },
  } } };
  const raw = `          GH_AW_SAFE_OUTPUTS_CONFIG: ${JSON.stringify(JSON.stringify(config))}
          GH_AW_VALIDATION_JSON: |
${JSON.stringify(validation, null, 2).split('\n').map(line => `            ${line}`).join('\n')}
          script: |
            const { main } = require(path.join(actionsDir, 'collect_ndjson_output.cjs'));
            await main();
`;
  const transport = corrected ? correctOutputTransport(raw) : raw;
  const transportConfig = JSON.parse(JSON.parse(transport.match(/GH_AW_SAFE_OUTPUTS_CONFIG: (.+)/)[1]));
  const transportValidation = JSON.parse(transport.match(/GH_AW_VALIDATION_JSON: \|\n([\s\S]*?)          script:/)[1].replace(/^            /gm, ''));
  fs.writeFileSync(path.join(root, 'input.jsonl'), items.map(item => JSON.stringify(item)).join('\n'));
  fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify(transportConfig));
  fs.writeFileSync(path.join(root, 'validation.json'), JSON.stringify(transportValidation));
  const script = `
    const path = require('node:path');
    const actionsDir = ${JSON.stringify(actions)};
    const constantsPath = path.join(actionsDir, 'constants.cjs');
    const constants = require(constantsPath);
    // Isolate the native collector's fixed /tmp output path without changing
    // its implementation or other concurrent native integration fixtures.
    require.cache[require.resolve(constantsPath)].exports = { ...constants, TMP_GH_AW_PATH: process.env.RUNNER_TEMP };
    global.context = { repo: { owner: 'fixture', repo: 'project' }, eventName: 'schedule', payload: {} };
    global.github = {};
    let output, failed = false;
    global.core = { debug() {}, info() {}, warning() {}, error() {},
      setOutput(key, value) { if (key === 'output') output = JSON.parse(value); },
      exportVariable(key, value) { process.env[key] = value; },
      setFailed() { failed = true; }
    };
    (async () => {
${transport.split('          script: |\n')[1]}
      process.stdout.write(JSON.stringify({ output, failed }));
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', env: {
    ...process.env, RUNNER_TEMP: root, GH_AW_SAFE_OUTPUTS: path.join(root, 'input.jsonl'),
    GH_AW_SAFE_OUTPUTS_CONFIG_PATH: path.join(root, 'config.json'), GH_AW_VALIDATION_CONFIG_PATH: path.join(root, 'validation.json'),
  } }));
}

for (const number of [12, "12"]) test(`native repair tool records its baseline with ${typeof number} PR number`, { skip: !actions && "Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js" }, async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-native-output-"));
  const repo = path.join(root, "repo"), remote = path.join(root, "remote.git");
  fs.mkdirSync(repo);
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(root, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", args, { cwd: repo, env, stdio: "pipe", encoding: "utf8" }).trim();
  try {
    git("init", "--bare", remote);
    git("init", "-b", "main");
    git("config", "user.name", "Fixture Bot");
    git("config", "user.email", "bot@example.invalid");
    fs.writeFileSync(path.join(repo, "package.json"), '{"version":"1.0.0"}\n');
    git("add", "package.json"); git("commit", "-m", "Initial dependency");
    git("remote", "add", "origin", remote); git("push", "origin", "main");
    git("checkout", "-b", "dependabot/npm/update");
    git("push", "origin", "HEAD");
    const baseline = git("rev-parse", "HEAD");
    fs.writeFileSync(path.join(repo, "package.json"), '{"version":"1.0.1"}\n');
    git("add", "package.json"); git("commit", "-m", "Repair dependency compatibility");
    // Run the real MCP-side handler with only advertised tool arguments. All
    // Git transport stays in the disposable local repository; no provider calls.
    const script = `
      global.core = { debug() {}, info() {}, warning() {}, error() {} };
      global.context = { repo: { owner: "fixture", repo: "project" }, eventName: "schedule", payload: {} };
      const { createHandlers } = require(${JSON.stringify(path.join(actions, "safe_outputs_handlers.cjs"))});
      const output = [];
      const handlers = createHandlers({ debug() {} }, item => output.push(item), {
        push_to_pull_request_branch: { target: "*", base_branch: "main", patch_format: "bundle", max: 1, patch_workspace_path: ".", current_checkout_repo: "fixture/project" }
      });
      handlers.pushToPullRequestBranchHandler({ repo: "fixture/project", branch: "dependabot/npm/update", pull_request_number: ${JSON.stringify(number)}, message: "Repair dependency compatibility" })
        .then(result => { if (result.isError) throw Error(JSON.stringify(result)); process.stdout.write(JSON.stringify(output)); });
    `;
    const output = JSON.parse(execFileSync(process.execPath, ["-e", script], {
      cwd: repo, encoding: "utf8", env: { ...env, GITHUB_WORKSPACE: repo, RUNNER_TEMP: root, GITHUB_REPOSITORY: "fixture/project", GITHUB_TOKEN: "" },
    }));
    assert.equal(output.length, 1);
    assert.equal(output[0].base_commit, baseline);
    const target = { number: 12, state: "open", user: { id: 49699333, login: "dependabot[bot]", type: "Bot" },
      base: { ref: "main", repo: { full_name: "fixture/project" } },
      head: { ref: "dependabot/npm/update", sha: baseline, repo: { full_name: "fixture/project" } },
    };
    const context = { repo: { owner: "fixture", repo: "project" } };
    const client = { rest: { pulls: { get: async () => ({ data: target }) } } };
    const original = collectNative(root, output, false);
    assert.equal(original.output.items[0].base_commit, undefined);
    await assert.rejects(guardPushClient(client, original.output.items[0], context).rest.pulls.get({ ...context.repo, pull_number: 12 }), /captured head/);
    const collected = collectNative(root, output);
    assert.equal(collected.failed, false);
    assert.deepEqual(collected.output.errors, []);
    assert.equal(collected.output.items[0].base_commit, baseline);
    const guarded = guardPushClient(client, collected.output.items[0], context);
    await guarded.rest.pulls.get({ ...context.repo, pull_number: 12 });
    target.head.sha = 'f'.repeat(40);
    await assert.rejects(guardPushClient(client, collected.output.items[0], context).rest.pulls.get({ ...context.repo, pull_number: 12 }), /captured head/);
    const invalid = collectNative(root, [{ ...output[0], base_commit: 'malformed' }]);
    assert.equal(invalid.failed, true);
    assert.equal(invalid.output.items.length, 0);
    assert.equal(invalid.output.errors.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('native collection retains both handoff actions and fails the agent on a discarded intent', { skip: !actions && 'Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-native-handoff-'));
  try {
    const items = ['assign', 'request_review'].map(action => ({ type: 'handoff_dependency_pr', action,
      pull_request_number: 12, head_sha: 'a'.repeat(40), reviewer: 'reviewer' }));
    const original = collectNative(root, items, false);
    assert.equal(original.output.items.length, 1);
    assert.equal(original.output.errors.length, 1);
    assert.equal(original.failed, false); // the native collector leaves truncation green
    const corrected = collectNative(root, items);
    assert.deepEqual(corrected.output.items, items);
    assert.deepEqual(corrected.output.errors, []);
    assert.equal(corrected.failed, false);
    const discarded = collectNative(root, [...items, { ...items[0], action: undefined }]);
    assert.equal(discarded.output.items.length, 2);
    assert.equal(discarded.output.errors.length, 1);
    assert.equal(discarded.failed, true); // existing agent-success gate blocks publication
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

// The native numeric ceiling is transport headroom, not the agent's one-repair policy.
test('native collection retains multiple repair intents without a one-proposal cap', { skip: !actions && 'Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-native-repairs-'));
  try {
    const items = [12, 13].map(pull_request_number => ({ type: 'push_to_pull_request_branch',
      pull_request_number, message: 'Repair compatibility', branch: `bot/update-${pull_request_number}`, base_commit: 'a'.repeat(40) }));
    const collected = collectNative(root, items);
    assert.deepEqual(collected.output.items, items);
    assert.deepEqual(collected.output.errors, []);
    assert.equal(collected.failed, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
