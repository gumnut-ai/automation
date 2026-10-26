const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
const { prepare, validateProposal } = require("./prepare-reviewer-handler.cjs");
const setup = process.env.GH_AW_SETUP_DIR;
const nativeTest = (name, fn) => test(name, { skip: !setup && "Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js" }, fn);

function output() {
  return { errors: [], items: [
    { type: "create_pull_request", temporary_id: "aw_proposal" },
    { type: "add_reviewer", pull_request_number: "aw_proposal", reviewers: ["maintainer"] },
  ] };
}
function helpers(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "proposal-boundary-"));
  fs.cpSync(setup, dir, { recursive: true });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
function nativeFiles(dir) {
  return ["add_reviewer.cjs", "safe_output_handler_manager.cjs"].map(name =>
    fs.readFileSync(path.join(dir, name), "utf8"));
}
function invalidOutputs() {
  const result = [{}, { errors: [], items: [null] },
    { errors: [], items: [...output().items, { type: "add_comment" }] }];
  for (const mutate of [
    x => x.errors = ["Line 3: Unexpected output type 'report_incomplete'"],
    x => x.errors = ["Line 3: Too many items of type 'create_pull_request'"],
    x => x.errors = "invalid error envelope",
    x => delete x.errors,
    x => x.items.push(x.items[0]),
    x => x.items.push({ ...x.items[0], temporary_id: "#AW_Proposal" }),
    x => delete x.items[0].temporary_id,
    x => x.items[1].pull_request_number = 7,
    x => x.items[1].pull_request_number = "aw_other",
    x => x.items[1].repo = "other/repo",
    x => x.items[0].repo = "other/repo",
    x => x.items[1].reviewers = [],
    x => x.items[1].reviewers = ["maintainer", "copilot"],
    x => x.items[1].reviewers = ["CharlieHelps"],
    x => x.items[1].reviewers = ["someone[BoT]"],
    x => x.items[1].reviewers = ["not/a/login"],
    x => x.items[1].team_reviewers = ["team"],
  ]) { const x = output(); mutate(x); result.push(x); }
  return result;
}

nativeTest("incomplete declarations fail before helpers change or a native write handler runs", async t => {
  const dir = helpers(t), before = nativeFiles(dir);
  let writes = 0;
  for (const declaration of invalidOutputs()) {
    await assert.rejects(async () => {
      prepare(dir, { validateProposal: true, output: declaration, repository: "owner/repo" });
      const { processMessages } = require(path.join(dir, "safe_output_handler_manager.cjs"));
      await processMessages(new Map([["create_pull_request", async () => { writes++; }]]), declaration.items);
    });
    assert.deepEqual(nativeFiles(dir), before);
    assert.equal(writes, 0);
  }
});

nativeTest("completed proposal uses native ordering, temporary map and exactly one write per handler", async t => {
  global.core = { info() {}, warning() {}, error() {}, debug() {} };
  for (const reversed of [false, true]) {
    const dir = helpers(t), declaration = output();
    declaration.items[1].pull_request_number = "#AW_Proposal";
    if (reversed) declaration.items.reverse();
    prepare(dir, { validateProposal: true, output: declaration, repository: "owner/repo" });
    const { processMessages } = require(path.join(dir, "safe_output_handler_manager.cjs"));
    const calls = [];
    const handlers = new Map([
      ["create_pull_request", async () => {
        calls.push("pr");
        return { success: true, number: 7, repo: "owner/repo", temporaryId: "aw_proposal" };
      }],
      ["add_reviewer", async (message, map) => {
        calls.push("review");
        assert.deepEqual(map.aw_proposal, { repo: "owner/repo", number: 7 });
        return { success: true };
      }],
    ]);
    const result = await processMessages(handlers, declaration.items);
    assert.deepEqual(calls, ["pr", "review"]);
    assert(result.results.every(item => item.success));
  }
});

nativeTest("CLI requires readable valid native output and fails before native helper preparation", t => {
  const dir = helpers(t), before = nativeFiles(dir);
  const file = path.join(dir, "output.json");
  for (const content of [undefined, "invalid JSON", JSON.stringify({ items: output().items }), JSON.stringify({ ...output(), errors: ["Invalid extra declaration"] })]) {
    if (content !== undefined) fs.writeFileSync(file, content);
    const env = { PATH: process.env.PATH, RUNNER_TEMP: dir, DAEMON_DELIVERY_VALIDATE_PROPOSAL: "true", GITHUB_REPOSITORY: "owner/repo" };
    if (content !== undefined) env.GH_AW_AGENT_OUTPUT = file;
    const run = spawnSync(process.execPath, [path.join(__dirname, "prepare-reviewer-handler.cjs")], { env, encoding: "utf8" });
    assert.notEqual(run.status, 0);
    assert.deepEqual(nativeFiles(dir), before);
  }
});

