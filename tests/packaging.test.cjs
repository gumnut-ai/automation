'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const action = name => read(`actions/${name}/action.yml`);
const example = name => read(`examples/consumer/.github/workflows/${name}.yml`);
const { configuration, ACTION_SHA, RUNTIME_IMAGE } = require('../claude-review/config.cjs');
const expr = value => '${{ ' + value + ' }}';

// Exercise the actual composite entry commands with Actions-style environment
// data. Disabled gates must finish without a network request or credentials.
test('packaged dispatch and approval source honor disabled consumer gates', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automation-package-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const event = path.join(dir, 'event.json');
  const output = path.join(dir, 'output');
  fs.writeFileSync(event, JSON.stringify({ repository: { full_name: 'fixture/project', default_branch: 'main' } }));
  fs.writeFileSync(output, '');
  const env = { PATH: process.env.PATH, AUTOMATION_ROOT: root, GH_TOKEN: 'synthetic-unused-token',
    GITHUB_REPOSITORY: 'fixture/project', GITHUB_EVENT_NAME: 'pull_request_target',
    GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output,
    CLAUDE_REVIEW_ENABLED: 'false', PR_APPROVAL_MODE: '', OPERATION: 'source' };
  for (const name of ['claude-dispatch', 'pr-approval']) {
    const command = action(name).match(/^      run: (node .+)$/m)?.[1];
    assert.ok(command, `${name} must expose its packaged Node entrypoint`);
    execFileSync('bash', ['-c', command], { env, encoding: 'utf8' });
  }
  assert.match(fs.readFileSync(output, 'utf8'), /eligible=false/);
  const command = action('pr-approval').match(/^      run: (node .+)$/m)[1];
  assert.notEqual(spawnSync('bash', ['-c', command], { env: { ...env, OPERATION: 'invalid' } }).status, 0);
});

test('prepare outputs resolve to the shared package while retaining caller policy', () => {
  const values = configuration({ number: '42', repository: 'fixture/project', sha: 'a'.repeat(40), branch: 'main' });
  assert.equal(values.launcher, path.join(root, 'claude-review/runtime/launcher.cjs'));
  fs.accessSync(values.launcher, fs.constants.X_OK);
  assert.match(values.prompt, /\.github\/claude-review\/INSTRUCTIONS\.md/);
  assert.match(values.prompt, new RegExp('a'.repeat(40)));
  const prepare = action('claude-prepare');
  for (const name of ['eligible', 'owner', 'repo', 'pr_number', 'check_id', 'launcher', 'claude_args', 'prompt']) {
    assert.match(prepare, new RegExp(`^  ${name}:`, 'm'));
  }
  assert.equal(require('../claude-review/runtime/image.cjs'), RUNTIME_IMAGE);
  assert.match(prepare, /require\(process.env.AUTOMATION_ROOT \+ "\/claude-review\/runtime\/image.cjs"\)/);
});

