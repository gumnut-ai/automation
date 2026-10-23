const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { correctDetectorImages, normalizeActionReferences, correctPublisherIssuesRead } = require('./gh-aw-v0.89.21.cjs');

const setup = 'c35393777e5604a63721d09512263b1383301d4f';
const sha = 'a'.repeat(40);
const images = {
  agent: `ghcr.io/github/gh-aw-firewall/agent:0.28.25@sha256:${'4'.repeat(64)}`,
  apiProxy: `ghcr.io/github/gh-aw-firewall/api-proxy:0.28.25@sha256:${'5'.repeat(64)}`,
  squid: `ghcr.io/github/gh-aw-firewall/squid:0.28.25@sha256:${'6'.repeat(64)}`,
};
const source = `---
engine:
  id: codex
  version: "0.156.1"
sandbox:
  agent:
    images:
${Object.entries(images).map(([key, image]) => `      ${key}: ${image}`).join('\n')}
steps:
  - uses: fixture/action@${sha} # Reviewed fixture
---
Caller policy.
`;
const token = `      - name: Generate GitHub App token
        id: safe-outputs-app-token
        uses: actions/create-github-app-token@${sha}
        with:
          permission-contents: write
          permission-pull-requests: write
      - name: Publish
        run: echo fixture
`;
const unrelated = `  unrelated:
    permissions:
      contents: read
    steps:
      - run: echo '${JSON.stringify({ container: { imageTag: '0.28.25' } })}'
`;
const raw = `# gh-aw-manifest: {"compiler_version":"v0.89.21","repo":"github/gh-aw/actions/setup","sha":"${setup}","version":"${setup}"}
#   - github/gh-aw/actions/setup@${setup} # ${setup}
#   - github/gh-aw/actions/setup@${setup} # ${setup}
jobs:
  agent:
    steps:
      - uses: github/gh-aw/actions/setup@${setup} # native guessed label
      - uses: fixture/action@${sha} # native guessed label
      - run: codex --version
  detection:
    steps:
      - run: docker pull ${Object.values(images).map(image => image.split('@')[0]).join(' ')}
      - run: printf '%s\\n' '${JSON.stringify({ container: { imageTag: '0.28.25' }, callerField: 'preserved' })}' > /tmp/awf-config.json
  safe_outputs:
    steps:
${token}  conclusion:
    steps:
${token}${unrelated}`;

test('selected caller digests cover only detector pulls and configuration', () => {
  const result = correctDetectorImages(source, raw);
  assert.ok(result.endsWith(unrelated));
  for (const image of Object.values(images)) assert.equal(result.split(image).length - 1, 2);
  const config = JSON.parse(result.match(/'({.*})' > \/tmp\/awf-config\.json/)[1]);
  assert.deepEqual(config, { container: { images }, callerField: 'preserved' });
  assert.equal(correctDetectorImages(source, result), result);
});

test('normalization retains source annotations, engine contract and one setup summary', () => {
  const result = normalizeActionReferences(source, raw);
  assert.ok(result.includes(`uses: fixture/action@${sha} # Reviewed fixture`));
  assert.ok(result.includes(`uses: github/gh-aw/actions/setup@${setup} # v0.89.21`));
  assert.equal(result.split(`#   - github/gh-aw/actions/setup@${setup} # v0.89.21`).length - 1, 1);
  assert.ok(result.includes('"version":"v0.89.21"'));
  assert.ok(result.endsWith(unrelated));
  assert.equal(normalizeActionReferences(source, result), result);
  assert.equal(require('./codex-runtime/package.json').dependencies['@openai/codex'], '0.156.1');
  assert.match(source, /engine:\n  id: codex\n  version: "0\.156\.1"/);
  const action = fs.readFileSync(path.join(__dirname, '../actions/codex-runtime/action.yml'), 'utf8');
  assert.doesNotMatch(action, /^inputs:/m, 'version selection remains the reviewed lock');
});

test('publisher correction adds only Issues read and preserves caller/native scopes', () => {
  const result = correctPublisherIssuesRead(source, raw);
  assert.equal(result.split('          permission-issues: read\n').length - 1, 2);
  assert.equal(result.replaceAll('          permission-issues: read\n', ''), raw);
  assert.equal(correctPublisherIssuesRead(source, result), result);
});

for (const [name, input, operation, error] of [
  ['compiler drift', raw.replace('"compiler_version":"v0.89.21"', '"compiler_version":"v1.0.0"'), correctDetectorImages, /metadata/],
  ['setup drift', raw.replace(`uses: github/gh-aw/actions/setup@${setup}`, `uses: github/gh-aw/actions/setup@${sha}`), normalizeActionReferences, /SHA drift/],
  ['missing detector job', raw.replace('  detection:\n', '  unexpected:\n'), correctDetectorImages, /detection job/],
  ['duplicate detector job', raw + '  detection:\n    steps: []\n', correctDetectorImages, /detection job/],
  ['detector image drift', raw.replace(images.agent.split('@')[0], 'fixture/changed-image'), correctDetectorImages, /image correction point/],
  ['detector config drift', raw.replace('"imageTag":"0.28.25","', '"imageTag":"unknown","').replace('"imageTag":"0.28.25"}', '"imageTag":"unknown"}'), correctDetectorImages, /configuration correction point/],
  ['missing config output', raw.replace(' > /tmp/awf-config.json', ''), correctDetectorImages, /configuration correction point/],
  ['unsafe PR scope', raw.replace('permission-pull-requests: write', 'permission-pull-requests: read'), correctPublisherIssuesRead, /publisher permissions drift/],
  ['unsafe Issues scope', raw.replace('permission-pull-requests: write\n', 'permission-pull-requests: write\n          permission-issues: write\n'), correctPublisherIssuesRead, /Issues permission drift/],
  ['duplicate Issues scope', raw.replace('permission-pull-requests: write\n', 'permission-pull-requests: write\n          permission-issues: read\n          permission-issues: read\n'), correctPublisherIssuesRead, /Issues permission drift/],
  ['missing publisher', raw.replace('  conclusion:\n', '  unexpected:\n'), correctPublisherIssuesRead, /conclusion job/],
]) test(`rejects ${name}`, () => assert.throws(() => operation(source, input), error));

test('file CLI writes only after every selected correction succeeds', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'native-corrections-'));
  try {
    const policy = path.join(dir, 'source.md');
    const lock = path.join(dir, 'workflow.lock.yml');
    fs.writeFileSync(policy, source);
    fs.writeFileSync(lock, raw);
    const script = path.join(__dirname, 'gh-aw-v0.89.21.cjs');
    const result = spawnSync(process.execPath, [script, policy, lock, 'correctDetectorImages', 'normalizeActionReferences', 'correctPublisherIssuesRead'], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(lock, 'utf8'), correctPublisherIssuesRead(source, normalizeActionReferences(source, correctDetectorImages(source, raw))));
    const drift = raw.replace('permission-pull-requests: write', 'permission-pull-requests: read');
    fs.writeFileSync(lock, drift);
    assert.notEqual(spawnSync(process.execPath, [script, policy, lock, 'correctDetectorImages', 'correctPublisherIssuesRead']).status, 0);
    assert.equal(fs.readFileSync(lock, 'utf8'), drift);
    assert.equal(fs.readFileSync(policy, 'utf8'), source);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
