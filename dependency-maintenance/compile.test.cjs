const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { correctWorkflow, correctOutputTransport } = require('./compile.cjs');

const setup = 'c35393777e5604a63721d09512263b1383301d4f';
const actionSha = 'a'.repeat(40);
const images = {
  agent: `ghcr.io/github/gh-aw-firewall/agent:0.28.25@sha256:${'1'.repeat(64)}`,
  apiProxy: `ghcr.io/github/gh-aw-firewall/api-proxy:0.28.25@sha256:${'2'.repeat(64)}`,
  squid: `ghcr.io/github/gh-aw-firewall/squid:0.28.25@sha256:${'3'.repeat(64)}`,
};
const imageSource = Object.entries(images).map(([key, value]) => `      ${key}: ${value}`).join('\n');
const source = `---
on:
  workflow_dispatch:
  permissions:
    contents: read
    actions: read
engine:
  id: codex
  version: "0.156.1"
sandbox:
  agent:
    images:
${imageSource}
safe-outputs:
  environment: fixture-publisher
  github-app:
    owner: fixture
steps:
  - uses: fixture/action@${actionSha} # Reviewed release label
  - uses: fixture/bare@${actionSha} # Preserved bare-ref label
  - uses: fixture/guessed@${actionSha} # Authoritative source label
---
Leave this caller policy and its annotations intact.
`;
const token = `      - name: Generate GitHub App token
        id: safe-outputs-app-token
        uses: actions/create-github-app-token@${actionSha}
        with:
          permission-contents: write
          permission-pull-requests: write
      - name: Publish
        run: echo fixture
`;
const extra = `  unrelated-job:
    environment: separate-fixture-environment
    steps:
      - run: echo '${JSON.stringify({ container: { imageTag: '0.28.25' } })}'
`;
const validation = { push_to_pull_request_branch: { defaultMax: 1, fields: {
  branch: { type: 'string' }, message: { type: 'string', required: true }, pull_request_number: { issueOrPRNumber: true }, repo: { type: 'string' },
} } };
const transport = `      - name: Setup safe outputs tools
        env:
          GH_AW_SAFE_OUTPUTS_CONFIG: ${JSON.stringify(JSON.stringify({ push_to_pull_request_branch: { max: 1 }, handoff_dependency_pr: { inputs: { action: { type: 'string' } } } }))}
          GH_AW_VALIDATION_JSON: |
${JSON.stringify(validation, null, 2).split('\n').map(line => `            ${line}`).join('\n')}
      - name: Ingest agent output
        with:
          script: |
            const { main } = require(path.join(actionsDir, 'collect_ndjson_output.cjs'));
            await main();
`;
const raw = `# gh-aw-manifest: {"compiler_version":"v0.89.21","repo":"github/gh-aw/actions/setup","sha":"${setup}","version":"${setup}"}
jobs:
  pre_activation:
    environment: fixture-publisher
    permissions:
      actions: read
      contents: read
    steps:
      - run: echo admission
  safe_outputs:
    if: needs.agent.result == 'success'
    environment: fixture-publisher
    steps:
${token}  conclusion:
    environment: fixture-publisher
    steps:
${token}  agent:
    environment: fixture-publisher
    permissions:
      contents: read
    steps:
      - uses: fixture/action@${actionSha} # ${actionSha}
      - uses: fixture/bare@${actionSha}
      - uses: fixture/guessed@${actionSha} # Native guessed label
      - uses: github/gh-aw/actions/setup@${setup} # ${setup}
${transport}
  detection:
    environment: fixture-publisher
    steps:
      - run: docker pull ${Object.values(images).map(image => image.split('@')[0]).join(' ')}
      - run: printf '%s\\n' '${JSON.stringify({ container: { imageTag: '0.28.25' } })}' > /tmp/awf-config.json
${extra}`;

function job(text, name) {
  const start = text.indexOf(`  ${name}:\n`);
  // Select full blocks by top-level job indentation, not nested fields.
  return text.slice(start).split(/\n(?=  [\w-]+:\n)/)[0];
}

