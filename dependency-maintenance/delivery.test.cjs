const { test } = require("node:test");
const assert = require("node:assert/strict");
const { assertTarget, guardPushClient, handoff } = require("./delivery.cjs");
const context = { repo: { owner: "fixture", repo: "project" } };
const repository = "fixture/project";
const sha = "a".repeat(40), next = "b".repeat(40);
const item = { pull_request_number: 12, head_sha: sha, reviewer: "reviewer", action: "assign" };
function pr() {
  return { number: 12, state: "open", user: { id: 49699333, login: "dependabot[bot]", type: "Bot" },
    base: { ref: "main", repo: { full_name: repository } },
    head: { ref: "dependabot/npm/update", sha, repo: { full_name: repository } }, assignees: [] };
}
function fixture() {
  const state = { pr: pr(), requests: [], writes: [], uncertain: false };
  const github = { rest: {
    pulls: {
      get: async () => ({ data: structuredClone(state.pr) }),
      listRequestedReviewers: async () => ({ data: { users: state.requests } }),
      requestReviewers: async ({ reviewers }) => {
        state.writes.push("request_review");
        state.requests.push(...reviewers.map(login => ({ login })));
        if (state.uncertain) throw Error("uncertain review timeout");
      },
    },
    issues: { addAssignees: async ({ assignees }) => {
      state.writes.push("assign");
      state.pr.assignees.push(...assignees.map(login => ({ login })));
      if (state.uncertain) throw Error("uncertain assignment timeout");
    } },
    users: { getByUsername: async () => ({ data: { login: "reviewer", type: "User" } }) },
    repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: "write" } }) },
  } };
  return { state, github };
}

test("rejects wrong identity, forks, closed PRs, other bases and changed heads", () => {
  assert.doesNotThrow(() => assertTarget(pr(), item, context));
  for (const edit of [p => p.user.id++, p => p.user.type = "User", p => p.head.sha = next,
    p => p.head.repo.full_name = "attacker/project", p => p.base.repo.full_name = "other/project",
    p => p.state = "closed", p => p.base.ref = "release", p => p.head.ref = "main"]) {
    const candidate = pr(); edit(candidate);
    assert.throws(() => assertTarget(candidate, item, context));
  }
  const daemon = pr();
  daemon.user = { id: 333470196, login: "gumnut-bot[bot]", type: "Bot" };
  assert.throws(() => assertTarget(daemon, item, context));
  daemon.head.ref = "dependency-maintenance/python";
  assert.doesNotThrow(() => assertTarget(daemon, item, context));
});

test("handoff executes only the agent-selected action and preserves prior humans", async () => {
  for (const action of ["assign", "request_review"]) {
    const { github, state } = fixture();
    state.pr.assignees.push({ login: "other" }); state.requests.push({ login: "other" });
    await handoff({ github, context, item: { ...item, action } });
    assert.deepEqual(state.writes, [action]);
    const users = action === "assign" ? state.pr.assignees : state.requests;
    assert.deepEqual(users.map(x => x.login), ["other", "reviewer"]);
  }
});

test("review history and deduplication remain with the agent", async () => {
  const { github, state } = fixture();
  state.requests.push({ login: "reviewer" });
  await handoff({ github, context, item: { ...item, action: "request_review" } });
  assert.deepEqual(state.writes, ["request_review"]);
});

test("uncertain successful handoff is recovered by readback without retry", async () => {
  for (const action of ["assign", "request_review"]) {
    const { github, state } = fixture();
    state.uncertain = true;
    assert.equal((await handoff({ github, context, item: { ...item, action } })).success, true);
    assert.deepEqual(state.writes, [action]);
  }
});

test("handoff rejects invalid actions, accounts, permissions and stale targets before writing", async () => {
  for (const kind of ["action", "read", "triage", "none", "bot", "automation", "head"]) {
    const { github, state } = fixture();
    const candidate = { ...item };
    if (kind === "action") candidate.action = "approve";
    if (["read", "triage", "none"].includes(kind)) github.rest.repos.getCollaboratorPermissionLevel = async () => ({ data: { permission: kind } });
    if (kind === "bot") github.rest.users.getByUsername = async () => ({ data: { login: "reviewer", type: "Bot" } });
    if (kind === "automation") candidate.reviewer = "charliehelps";
    if (kind === "head") state.pr.head.sha = next;
    await assert.rejects(handoff({ github, context, item: candidate }));
    assert.deepEqual(state.writes, []);
  }
});

