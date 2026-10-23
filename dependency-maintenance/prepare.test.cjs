const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");
const { prepare, assertBundleProtection } = require("./prepare.cjs");

// Point to actions/setup/js in the exact v0.89.21 source checkout. No external
// calls or credentials are used; publisher code is never invoked by this test.
const actions = process.env.GH_AW_SETUP_DIR || process.env.GH_AW_ACTIONS_DIR;
test("pinned native publisher contract retains transport and binds trusted guards", { skip: !actions && "Set GH_AW_ACTIONS_DIR to pinned v0.89.21 actions/setup/js" }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-publishers-"));
  const files = ["push_to_pull_request_branch.cjs", "create_pull_request.cjs"];
  try {
    for (const file of files) fs.copyFileSync(path.join(actions, file), path.join(dir, file));
    prepare(dir);
    const push = fs.readFileSync(path.join(dir, files[0]), "utf8");
    const create = fs.readFileSync(path.join(dir, files[1]), "utf8");
    assert.ok(push.includes("allowGitPushFallback: false"));
    assert.ok(push.includes(".guardPushClient(await createAuthenticatedGitHubClient(config), message, context)"));
    assert.ok(push.includes(JSON.stringify(path.join(__dirname, "delivery.cjs"))));
    assert.ok(create.includes(".assertBundleProtection(exec, baseBranch, config, checkFileProtectionPostApply)"));
    assert.ok(create.includes(JSON.stringify(path.join(__dirname, "prepare.cjs"))));
    assert.ok(push.includes("getBundlePreApplyFiles(exec, baseGitOpts, rangeBaseRef, bundleRef)"));
    new vm.Script(push); new vm.Script(create);
    // Hash drift must fail before modifying either native publisher.
    for (const file of files) fs.copyFileSync(path.join(actions, file), path.join(dir, file));
    fs.appendFileSync(path.join(dir, files[0]), "\n// drift\n");
    const original = files.map(file => fs.readFileSync(path.join(dir, file), "utf8"));
    assert.throws(() => prepare(dir), /Pinned/);
    assert.deepEqual(files.map(file => fs.readFileSync(path.join(dir, file), "utf8")), original);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("bundle protection checks the PR tree including merge-only changes", { skip: !actions && "Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js" }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dependency-bundle-tree-"));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: path.join(dir, "gitconfig"), GIT_CONFIG_NOSYSTEM: "1" };
  const git = (...args) => execFileSync("git", args, { cwd: dir, env, stdio: "pipe", encoding: "utf8" });
  const exec = { getExecOutput: async (_command, args) => ({ stdout: git(...args) }) };
  const { checkFileProtectionPostApply } = require(path.join(actions, "manifest_file_helpers.cjs"));
  const config = { protect_top_level_dot_folders: true, protected_files_policy: "blocked" };
  try {
    git("init", "-b", "main"); git("config", "user.name", "Review"); git("config", "user.email", "review@example.invalid");
    fs.mkdirSync(path.join(dir, ".github/workflows"), { recursive: true });
    const workflow = path.join(dir, ".github/workflows/p.yml");
    fs.writeFileSync(workflow, "base\n"); git("add", "."); git("commit", "-m", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    git("checkout", "-b", "left"); fs.writeFileSync(path.join(dir, "left.txt"), "left\n"); git("add", "."); git("commit", "-m", "left");
    await assertBundleProtection(exec, "main", config, checkFileProtectionPostApply);
    git("checkout", "-b", "right", "main"); fs.writeFileSync(path.join(dir, "right.txt"), "right\n"); git("add", "."); git("commit", "-m", "right");
    git("checkout", "left"); git("merge", "--no-ff", "--no-commit", "right");
    fs.writeFileSync(workflow, "changed only in the merge\n"); git("add", "."); git("commit", "-m", "merge");
    assert.ok(!git("log", "--format=", "--name-only", "origin/main..HEAD").includes(".github/workflows/p.yml"));
    await assert.rejects(assertBundleProtection(exec, "main", config, checkFileProtectionPostApply), /protected files/);
    await assert.rejects(assertBundleProtection(exec, "missing", config, checkFileProtectionPostApply));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
