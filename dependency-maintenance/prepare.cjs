const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

async function assertBundleProtection(exec, baseBranch, config, checkFileProtectionPostApply) {
  const { stdout } = await exec.getExecOutput("git", ["diff", "--name-only", "--no-renames", "-z", `origin/${baseBranch}...HEAD`]);
  if (checkFileProtectionPostApply(stdout.split("\0").filter(Boolean), config).action !== "allow")
    throw Error("Native bundle transport modifies protected files");
}

function prepare(actionsDir) {
  const modulePath = path.join(__dirname, "delivery.cjs");
  const pushFile = path.join(actionsDir, "push_to_pull_request_branch.cjs");
  const createFile = path.join(actionsDir, "create_pull_request.cjs");
  const push = fs.readFileSync(pushFile, "utf8");
  const create = fs.readFileSync(createFile, "utf8");
  const hash = source => createHash("sha256").update(source).digest("hex");
  if (hash(push) !== "0ce9e05e29f680d4fcb1a07664cc5dac99400b0ae41020a952d846dd4108de65" ||
      hash(create) !== "0667a66261dd5958dfc37959746b24f6588399cecae1b6730824a0f6dd5e76f1")
    throw Error("Pinned v0.89.21 dependency publishers changed");
  const handlerAnchor = "return async function handlePushToPullRequestBranch(message, resolvedTemporaryIds) {";
  const pushAnchor = "            signedCommits,\n            resolvedTemporaryIds,";
  const bundleAnchor = "          await applyBundleToBranch(bundleFilePath, branchName, originalAgentBranch, exec, baseBranch);";
  for (const [source, anchor] of [[push, handlerAnchor], [push, pushAnchor], [create, bundleAnchor]])
    if (source.split(anchor).length !== 2) throw Error("Pinned native publisher anchor changed");
  // Capture an absolute trusted path before the native handler checks out the
  // candidate branch. Never load a module from that candidate checkout.
  const guardedPush = push.replace(handlerAnchor, `${handlerAnchor}\n    if (config.signed_commits !== true || config.fallback_as_pull_request !== false) throw Error("Dependency repairs require signed commits and no replacement PR fallback");\n    const githubClient = require(${JSON.stringify(modulePath)}).guardPushClient(await createAuthenticatedGitHubClient(config), message, context);`)
    .replace(pushAnchor, "            signedCommits,\n            allowGitPushFallback: false,\n            resolvedTemporaryIds,");
  const guardedCreate = create.replace(bundleAnchor, `${bundleAnchor}\n          await require(${JSON.stringify(__filename)}).assertBundleProtection(exec, baseBranch, config, checkFileProtectionPostApply);`);
  fs.writeFileSync(pushFile, guardedPush);
  fs.writeFileSync(createFile, guardedCreate);
}

if (require.main === module) {
  prepare(path.join(process.env.RUNNER_TEMP, "gh-aw/actions"));
}
module.exports = { prepare, assertBundleProtection };
