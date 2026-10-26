const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { wrapReviewer } = require("./reviewer-handler.cjs");

const setup = process.env.GH_AW_SETUP_DIR;
const nativeTest = (name, fn) => test(name, { skip: !setup && "Set GH_AW_SETUP_DIR to pinned v0.89.21 actions/setup/js" }, fn);
const main = setup && require(path.join(setup, "add_reviewer.cjs")).main;

function fixture() {
  const calls = [];
  global.context = { eventName: "schedule", repo: { owner: "fixture", repo: "project" }, payload: {} };
  global.core = { info() {}, warning() {}, debug() {}, error() {} };
  global.github = { rest: {
    issues: { get: async () => ({ data: { labels: [{ name: "fixture-label" }] } }) },
    pulls: {
      get: async () => ({ data: { requested_reviewers: [], requested_teams: [] } }),
      listReviews: async () => ({ data: [] }),
      requestReviewers: async (args) => { calls.push(args); return { data: { requested_reviewers: [{ login: "reviewer" }] } }; },
    },
  } };
  return { calls, message: { reviewers: ["reviewer"], pull_request_number: "aw_proposal" },
    map: { aw_proposal: { repo: "fixture/project", number: 2524 } } };
}

nativeTest("native reviewer API receives the actual published number for bare and hash IDs", async () => {
  for (const id of ["aw_proposal", "#aw_proposal", "aw_Proposal", "#AW_Proposal"]) {
    const f = fixture();
    const handler = await wrapReviewer(main)({ max: 1, target: "*", required_labels: ["fixture-label"] });
    const result = await handler({ ...f.message, pull_request_number: id }, f.map);
    assert.equal(result.success, true, result.error);
    assert.equal(f.calls[0].pull_number, 2524);
    assert.deepEqual(f.calls[0].reviewers, ["reviewer"]);
  }
});

nativeTest("installed adapter uses native dependency ordering before resolving reviewer IDs", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-handler-"));
  try {
    fs.cpSync(setup, dir, { recursive: true });
    require("./prepare-reviewer-handler.cjs").prepare(dir);
    const { sortMessageIndicesByTemporaryIdDependencies: sort } = require(path.join(dir, "safe_output_handler_manager.cjs"));
    const f = fixture();
    const messages = [{ type: "add_reviewer", ...f.message, pull_request_number: "#AW_Proposal" },
      { type: "create_pull_request", temporary_id: "aw_proposal" }];
    assert.deepEqual(sort(messages), [1, 0]);
    const installed = require(path.join(dir, "add_reviewer.cjs"));
    const handler = await installed.main({ max: 1, target: "*" });
    assert.equal((await handler(messages[0], f.map)).success, true);
    assert.equal(f.calls[0].pull_number, 2524);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

nativeTest("invalid, old, cross-repository and automation requests never call the reviewer API", async () => {
  for (const mutate of [
    f => { f.message.pull_request_number = 2524; },
    f => { f.map = {}; },
    f => { f.map.aw_proposal.repo = "other/repo"; },
    f => { f.message.repo = "other/repo"; },
    f => { f.message.reviewers = ["CharlieHelps"]; },
    f => { f.message.reviewers = ["CHARLIECREATES"]; },
    f => { f.message.reviewers = ["gumnut-bot[bot]"]; },
    f => { f.message.reviewers = [" gumnut-bot "]; },
    f => { f.message.reviewers = [" copilot "]; },
    f => { f.message.reviewers = [" reviewer "]; },
    f => { f.message.team_reviewers = ["team"]; },
  ]) {
    const f = fixture(); mutate(f);
    const handler = await wrapReviewer(main)({ max: 1, target: "*" });
    assert.equal((await handler(f.message, f.map)).success, false);
    assert.equal(f.calls.length, 0);
  }
});

nativeTest("native review API failure remains a failed output", async () => {
  const f = fixture();
  global.github.rest.pulls.requestReviewers = async () => { throw Error("fixture denied"); };
  const handler = await wrapReviewer(main)({ max: 1, target: "*" });
  assert.equal((await handler(f.message, f.map)).success, false);
});

nativeTest("fixed or triggering native targets cannot override the newly published PR", async () => {
  for (const target of [undefined, "triggering", "99", 99]) {
    const f = fixture();
    await assert.rejects(wrapReviewer(main)({ max: 1, target }), /target configuration/);
    assert.equal(f.calls.length, 0);
  }
});

nativeTest("pinned preparation fails closed on handler or dependency anchor drift", () => {
  for (const name of ["add_reviewer.cjs", "safe_output_handler_manager.cjs"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-drift-"));
    try {
      fs.cpSync(setup, dir, { recursive: true });
      fs.writeFileSync(path.join(dir, name), "// changed pinned helper");
      assert.throws(() => require("./prepare-reviewer-handler.cjs").prepare(dir), /Pinned.*changed/);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});


nativeTest("complete helper drift with intact anchors fails before either write", () => {
  for (const name of ["add_reviewer.cjs", "safe_output_handler_manager.cjs"]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "native-reviewer-drift-"));
    try {
      fs.cpSync(setup, dir, { recursive: true });
      fs.appendFileSync(path.join(dir, name), "\n// intact anchors, changed body\n");
      const before = ["add_reviewer.cjs", "safe_output_handler_manager.cjs"].map(file => fs.readFileSync(path.join(dir, file), "utf8"));
      assert.throws(() => require("./prepare-reviewer-handler.cjs").prepare(dir), /helpers changed/);
      assert.deepEqual(["add_reviewer.cjs", "safe_output_handler_manager.cjs"].map(file => fs.readFileSync(path.join(dir, file), "utf8")), before);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
});

nativeTest("native reviewer accepts multiple eligible humans and repeated handoffs", async () => {
  const f = fixture();
  const handler = await wrapReviewer(main)({ max: 10, target: "*" });
  for (const reviewers of [["reviewer", "maintainer"], ["other"]]) {
    const result = await handler({ ...f.message, reviewers }, f.map);
    assert.equal(result.success, true, result.error);
  }
  assert.deepEqual(f.calls.map(call => call.reviewers), [["reviewer", "maintainer"], ["other"]]);
});
