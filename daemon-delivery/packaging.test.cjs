const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { isHumanReviewer } = require("./human-reviewer.cjs");
const root = path.resolve(__dirname, "..");
const action = fs.readFileSync(path.join(root, "actions/daemon-delivery/action.yml"), "utf8");
const command = action.split(/      run: \|[^\n]*\n/)[1].split("\n").map(line => line.slice(8)).join("\n");
const setup = process.env.GH_AW_SETUP_DIR;

test("dependency and daemon handoff share one human account exclusion implementation", () => {
  assert.equal(require("../dependency-maintenance/human-reviewer.cjs").isHumanReviewer, isHumanReviewer);
  for (const login of ["CharlieHelps", "CHARLIECREATES", "github-actions", "gumnut-bot", "chatgpt-codex-connector", "copilot", "service[BOT]", "", null])
    assert.equal(isHumanReviewer(login), false);
  assert.equal(isHumanReviewer("reviewer"), true);
});

test("action inputs remain data with patch-only preparation as the default", () => {
  assert.match(action, /default: 'false'/);
  assert.match(action, /DAEMON_DELIVERY_VALIDATE_PROPOSAL: \$\{\{ inputs.validate-proposal \}\}/);
  assert.doesNotMatch(command, /\$\{\{/);
  assert.doesNotMatch(action, /github\.token|secrets\./);
});

test("composite preserves trusted helpers for both native preparation modes", {
  skip: !setup && "Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js",
}, () => {
  for (const validate of [undefined, "true", "invalid"]) {
    const temp = fs.mkdtempSync(path.join(os.tmpdir(), "daemon-action-"));
    try {
      const native = path.join(temp, "gh-aw/actions");
      fs.cpSync(setup, native, { recursive: true });
      const names = ["add_reviewer.cjs", "safe_output_handler_manager.cjs"];
      const before = names.map(name => fs.readFileSync(path.join(native, name), "utf8"));
      const candidate = path.join(temp, "candidate"); fs.mkdirSync(candidate);
      const envFile = path.join(temp, "env"), output = path.join(temp, "output"), proposal = path.join(temp, "proposal.json");
      fs.writeFileSync(proposal, JSON.stringify({ errors: [], items: [
        { type: "create_pull_request", temporary_id: "aw_proposal" },
        { type: "add_reviewer", pull_request_number: "aw_proposal", reviewers: ["reviewer"] },
      ] }));
      const env = { ...process.env, AUTOMATION_ROOT: root, RUNNER_TEMP: temp,
        GITHUB_ENV: envFile, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: "fixture/project" };
      delete env.DAEMON_DELIVERY_VALIDATE_PROPOSAL;
      delete env.GH_AW_AGENT_OUTPUT;
      if (validate !== undefined) env.DAEMON_DELIVERY_VALIDATE_PROPOSAL = validate;
      if (validate === "true") env.GH_AW_AGENT_OUTPUT = proposal;
      const result = spawnSync("bash", ["-c", command], { cwd: candidate, env, encoding: "utf8" });
      if (validate === "invalid") {
        assert.notEqual(result.status, 0);
        assert.deepEqual(names.map(name => fs.readFileSync(path.join(native, name), "utf8")), before);
        assert.equal(fs.existsSync(envFile), false);
        continue;
      }
      assert.equal(result.status, 0, result.stderr);
      const trusted = fs.readFileSync(envFile, "utf8").trim().split("=")[1];
      assert.equal(path.dirname(trusted), temp);
      assert.equal(fs.readFileSync(output, "utf8"), `trusted-directory=${trusted}\n`);
      for (const name of ["prepare-reviewer-handler.cjs", "reviewer-handler.cjs", "human-reviewer.cjs", "native-transport.cjs"])
        assert.equal(fs.readFileSync(path.join(trusted, name), "utf8"), fs.readFileSync(path.join(__dirname, name), "utf8"));
      assert.ok(fs.readFileSync(path.join(native, names[0]), "utf8").includes(JSON.stringify(path.join(fs.realpathSync(trusted), "reviewer-handler.cjs"))));
      fs.writeFileSync(path.join(candidate, "human-reviewer.cjs"), 'throw Error("untrusted candidate")');
      assert.equal(require(path.join(trusted, "human-reviewer.cjs")).isHumanReviewer("reviewer"), true);
    } finally { fs.rmSync(temp, { recursive: true, force: true }); }
  }
});