test('validates native admission and corrects images/environments while preserving caller content', () => {
  const result = correctWorkflow(source, raw);
  assert.equal(job(result, 'pre_activation'), `  pre_activation:
    permissions:
      actions: read
      contents: read
    steps:
      - run: echo admission`);
  for (const name of ['safe_outputs', 'conclusion']) {
    assert.equal(job(result, name), `  ${name}:\n${name === 'safe_outputs' ? "    if: needs.agent.result == 'success'\n" : ''}    environment: fixture-publisher\n    steps:\n${token.replace('          permission-pull-requests: write\n', '          permission-pull-requests: write\n          permission-issues: read\n').trimEnd()}`);
  }
  const detector = job(result, 'detection').split('\n');
  assert.equal(detector[2], `      - run: docker pull ${Object.values(images).join(' ')}`);
  assert.deepEqual(JSON.parse(detector[3].match(/'({.*})' > /)[1]), { container: { images } });
  assert.equal(job(result, 'unrelated-job'), extra);
  assert.equal(job(result, 'agent').trimEnd(), `  agent:
    permissions:
      contents: read
    steps:
      - uses: fixture/action@${actionSha} # Reviewed release label
      - uses: fixture/bare@${actionSha} # Preserved bare-ref label
      - uses: fixture/guessed@${actionSha} # Authoritative source label
      - uses: github/gh-aw/actions/setup@${setup} # v0.89.21
${correctOutputTransport(transport).trimEnd()}`);
  assert.deepEqual(JSON.parse(result.split('\n')[0].slice('# gh-aw-manifest: '.length)), {
    compiler_version: 'v0.89.21', repo: 'github/gh-aw/actions/setup', sha: setup, version: 'v0.89.21',
  });
});

test('transport correction declares only the native baseline and lifts the native script transport ceiling', () => {
  const corrected = correctOutputTransport(transport);
  const config = JSON.parse(JSON.parse(corrected.match(/GH_AW_SAFE_OUTPUTS_CONFIG: (.+)/)[1]));
  assert.equal(config.handoff_dependency_pr.max, 100);
  assert.deepEqual(config.handoff_dependency_pr.inputs, { action: { type: 'string' } });
  assert.equal(config.push_to_pull_request_branch.max, 1);
  const rules = JSON.parse(corrected.match(/GH_AW_VALIDATION_JSON: \|\n([\s\S]*?)      - name:/)[1].replace(/^            /gm, ''));
  assert.deepEqual(rules.push_to_pull_request_branch.fields.base_commit, {
    type: 'string', minLength: 40, maxLength: 40, pattern: '^[a-fA-F0-9]{40}$',
  });
  assert.match(corrected, /collected.errors.length\) core.setFailed/);
});

test('uses each caller environment and digest pins, including already pinned detector pulls', () => {
  const callerSource = source.replaceAll('fixture-publisher', 'other-publisher');
  const callerRaw = raw.replaceAll('fixture-publisher', 'other-publisher').replace(Object.values(images)[0].split('@')[0], images.agent);
  const result = correctWorkflow(callerSource, callerRaw);
  assert.equal(result.split('    environment: other-publisher\n').length - 1, 2);
  assert.ok(job(result, 'detection').includes(`docker pull ${Object.values(images).join(' ')}`));
  assert.equal(job(result, 'unrelated-job'), extra);
});