test("absent uncertain handoff is not retried, and a changed head invalidates readback", async () => {
  for (const kind of ["absent", "head"]) {
    const { github, state } = fixture();
    github.rest.issues.addAssignees = async () => {
      state.writes.push("assign");
      if (kind === "head") state.pr.head.sha = next;
      throw Error("timeout");
    };
    await assert.rejects(handoff({ github, context, item }));
    assert.deepEqual(state.writes, ["assign"]);
  }
});

test("native guarded client rejects stale lookup and mutation, chains only returned OIDs", async () => {
  const { github, state } = fixture();
  let mutations = 0;
  github.graphql = async () => { mutations++; state.pr.head.sha = mutations === 1 ? next : "c".repeat(40); return { createCommitOnBranch: { commit: { oid: state.pr.head.sha } } }; };
  const guarded = guardPushClient(github, { pull_request_number: 12, base_commit: sha }, context);
  const params = { ...context.repo, pull_number: 12 };
  await guarded.rest.pulls.get(params);
  const query = "mutation { createCommitOnBranch(input: $input) { commit { oid } } }";
  const input = { branch: { repositoryNameWithOwner: repository, branchName: state.pr.head.ref }, expectedHeadOid: sha };
  await guarded.graphql(query, { input });
  await assert.rejects(guarded.graphql(query, { input }));
  await guarded.graphql(query, { input: { ...input, expectedHeadOid: next } });
  assert.equal(mutations, 2);
  await assert.rejects(guarded.rest.pulls.create({}));
  const stale = guardPushClient(github, { pull_request_number: 12, base_commit: sha }, context);
  await assert.rejects(stale.rest.pulls.get(params));
});

test("native mutation cannot adopt a concurrently advanced head", async () => {
  const { github, state } = fixture();
  let mutations = 0;
  github.graphql = async () => { mutations++; };
  const guarded = guardPushClient(github, { pull_request_number: 12, base_commit: sha }, context);
  await guarded.rest.pulls.get({ ...context.repo, pull_number: 12 });
  state.pr.head.sha = next;
  await assert.rejects(guarded.graphql("createCommitOnBranch(input:", { input: { branch: { repositoryNameWithOwner: repository, branchName: state.pr.head.ref }, expectedHeadOid: next } }));
  assert.equal(mutations, 0);
});

test("signed repair chains commits while PR head metadata lags, using native CAS", async () => {
  const { github } = fixture();
  let branchHead = sha, mutations = 0;
  github.graphql = async (_query, { input }) => {
    assert.equal(input.expectedHeadOid, branchHead, "native compare-and-swap");
    branchHead = (++mutations === 1 ? "b" : "c").repeat(40);
    return { createCommitOnBranch: { commit: { oid: branchHead } } };
  };
  const guarded = guardPushClient(github, { pull_request_number: 12, base_commit: sha }, context);
  await guarded.rest.pulls.get({ ...context.repo, pull_number: 12 });
  const input = { branch: { repositoryNameWithOwner: repository, branchName: pr().head.ref } };
  await guarded.graphql("createCommitOnBranch(input:", { input: { ...input, expectedHeadOid: sha } });
  await guarded.graphql("createCommitOnBranch(input:", { input: { ...input, expectedHeadOid: next } });
  assert.equal(mutations, 2);
  branchHead = "d".repeat(40); // A competing writer advances the real branch.
  await assert.rejects(guarded.graphql("createCommitOnBranch(input:", { input: { ...input, expectedHeadOid: "c".repeat(40) } }), /uncertain/);
  assert.equal(mutations, 2);
});

test("uncertain native mutation reads back once and refuses further writes", async () => {
  const { github, state } = fixture();
  let mutations = 0, reads = 0;
  github.rest.pulls.get = async () => { reads++; return { data: structuredClone(state.pr) }; };
  github.graphql = async () => { mutations++; state.pr.head.sha = next; throw Error("timeout"); };
  const guarded = guardPushClient(github, { pull_request_number: 12, base_commit: sha }, context);
  await guarded.rest.pulls.get({ ...context.repo, pull_number: 12 });
  const input = { branch: { repositoryNameWithOwner: repository, branchName: state.pr.head.ref }, expectedHeadOid: sha };
  await assert.rejects(guarded.graphql("createCommitOnBranch(input:", { input }), /uncertain/);
  await assert.rejects(guarded.graphql("createCommitOnBranch(input:", { input }));
  assert.equal(mutations, 1); assert.equal(reads, 3);
});
