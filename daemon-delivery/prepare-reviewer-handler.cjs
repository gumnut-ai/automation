const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const { isHumanReviewer } = require("./human-reviewer.cjs");

// Native handlers apply items independently. Validate the complete proposal
// before any handler can publish; delivery readback cannot undo a write.
function validateProposal(output, repository) {
  if (!Array.isArray(output?.errors) || output.errors.length !== 0)
    throw Error("Native output collection must have no validation errors");
  const items = output?.items;
  if (!Array.isArray(items) || items.some(item => !item || typeof item !== "object"))
    throw Error("Expected native output items");
  const signals = new Set(["noop", "report_incomplete", "missing_tool", "missing_data"]);
  if (items.some(item => !["create_pull_request", "add_reviewer"].includes(item.type) && !signals.has(item.type)))
    throw Error("Unexpected native delivery output type");
  const proposals = items.filter(item => item.type === "create_pull_request");
  const reviews = items.filter(item => item.type === "add_reviewer");
  if ([...proposals, ...reviews].some(item => item.repo && item.repo !== repository))
    throw Error("Proposal and reviewer must target this repository");
  const normalize = id => typeof id === "string" ? id.replace(/^#/, "").toLowerCase() : "";
  const ids = new Set();
  for (const proposal of proposals) {
    const id = normalize(proposal.temporary_id);
    if (!/^aw_[a-z0-9_]{3,12}$/.test(id))
      throw Error("Invalid proposal temporary ID");
    // Native sorting keeps the first producer, while its result map can be
    // overwritten by a later producer. Ambiguous IDs could redirect a review.
    if (ids.has(id)) throw Error("Duplicate proposal temporary ID");
    ids.add(id);
  }
  // Preserve useful PRs when the agent cannot identify a human. Every declared
  // handoff must still bind unambiguously to one of these newly proposed PRs.
  for (const review of reviews) {
    if (!ids.has(normalize(review.pull_request_number)))
      throw Error("Reviewer target must be a proposal's temporary ID");
    if (!Array.isArray(review.reviewers) || review.reviewers.length === 0 ||
        !review.reviewers.every(isHumanReviewer) || review.team_reviewers?.length)
      throw Error("Eligible human reviewers are required");
  }
}

function prepare(actionsDir, { validateProposal: validate = false, output, repository = process.env.GITHUB_REPOSITORY } = {}) {
  if (validate) validateProposal(output, repository);
  const file = path.join(actionsDir, "add_reviewer.cjs");
  const source = fs.readFileSync(file, "utf8");
  const anchor = "module.exports = { main };";
  const managerFile = path.join(actionsDir, "safe_output_handler_manager.cjs");
  const manager = fs.readFileSync(managerFile, "utf8");
  const dependency = 'message.type === "create_issue" ? extractTemporaryIdReferences({ blocked_by: message.blocked_by }) : new Set()';
  // Fail before either write if the complete pinned helpers drift. Anchors
  // alone cannot establish compatibility with the reviewed native version.
  const hash = text => createHash("sha256").update(text).digest("hex");
  if (hash(source) !== "e9a10677c47acbc8f89958815f2ba1b120e9fed9e321523cdad04833f37fc3a1" ||
      hash(manager) !== "e9ee47cb0e09829e006b3226e1eae38d524a281e41934346a63d2a4526eccbf5")
    throw Error("Pinned v0.89.21 reviewer helpers changed");
  if (source.split(anchor).length !== 2 || manager.split(dependency).length !== 2)
    throw Error("Pinned reviewer handler changed");
  const wrapper = path.join(__dirname, "reviewer-handler.cjs");
  fs.writeFileSync(file, source.replace(anchor,
    `module.exports = { main: require(${JSON.stringify(wrapper)}).wrapReviewer(main) };`));
  // Extend the native dependency sort, retaining its stable ordering and map.
  fs.writeFileSync(managerFile, manager.replace(dependency,
    'message.type === "add_reviewer" ? extractTemporaryIdReferences({ pull_request_number: message.pull_request_number }) : ' + dependency));
}

if (require.main === module) {
  const validate = process.env.DAEMON_DELIVERY_VALIDATE_PROPOSAL || "false";
  if (!["true", "false"].includes(validate)) throw Error("validate-proposal must be true or false");
  let output;
  if (validate === "true") {
    if (!process.env.GH_AW_AGENT_OUTPUT) throw Error("Missing native agent output path");
    output = JSON.parse(fs.readFileSync(process.env.GH_AW_AGENT_OUTPUT, "utf8"));
  }
  prepare(path.join(process.env.RUNNER_TEMP, "gh-aw/actions"), {
    validateProposal: validate === "true", output,
  });
}
module.exports = { prepare, validateProposal };