for (const [name, change, error] of [
  ['missing admission', text => text.replace('  pre_activation:\n', '  renamed_admission:\n'), /expected generated pre_activation/],
  ['admission permission drift', text => text.replace('      actions: read', '      actions: write'), /expected generated admission/],
  ['unexpected admission scope', text => text.replace('      actions: read', '      actions: read\n      issues: write'), /expected generated admission/],
  ['missing detector', text => text.replace('  detection:\n', '  renamed_detection:\n'), /expected generated detection/],
  ['detector configuration drift', text => text.replace('"imageTag":"0.28.25"', '"imageTag":"new-version"'), /detector configuration correction point drift/],
  ['detector image drift', text => text.replace(images.agent.split('@')[0], 'fixture/unexpected-image'), /detector image correction point drift/],
  ['token permission drift', text => text.replace('permission-pull-requests: write', 'permission-pull-requests: read'), /publisher permissions drift/],
  ['excess Issues permission', text => text.replace('permission-pull-requests: write\n', 'permission-pull-requests: write\n          permission-issues: write\n'), /publisher Issues permission drift/],
  ['token count drift', text => text.replace(token, '      - run: echo no-token\n'), /expected two publisher token steps/],
  ['duplicate publisher token', text => text.replace(token, token + token), /expected two publisher token steps/],
  ['publisher token in another job', text => text.replace(extra, extra + token), /publisher token job drift/],
  ['missing jobs section', text => text.replace('jobs:\n', 'renamed-jobs:\n'), /expected generated jobs section/],
  ['publisher environment drift', text => text.replace('    environment: fixture-publisher\n    steps:\n' + token, '    environment: unexpected\n    steps:\n' + token), /publisher environment drift/],
  ['publisher success gate drift', text => text.replace("if: needs.agent.result == 'success'", 'if: always()'), /requires successful agent collection/],
  ['collector drift', text => text.replace('collect_ndjson_output.cjs', 'other_collector.cjs'), /transport correction point drift/],
  ['duplicate transport config', text => text.replace(transport, transport + transport), /transport correction point drift/],
  ['validation field drift', text => text.replace('"branch": {', '"renamed_branch": {'), /repair validation drift/],
]) test(`rejects ${name}`, () => assert.throws(() => correctWorkflow(source, change(raw)), error));

for (const [name, changed] of [
  ['unpinned image', source.replace(/@sha256:1{64}/, '')],
  ['duplicate image entry', source.replace(imageSource, imageSource + `\n      agent: ${images.agent}`)],
  ['missing admission permissions', source.replace('  permissions:\n    contents: read\n    actions: read\n', '')],
  ['unsafe admission permissions', source.replace('    actions: read', '    actions: write')],
  ['missing environment', source.replace('  environment: fixture-publisher\n', '')],
  ['object environment', source.replace('  environment: fixture-publisher', '  environment:\n    name: fixture-publisher')],
]) test(`rejects caller ${name}`, () => assert.throws(() => correctWorkflow(changed, raw)));

test('CLI invokes the fixed workflow from consumer cwd and writes only the corrected lock', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'dependency-compiler-'));
  try {
    const workflows = path.join(temp, '.github/workflows');
    fs.mkdirSync(workflows, { recursive: true });
    fs.writeFileSync(path.join(workflows, 'dependency-maintenance.md'), source);
    fs.writeFileSync(path.join(workflows, 'other.lock.yml'), 'caller-owned\n');
    fs.writeFileSync(path.join(temp, 'native.yml'), raw);
    const compiler = path.join(temp, 'fixture compiler.cjs');
    fs.writeFileSync(compiler, `#!${process.execPath}\nconst fs = require('node:fs'); fs.writeFileSync('arguments.json', JSON.stringify(process.argv.slice(2))); fs.copyFileSync('native.yml', '.github/workflows/dependency-maintenance.lock.yml');\n`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [path.join(__dirname, 'compile.cjs'), compiler], { cwd: temp, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(temp, 'arguments.json'))), ['compile', 'dependency-maintenance', '--action-tag', setup, '--no-check-update']);
    assert.equal(fs.readFileSync(path.join(workflows, 'dependency-maintenance.lock.yml'), 'utf8'), correctWorkflow(source, raw));
    assert.equal(fs.readFileSync(path.join(workflows, 'dependency-maintenance.md'), 'utf8'), source);
    assert.equal(fs.readFileSync(path.join(workflows, 'other.lock.yml'), 'utf8'), 'caller-owned\n');
    fs.writeFileSync(path.join(temp, 'native.yml'), raw.replace('"imageTag":"0.28.25"', '"newImageFormat":true'));
    const drift = spawnSync(process.execPath, [path.join(__dirname, 'compile.cjs'), compiler], { cwd: temp, encoding: 'utf8' });
    assert.notEqual(drift.status, 0);
    assert.equal(fs.readFileSync(path.join(workflows, 'dependency-maintenance.lock.yml'), 'utf8'), raw.replace('"imageTag":"0.28.25"', '"newImageFormat":true'));
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
