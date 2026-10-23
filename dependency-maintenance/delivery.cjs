const SHA = /^[a-f0-9]{40}$/i;
const PREFIX = "dependency-maintenance/";
const { isHumanReviewer } = require("./human-reviewer.cjs");

function eligibleAuthor(pr) {
  const user = pr.user;
  return user?.type === "Bot" && (
    (user.id === 49699333 && user.login === "dependabot[bot]") ||
    (user.id === 29139614 && user.login === "renovate[bot]") ||
    (user.id === 333470196 && user.login === "gumnut-bot[bot]" && pr.head?.ref?.startsWith(PREFIX))
  );
}

function assertEligibleTarget(pr, item, context) {
  const repository = `${context.repo.owner}/${context.repo.repo}`;
  if (!Number.isSafeInteger(item.pull_request_number) || item.pull_request_number <= 0 ||
      (item.repo && item.repo !== repository) ||
      pr.number !== item.pull_request_number || !eligibleAuthor(pr) || pr.state !== "open" ||
      pr.base?.ref !== "main" || pr.base?.repo?.full_name !== repository ||
      pr.head?.repo?.full_name !== repository || !pr.head.ref || pr.head.ref === "main")
    throw Error("Dependency PR target is no longer eligible");
}

function assertTarget(pr, item, context, expected = item.head_sha || item.base_commit) {
  assertEligibleTarget(pr, item, context);
  if (!SHA.test(expected || "") || pr.head.sha !== expected)
    throw Error("Dependency PR captured head is no longer eligible");
}

// The native publisher still applies bundles and creates signed commits. Guard
// its actual metadata read and compare-and-swap input, not an earlier snapshot.
function guardPushClient(client, item, context) {
  // Native repair outputs retain the tool's numeric-string PR form.
  if (typeof item.pull_request_number === "string" && /^[1-9][0-9]*$/.test(item.pull_request_number))
    item = { ...item, pull_request_number: Number(item.pull_request_number) };
  let branch;
  let expected = item.base_commit;
  let uncertain = false;
  const pulls = new Proxy(client.rest.pulls, { get(target, key) {
    if (key === "get") return async params => {
      if (params.owner !== context.repo.owner || params.repo !== context.repo.repo || params.pull_number !== item.pull_request_number)
        throw Error("Unexpected dependency PR lookup");
      const response = await target.get(params);
      assertTarget(response.data, item, context, expected);
      branch = response.data.head.ref;
      return response;
    };
    if (key === "create") return async () => { throw Error("Replacement PR publication is disabled"); };
    return target[key];
  } });
  return new Proxy(client, { get(target, key) {
    if (key === "rest") return { ...target.rest, pulls };
    if (key === "graphql") return async (query, variables) => {
      const input = variables?.input;
      if (uncertain || !branch || !query.includes("createCommitOnBranch(input:") ||
          input?.branch?.repositoryNameWithOwner !== `${context.repo.owner}/${context.repo.repo}` ||
          input.branch.branchName !== branch || input.expectedHeadOid !== expected)
        throw Error("Stale or unsupported dependency branch mutation");
      // Recheck identity and state immediately before each native mutation.
      const live = await target.rest.pulls.get({ ...context.repo, pull_number: item.pull_request_number });
      assertEligibleTarget(live.data, item, context);
      if (live.data.head.ref !== branch) throw Error("Dependency PR branch changed");
      // PR head metadata can lag a successful mutation. The native GraphQL
      // expectedHeadOid is the atomic authority for every commit in the chain.
      uncertain = true;
      let result;
      try { result = await target.graphql(query, variables); }
      catch {
        // Native transient retry must not repeat an uncertain mutation. Record
        // the observed head, but leave this handler closed even if unchanged.
        let observed = "unavailable";
        try { observed = (await target.rest.pulls.get({ ...context.repo, pull_number: item.pull_request_number })).data.head.sha; } catch {}
        throw Error(`Dependency branch mutation outcome uncertain; observed head ${observed}; inspect before another run`);
      }
      const oid = result?.createCommitOnBranch?.commit?.oid;
      if (!SHA.test(oid || "")) throw Error("Native branch mutation returned no commit SHA; read back before another run");
      expected = oid;
      uncertain = false;
      return result;
    };
    return target[key];
  } });
}

function validateHandoff(item) {
  if (!Number.isSafeInteger(item.pull_request_number) || item.pull_request_number <= 0 ||
      !SHA.test(item.head_sha || "") || typeof item.reviewer !== "string" ||
      !/^[a-zA-Z0-9-]+$/.test(item.reviewer) || !isHumanReviewer(item.reviewer) ||
      !["assign", "request_review"].includes(item.action))
    throw Error("Expected a PR number, exact head SHA, human login and permitted handoff action");
}

async function handoff({ github, context, item }) {
  validateHandoff(item);
  const params = { ...context.repo, pull_number: item.pull_request_number };
  const readTarget = async () => {
    const { data: pr } = await github.rest.pulls.get(params);
    assertTarget(pr, item, context);
    return pr;
  };
  const { data: person } = await github.rest.users.getByUsername({ username: item.reviewer });
  if (person.type !== "User" || person.login.toLowerCase() !== item.reviewer.toLowerCase())
    throw Error("Reviewer must be a human GitHub account");
  const { data: access } = await github.rest.repos.getCollaboratorPermissionLevel({ ...context.repo, username: item.reviewer });
  if (!["write", "maintain", "admin"].includes(access.permission))
    throw Error("Reviewer must have repository write access");
  const login = item.reviewer.toLowerCase();
  await readTarget();
  // The agent selects a missing action. Execute it once, then read back even
  // after an uncertain response; never retry or decide review policy here.
  let failure;
  try {
    if (item.action === "assign")
      await github.rest.issues.addAssignees({ ...context.repo, issue_number: item.pull_request_number, assignees: [item.reviewer] });
    else await github.rest.pulls.requestReviewers({ ...params, reviewers: [item.reviewer] });
  } catch (error) { failure = error; }
  const final = await readTarget();
  const users = item.action === "assign" ? final.assignees :
    (await github.rest.pulls.listRequestedReviewers(params)).data.users;
  if (!users?.some(user => user.login.toLowerCase() === login))
    throw Error(`Incomplete dependency PR handoff${failure ? `: ${failure.message}` : ""}`);
  return { success: true, number: item.pull_request_number, head_sha: item.head_sha, reviewer: item.reviewer, action: item.action };
}

module.exports = { assertTarget, eligibleAuthor, guardPushClient, handoff };
