const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync, spawnSync } = require("node:child_process");
const { validateNativeProposals } = require("./native-transport.cjs");
const setup = process.env.GH_AW_SETUP_DIR;

function fixture(run) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "native-guard-test-"));
  const artifacts = [];
  try {
    const sourceDirectory = path.join(temporary, "source"); fs.mkdirSync(sourceDirectory);
    const env = { PATH: process.env.PATH, HOME: temporary, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };
    const git = (...args) => execFileSync("git", ["-c", "core.hooksPath=/dev/null", ...args],
      { cwd: sourceDirectory, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
    git("init", "-q", "--template="); git("config", "user.name", "gumnut-bot[bot]");
    git("config", "user.email", "fixture@example.invalid");
    fs.writeFileSync(path.join(sourceDirectory, "README.md"), "base\n"); git("add", "."); git("commit", "-qm", "base");
    const baseSha = git("rev-parse", "HEAD");
    const validator = path.join(temporary, "validator.cjs");
    fs.writeFileSync(validator, `const {execFileSync}=require('node:child_process');
const fs=require('node:fs');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
const paths=git('diff','--name-only',process.env.GITHUB_SHA,'HEAD').split('\\n');
if(paths.some(p=>p==='conftest.py'||p==='.github/config.yml'))throw Error('Protected candidate file');
if(git('log','--format=%an',process.env.GITHUB_SHA+'..HEAD').split('\\n').some(n=>n!=='gumnut-bot[bot]'))throw Error('Nonbot commit');
if(process.env.NODE_OPTIONS||process.env.GIT_CONFIG_COUNT||process.env.FIXTURE_SECRET)throw Error('Ambient environment leaked');
if(fs.existsSync('conftest.py'))throw Error('Candidate code must not run');
`);
    fs.mkdirSync("/tmp/gh-aw", { recursive: true });
    const capture = (filename, { patch = false, nonbot = false, start = baseSha } = {}) => {
      const branch = `fixture-${path.basename(temporary).toLowerCase()}-${artifacts.length}`;
      git("checkout", "-q", "-B", branch, start);
      if (nonbot) git("config", "user.name", "untrusted-author");
      const file = path.join(sourceDirectory, filename); fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "fixture\n"); git("add", "."); git("commit", "-qm", "proposal");
      git("config", "user.name", "gumnut-bot[bot]");
      const artifact = `/tmp/gh-aw/aw-${branch}.${patch ? "patch" : "bundle"}`; artifacts.push(artifact);
      if (patch) {
        const content = git("format-patch", "--stdout", `${start}..HEAD`) + "\n";
        const firstNewline = content.indexOf("\n");
        fs.writeFileSync(artifact, content.slice(0, firstNewline + 1) +
          `X-GH-AW-Base-Commit: ${start}\n` + content.slice(firstNewline + 1));
      }
      else git("bundle", "create", artifact, `${start}..${branch}`);
      return { type: "create_pull_request", temporary_id: `aw_test_${artifacts.length}`, branch };
    };
    const validate = items => validateNativeProposals({ items, baseSha, repository: "fixture/project", sourceDirectory,
      nativeDirectory: setup, validator });
    run({ validate, capture, git, baseSha, validator, sourceDirectory, temporary, artifacts, env });
  } finally {
    for (const artifact of artifacts) fs.rmSync(artifact, { force: true });
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
const native = { skip: !setup && "Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js" };

test("validates every captured branch despite a clean unrelated final checkout", native, () => fixture(({ capture, validate, git, baseSha }) => {
  const first = capture("safe.md");
  for (const [filename, options] of [["conftest.py", {}], [".github/config.yml", {}], ["ordinary.md", { nonbot: true }]]) {
    const unsafe = capture(filename, options);
    git("checkout", "-q", "-B", "final-unrelated", baseSha);
    assert.equal(git("status", "--porcelain"), "");
    assert.throws(() => validate([first, unsafe]), /Protected candidate file|Nonbot commit/);
    assert.equal(git("rev-parse", "HEAD"), baseSha);
  }
}));

test("allows multiple safe captured proposals and patch transport with isolated environment", native, () => fixture(({ capture, validate, git, baseSha }) => {
  const items = [capture("one.md"), capture("two.md"), capture("three.md", { patch: true })];
  git("checkout", "-q", "-B", "final-unrelated", baseSha);
  const previous = process.env.FIXTURE_SECRET; process.env.FIXTURE_SECRET = "must-not-reach-validator";
  try { assert.equal(validate(items).proposals.length, 3); }
  finally { if (previous === undefined) delete process.env.FIXTURE_SECRET; else process.env.FIXTURE_SECRET = previous; }
}));

test("rejects missing, malformed, stale and foreign captured transports", native, () => fixture(({ capture, validate, artifacts, git, baseSha }) => {
  const item = capture("safe.md");
  assert.throws(() => validate([{ ...item, repo: "other/project" }]), /this repository/);
  assert.throws(() => validate([{ ...item, type: "push_to_pull_request_branch" }]), /Unexpected/);
  assert.throws(() => validate([{ ...item, branch: `${item.branch}-missing` }]), /Missing regular/);
  const bytes = fs.readFileSync(artifacts[0]); fs.writeFileSync(artifacts[0], "not a bundle");
  assert.throws(() => validate([item]), /bundle|Bundle/); fs.writeFileSync(artifacts[0], bytes);
  git("checkout", "-q", "--orphan", "unrelated-history"); git("rm", "-rf", ".");
  fs.writeFileSync(path.join(git("rev-parse", "--show-toplevel"), "unrelated.md"), "other\n");
  git("add", "."); git("commit", "-qm", "unrelated root");
  const stale = capture("stale.md", { start: git("rev-parse", "HEAD") });
  // A self-contained unrelated history exercises ancestry rejection, rather
  // than only the bundle's missing-prerequisite rejection.
  fs.rmSync(artifacts.at(-1)); git("bundle", "create", artifacts.at(-1), stale.branch);
  assert.throws(() => validate([stale]));
  assert.ok(baseSha);
}));

test("CLI rejects collection errors before native publication", () => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "native-envelope-"));
  try {
    const output = path.join(temporary, "output.json");
    for (const envelope of [{ errors: ["failed collection"], items: [] }, { items: [] }, { errors: [], items: null }]) {
      fs.writeFileSync(output, JSON.stringify(envelope));
      const result = spawnSync(process.execPath, [path.join(__dirname, "native-transport.cjs"), "/unused/validator.cjs"],
        { env: { PATH: process.env.PATH, GH_AW_AGENT_OUTPUT: output, GITHUB_REPOSITORY: "fixture/project" }, encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /validation errors|Expected native output/);
    }
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
});


test("CLI supports a fixed trusted Python validator and captured base argument", native, () => fixture(({ capture, baseSha, temporary, sourceDirectory, env }) => {
  const item = capture("safe.md");
  const validator = path.join(temporary, "validator.py");
  fs.writeFileSync(validator, `import os, subprocess, sys
assert sys.argv[1] == os.environ['GITHUB_SHA']
assert 'FIXTURE_SECRET' not in os.environ
assert subprocess.check_output(['git', 'diff', '--name-only', sys.argv[1], 'HEAD'], text=True).strip() == 'safe.md'
`);
  const output = path.join(temporary, "output.json"); fs.writeFileSync(output, JSON.stringify({ errors: [], items: [item] }));
  const nativeDirectory = path.join(temporary, "gh-aw/actions"); fs.cpSync(setup, nativeDirectory, { recursive: true });
  const result = spawnSync(process.execPath, [path.join(__dirname, "native-transport.cjs"), "--", "python3", validator, baseSha],
    { cwd: sourceDirectory, env: { ...env, GH_AW_AGENT_OUTPUT: output, GITHUB_SHA: baseSha,
      GITHUB_REPOSITORY: "fixture/project", RUNNER_TEMP: temporary, FIXTURE_SECRET: "publisher-secret" }, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).proposals.length, 1);
}));

test("changing artifacts fail validation before publication", native, () => fixture(({ capture, artifacts, baseSha, temporary, sourceDirectory }) => {
  const item = capture("safe.md");
  const validator = path.join(temporary, "changing-validator.cjs");
  fs.writeFileSync(validator, `require('node:fs').appendFileSync(${JSON.stringify(artifacts[0])}, 'changed');`);
  assert.throws(() => validateNativeProposals({ items: [item], baseSha, repository: "fixture/project",
    sourceDirectory, nativeDirectory: setup, validator }), /transport changed/);
}));


test("patch header must bind publication to the captured source, including intervening control changes", native, () => fixture(({ capture, validate, artifacts, git, baseSha, sourceDirectory, validator }) => {
  const proposal = capture("safe.md", { patch: true });
  const original = fs.readFileSync(artifacts[0], "utf8");
  git("checkout", "-q", "-B", "dispatch-control-update", baseSha);
  fs.mkdirSync(path.join(sourceDirectory, ".github"));
  fs.writeFileSync(path.join(sourceDirectory, ".github/config.yml"), "trusted control update\n");
  git("add", "."); git("commit", "-qm", "update protected controls");
  const capturedBase = git("rev-parse", "HEAD");
  // Applying this safe-looking patch at capturedBase hides that native
  // publication would start at its older header and drop the control update.
  assert.throws(() => validateNativeProposals({ items: [{ ...proposal, base_commit: capturedBase }],
    baseSha: capturedBase, repository: "fixture/project", sourceDirectory, nativeDirectory: setup, validator }), /Embedded patch base/);
  fs.writeFileSync(artifacts[0], original.replace(/^X-GH-AW-Base-Commit:.*\n/m, ""));
  assert.throws(() => validate([proposal]), /Embedded patch base/);
}));
