const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { execFileSync, spawnSync } = require("node:child_process");
const { validateProposal } = require("./prepare-reviewer-handler.cjs");

const hash = file => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

// Run object reconstruction and the dispatch-source validator without ambient
// credentials, Git configuration, Node preloads or candidate hooks.
function validateNativeProposals({ items, baseSha, repository, sourceDirectory, nativeDirectory, validator }) {
  validateProposal({ errors: [], items }, repository);
  if (!/^[a-f0-9]{40}$/.test(baseSha) || !/^[\w.-]+\/[\w.-]+$/.test(repository))
    throw Error("Invalid captured source identity");
  if (typeof validator === "string") validator = { executable: process.execPath, args: [validator] };
  if (!["node", process.execPath, "python3"].includes(validator?.executable) ||
      !Array.isArray(validator.args) || !validator.args.every(arg => typeof arg === "string") ||
      !path.isAbsolute(validator.args[0] || "") || !fs.lstatSync(validator.args[0]).isFile())
    throw Error("Expected fixed trusted Node or Python validator with an absolute script path");
  validator = { executable: validator.executable === "node" ? process.execPath : validator.executable,
    args: [fs.realpathSync(validator.args[0]), ...validator.args.slice(1)] };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "daemon-transport-"));
  try {
    const home = path.join(temporary, "home"); fs.mkdirSync(home);
    const env = { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0", GITHUB_SHA: baseSha, GITHUB_REPOSITORY: repository };
    return JSON.parse(execFileSync(process.execPath, [__filename, "--candidate", JSON.stringify({
      items, baseSha, repository, sourceDirectory: path.resolve(sourceDirectory),
      nativeDirectory: path.resolve(nativeDirectory), validator, temporary,
    })], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); }
}

async function candidates({ items, baseSha, repository, sourceDirectory, nativeDirectory, validator, temporary }) {
  for (const [name, expected] of Object.entries({
    "resolve_transport_paths.cjs": "16d5f434fb2d6b9afaca576d8d414f4e7a4e1605453010b43866f4537c1c06e2",
    "create_pull_request.cjs": "0667a66261dd5958dfc37959746b24f6588399cecae1b6730824a0f6dd5e76f1",
    "commit_sha_helpers.cjs": "c30d2dd1345cf94ee8f338795d22c14b1a16ddf996f24b7910846f4d8748d332",
  })) if (hash(path.join(nativeDirectory, name)) !== expected) throw Error("Pinned v0.89.21 transport helper changed");
  global.core = Object.fromEntries(["info", "warning", "debug", "error"].map(key => [key, () => {}]));
  const { resolveTransportPaths } = require(path.join(nativeDirectory, "resolve_transport_paths.cjs"));
  const { applyBundleToBranch } = require(path.join(nativeDirectory, "create_pull_request.cjs"));
  const { extractPatchBaseCommit } = require(path.join(nativeDirectory, "commit_sha_helpers.cjs"));
  const proposals = [];
  for (const proposal of items.filter(item => item.type === "create_pull_request")) {
    if (typeof proposal.branch !== "string" || !proposal.branch || proposal.branch.startsWith("-"))
      throw Error("Missing valid captured proposal branch");
    const transport = resolveTransportPaths(proposal, repository);
    const selected = transport.bundlePath || transport.patchPath;
    if (!selected || !fs.lstatSync(selected).isFile()) throw Error("Missing regular native proposal transport");
    const sha256 = hash(selected);
    const candidate = path.join(temporary, `repository-${proposals.length}`); fs.mkdirSync(candidate);
    const execute = (command, args, options = {}) => {
      if (command !== "git") throw Error("Only native Git object operations allowed");
      const result = spawnSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "protocol.allow=never",
        "-c", "protocol.file.allow=always", ...args], { cwd: candidate, encoding: "utf8" });
      if (result.error) throw result.error;
      if (result.status !== 0 && !options.ignoreReturnCode) throw Error(result.stderr || "Native Git operation failed");
      return { exitCode: result.status, stdout: result.stdout, stderr: result.stderr };
    };
    const git = (...args) => execute("git", args).stdout.trim();
    const execApi = { exec: async (command, args, options) => execute(command, args, options).exitCode,
      getExecOutput: async (command, args, options) => execute(command, args, options) };
    git("check-ref-format", "--branch", proposal.branch);
    git("init", "-q", "--template=");
    git("config", "user.name", "gumnut-bot[bot]");
    git("config", "user.email", "333470196+gumnut-bot[bot]@users.noreply.github.com");
    git("fetch", "--no-tags", sourceDirectory, `${baseSha}:refs/base`);
    git("checkout", "-q", "-B", proposal.branch, baseSha);
    if (transport.bundlePath) await applyBundleToBranch(selected, proposal.branch, proposal.branch, execApi);
    else {
      // Native publication starts from this embedded header, not JSON metadata.
      // Missing headers would let its later base-branch lookup select another tree.
      if (extractPatchBaseCommit(fs.readFileSync(selected, "utf8")) !== baseSha)
        throw Error("Embedded patch base differs from captured source or is missing");
      git("am", "--3way", selected);
    }
    git("merge-base", "--is-ancestor", baseSha, "HEAD");
    execFileSync(validator.executable, validator.args, { cwd: candidate, env: process.env,
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (hash(selected) !== sha256) throw Error("Native proposal transport changed during validation");
    proposals.push({ branch: proposal.branch, candidateHead: git("rev-parse", "HEAD"),
      transport: { name: path.basename(selected), sha256, kind: transport.bundlePath ? "bundle" : "patch" } });
  }
  return { proposals };
}

if (require.main === module) {
  if (process.argv[2] === "--candidate") {
    candidates(JSON.parse(process.argv[3])).then(result => console.log(JSON.stringify(result)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  } else {
    try {
      const output = JSON.parse(fs.readFileSync(process.env.GH_AW_AGENT_OUTPUT, "utf8"));
      validateProposal(output, process.env.GITHUB_REPOSITORY);
      console.log(JSON.stringify(validateNativeProposals({ items: output.items, baseSha: process.env.GITHUB_SHA,
        repository: process.env.GITHUB_REPOSITORY, sourceDirectory: process.cwd(),
        nativeDirectory: path.join(process.env.RUNNER_TEMP, "gh-aw/actions"),
        validator: process.argv[2] === "--" ? { executable: process.argv[3], args: process.argv.slice(4) } : process.argv[2] })));
    } catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
module.exports = { validateNativeProposals };
