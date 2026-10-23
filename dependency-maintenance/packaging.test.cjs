const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { isHumanReviewer } = require("./human-reviewer.cjs");
const root = path.resolve(__dirname, "..");
const action = fs.readFileSync(path.join(root, "actions/dependency-delivery/action.yml"), "utf8");
const command = action.split(/      run: \|[^\n]*\n/)[1].split("\n").map(line => line.slice(8)).join("\n");
const actions = process.env.GH_AW_SETUP_DIR || process.env.GH_AW_ACTIONS_DIR;

test("human handoff excludes known automation accounts case-insensitively", () => {
  for (const login of ["charliehelps", "CharlieCreates", "github-actions", "gumnut-bot", "chatgpt-codex-connector", "copilot", "service[BOT]", "", null])
    assert.equal(isHumanReviewer(login), false);
  assert.equal(isHumanReviewer("reviewer"), true);
});

test("composite exports trusted helpers outside candidate checkout before native branch switches", {
  skip: !actions && "Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js",
}, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-action-"));
  try {
    const native = path.join(temp, "gh-aw/actions");
    fs.mkdirSync(native, { recursive: true });
    for (const name of ["push_to_pull_request_branch.cjs", "create_pull_request.cjs"])
      fs.copyFileSync(path.join(actions, name), path.join(native, name));
    const candidate = path.join(temp, "candidate"); fs.mkdirSync(candidate);
    const envFile = path.join(temp, "env"), output = path.join(temp, "output");
    execFileSync("bash", ["-c", command], { cwd: candidate, env: { ...process.env,
      AUTOMATION_ROOT: root, RUNNER_TEMP: temp, GITHUB_ENV: envFile, GITHUB_OUTPUT: output,
    } });
    const trusted = fs.readFileSync(envFile, "utf8").trim().split("=")[1];
    assert.equal(path.dirname(trusted), temp);
    assert.equal(fs.readFileSync(output, "utf8"), `trusted-directory=${trusted}\n`);
    for (const name of ["delivery.cjs", "prepare.cjs", "human-reviewer.cjs"])
      assert.equal(fs.readFileSync(path.join(trusted, name), "utf8"), fs.readFileSync(path.join(root, "dependency-maintenance", name), "utf8"));
    assert.ok(fs.readFileSync(path.join(native, "push_to_pull_request_branch.cjs"), "utf8").includes(JSON.stringify(path.join(fs.realpathSync(trusted), "delivery.cjs"))));
    assert.ok(fs.readFileSync(path.join(native, "create_pull_request.cjs"), "utf8").includes(JSON.stringify(path.join(fs.realpathSync(trusted), "prepare.cjs"))));
    fs.writeFileSync(path.join(candidate, "delivery.cjs"), 'throw Error("untrusted candidate")');
    assert.equal(typeof require(path.join(trusted, "delivery.cjs")).handoff, "function");
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test("CI enables native publisher integration tests against the immutable upstream source", () => {
  const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
  assert.match(ci, /repository: github\/gh-aw\n\s+ref: c35393777e5604a63721d09512263b1383301d4f/);
  assert.match(ci, /GH_AW_SETUP_DIR: \$\{\{ github.workspace \}\}\/\.trusted-gh-aw\/actions\/setup\/js/);
  assert.match(action, /AUTOMATION_ROOT: \$\{\{ github.action_path \}\}\/\.\.\/\.\./);
  assert.doesNotMatch(action, /github\.token|secrets\.|inputs\./);
});


test("disabled consumer example wires native publication and trusted human handoff", () => {
  const source = fs.readFileSync(path.join(root, "examples/consumer/.github/workflows/dependency-maintenance.md"), "utf8");
  const [agent, publisher] = source.split("safe-outputs:\n");
  assert.ok(publisher);
  assert.match(agent, /^if: "false"$/m);
  assert.match(agent, /workflow_dispatch:/);
  assert.doesNotMatch(agent, /schedule:|secrets\.|github-app:|environment:|: write/);
  for (const permission of ["contents", "issues", "pull-requests"])
    assert.match(agent, new RegExp(`^  ${permission}: read$`, "m"));
  assert.match(agent, /allowed-repos: \[fixture\/project\]/);
  assert.match(agent, /allowed: \[get_file_contents, list_pull_requests, pull_request_read\]/);
  assert.match(source, /--action-tag c35393777e5604a63721d09512263b1383301d4f/);
  assert.match(publisher, /^  environment: fixture-dependency-publisher$/m);
  assert.match(publisher, /^    owner: fixture\n    repositories: \[project\]$/m);
  const [creation, repair] = publisher.split("  push-to-pull-request-branch:\n");
  assert.match(creation, /create-pull-request:/);
  assert.match(creation, /branch-prefix: dependency-maintenance\//);
  assert.match(repair, /signed-commits: true/);
  assert.match(repair, /fallback-as-pull-request: false/);
  assert.match(repair, /patch-format: bundle/);
  assert.match(publisher, /scripts:\n    handoff-dependency-pr:/);
  for (const input of ["pull_request_number", "head_sha", "reviewer", "action"])
    assert.match(publisher, new RegExp(`^        ${input}:`, "m"));
  assert.ok(publisher.includes("require(process.env.DEPENDENCY_MAINTENANCE_TRUSTED + '/delivery.cjs').handoff({ github, context, item })"));
  assert.match(publisher, /  steps:\n    - name: Constrain native dependency delivery\n      uses: gumnut-ai\/automation\/actions\/dependency-delivery@38e220e56a4a3530acaccad28e278736c0a314b3/);
});