test('consumer review directly invokes pinned official Action with admitted configuration and OAuth', () => {
  const workflow = example('claude-review');
  assert.ok(workflow.includes(`uses: anthropics/claude-code-action@${ACTION_SHA}`));
  for (const [input, output] of [['path_to_claude_code_executable', 'launcher'], ['prompt', 'prompt'], ['claude_args', 'claude_args']]) {
    assert.ok(workflow.includes(`${input}: ${expr(`steps.prepare.outputs.${output}`)}`));
  }
  assert.ok(workflow.includes(`claude_code_oauth_token: ${expr('secrets.CLAUDE_CODE_OAUTH_TOKEN')}`));
  assert.doesNotMatch(workflow, /anthropic_api_key|ANTHROPIC_API_KEY|publish-token/);
  assert.ok(workflow.includes("github.event.pull_request.head.repo.full_name == github.repository"));
  assert.ok(workflow.includes("github.event.pull_request.base.ref == github.event.repository.default_branch"));
  assert.ok(workflow.includes("github.ref == format('refs/heads/{0}', github.event.repository.default_branch)"));
  assert.ok(workflow.includes("if: steps.prepare.outputs.eligible == 'true'"));
  const references = ['claude-review', 'pr-approval-request', 'pr-approval-coordinator']
    .flatMap(name => [...example(name).matchAll(/gumnut-ai\/automation\/actions\/[\w-]+@([a-f0-9]{40})/g)]);
  assert.equal(references.length, 7);
  const pins = new Set(references.map(match => match[1]));
  assert.equal(pins.size, 1, 'Upgrade every example action together');
  const [pin] = pins;
  for (const name of ['claude-dispatch', 'claude-prepare', 'claude-report']) {
    assert.ok(workflow.includes(`gumnut-ai/automation/actions/${name}@${pin}`));
  }
  assert.match(workflow, /if: always\(\)\n        uses: gumnut-ai\/automation\/actions\/claude-report/);
  const report = read('actions/claude-report/action.yml');
  assert.match(report, /- name: Report safe failure category\n      id: diagnostic\n/);
  assert.ok(report.includes("inputs.job-status == 'failure'"));
  assert.ok(action('claude-prepare').includes('node \"$AUTOMATION_ROOT/claude-review/runtime/services.cjs\"'));
  assert.ok(report.includes(`CLAUDE_FAILURE_CATEGORY: ${expr('steps.diagnostic.outputs.category')}`));
});

test('approval example keeps native admission receipt and separates protected publication', () => {
  const request = example('pr-approval-request');
  assert.match(request, /name: Approval request/);
  assert.match(request, /name: Admitted approval request/);
  assert.ok(request.includes('ref: ' + expr('github.event.repository.default_branch')));
  const workflow = example('pr-approval-coordinator');
  const [assessment, publication] = workflow.split(/^  publish:\n/m);
  assert.ok(publication);
  assert.doesNotMatch(assessment + request, /secrets\.|publish-token:|create-github-app-token/);
  assert.match(publication, /environment: pr-approval-publisher/);
  assert.match(publication, /vars\.PR_APPROVAL_MODE == 'publish'/);
  assert.match(publication, /needs\.assess\.outputs\.actionable == 'true'/);
  assert.match(publication, /operation: publish/);
  assert.ok(publication.includes('publish-token: ' + expr('steps.app.outputs.token')));
});

test('runnable workflows and composites pin external actions and never persist checkout credentials', () => {
  const files = ['.github/workflows/ci.yml', ...['claude-review', 'pr-approval-request', 'pr-approval-coordinator'].map(name => `examples/consumer/.github/workflows/${name}.yml`),
    ...['claude-dispatch', 'claude-prepare', 'claude-report', 'pr-approval', 'codex-runtime'].map(name => `actions/${name}/action.yml`)];
  for (const file of files) {
    const text = read(file);
    for (const match of text.matchAll(/^\s+(?:- )?uses: ([^\s#]+)/gm)) {
      assert.match(match[1], /^[\w.-]+\/[\w./-]+@[a-f0-9]{40}$/, file);
    }
    const checkouts = [...text.matchAll(/uses: actions\/checkout@/g)].length;
    assert.equal([...text.matchAll(/persist-credentials: false/g)].length, checkouts, file);
  }
});

test('CI is read-only and provider-free and exercises the pinned real backend with dummy fixtures', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /permissions:\n  contents: read\n/);
  assert.doesNotMatch(ci, /secrets\.|id-token:|: write|pull_request_target:|workflow_run:/);
  assert.match(ci, /run: npm test/);
  assert.match(ci, /docker build --tag .+ claude-review\/runtime/);
  assert.match(ci, /node claude-review\/runtime\/services\.cjs/);
  assert.ok(ci.includes(`ref: ${ACTION_SHA}`));
  assert.match(ci, /\.BUN_IMAGE/);
  assert.match(ci, /install --frozen-lockfile --ignore-scripts --production/);
  assert.match(ci, /CLAUDE_REVIEW_RUN_CONTAINER_TESTS: '1'/);
  assert.match(ci, /CLAUDE_REVIEW_TRUSTED_ACTION_DIR:/);
  assert.match(ci, /node --test [^\n]*claude-review\/runtime\/integration.test.cjs/);
});
