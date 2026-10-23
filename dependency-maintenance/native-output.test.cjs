const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { guardPushClient } = require("./delivery.cjs");

const actions = process.env.GH_AW_SETUP_DIR || process.env.GH_AW_ACTIONS_DIR;
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
    const guarded = guardPushClient({ rest: { pulls: { get: async () => ({ data: target }) } } }, output[0], context);
    await guarded.rest.pulls.get({ ...context.repo, pull_number: 12 });
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