nativeTest("CLI prepares the pinned handlers from the exact native output path", t => {
  const dir = helpers(t);
  const actions = path.join(dir, "gh-aw/actions");
  fs.mkdirSync(path.dirname(actions), { recursive: true });
  fs.cpSync(setup, actions, { recursive: true });
  const file = path.join(dir, "output.json");
  fs.writeFileSync(file, JSON.stringify(output()));
  const run = spawnSync(process.execPath, [path.join(__dirname, "prepare-reviewer-handler.cjs")], {
    env: { PATH: process.env.PATH, RUNNER_TEMP: dir, DAEMON_DELIVERY_VALIDATE_PROPOSAL: "true", GITHUB_REPOSITORY: "owner/repo", GH_AW_AGENT_OUTPUT: file },
    encoding: "utf8",
  });
  assert.equal(run.status, 0, run.stderr);
  assert.notDeepEqual(nativeFiles(actions), nativeFiles(dir));
});

nativeTest("preflight accepts either declaration order and an explicit same-repository target", () => {
  const declaration = output();
  declaration.items.forEach(item => item.repo = "owner/repo");
  validateProposal(declaration, "owner/repo");
  declaration.items.reverse();
  validateProposal(declaration, "owner/repo");
});


nativeTest("reviewer-selection failure preserves the useful native proposal", async t => {
  global.core = { info() {}, warning() {}, error() {}, debug() {} };
  const dir = helpers(t), declaration = output();
  declaration.items.pop();
  prepare(dir, { validateProposal: true, output: declaration, repository: "owner/repo" });
  const { processMessages } = require(path.join(dir, "safe_output_handler_manager.cjs"));
  let writes = 0;
  const result = await processMessages(new Map([["create_pull_request", async () => {
    writes++;
    return { success: true, number: 7, repo: "owner/repo", temporaryId: "aw_proposal" };
  }]]), declaration.items);
  assert.equal(writes, 1);
  assert(result.results.every(item => item.success));
});

test("preflight leaves native non-delivery signals and empty output to the agent", () => {
  validateProposal({ errors: [], items: [] }, "owner/repo");
  for (const type of ["noop", "report_incomplete", "missing_tool", "missing_data"]) {
    validateProposal({ errors: [], items: [{ type }] }, "owner/repo");
    validateProposal({ errors: [], items: [...output().items, { type }] }, "owner/repo");
  }
});

nativeTest("multiple proposals and human handoffs use each newly created PR through native ordering", async t => {
  global.core = { info() {}, warning() {}, error() {}, debug() {} };
  global.context = { eventName: "schedule", repo: { owner: "owner", repo: "repo" }, payload: {} };
  for (const reversed of [false, true]) {
    const dir = helpers(t), calls = [];
    global.github = { rest: {
      pulls: {
        get: async () => ({ data: { requested_reviewers: [], requested_teams: [] } }),
        listReviews: async () => ({ data: [] }),
        requestReviewers: async args => {
          calls.push(args);
          return { data: { requested_reviewers: args.reviewers.map(login => ({ login })) } };
        },
      },
    } };
    const declaration = { errors: [], items: [
      { type: "add_reviewer", pull_request_number: "#AW_Second", reviewers: ["second", "third"] },
      { type: "create_pull_request", temporary_id: "aw_first" },
      { type: "add_reviewer", pull_request_number: "aw_first", reviewers: ["first"] },
      { type: "create_pull_request", temporary_id: "aw_second" },
      { type: "add_reviewer", pull_request_number: "aw_first", reviewers: ["fourth"] },
    ] };
    if (reversed) declaration.items.reverse();
    prepare(dir, { validateProposal: true, output: declaration, repository: "owner/repo" });
    const { processMessages } = require(path.join(dir, "safe_output_handler_manager.cjs"));
    const handler = await require(path.join(dir, "add_reviewer.cjs")).main({ target: "*", max: 10 });
    const result = await processMessages(new Map([
      ["create_pull_request", async message => ({ success: true, number: message.temporary_id === "aw_first" ? 7 : 8,
        repo: "owner/repo", temporaryId: message.temporary_id })],
      ["add_reviewer", handler],
    ]), declaration.items);
    assert(result.results.every(item => item.success), JSON.stringify(result.results));
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.find(call => call.reviewers.includes("second")), {
      owner: "owner", repo: "repo", pull_number: 8, reviewers: ["second", "third"],
    });
    for (const login of ["first", "fourth"])
      assert.equal(calls.find(call => call.reviewers.includes(login)).pull_number, 7);
  }
});
