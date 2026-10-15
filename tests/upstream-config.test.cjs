const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { configuration, MCP, ALLOWED_TOOLS } = require('../claude-review/config.cjs');
const { BUN_IMAGE } = require('../claude-review/runtime/services.cjs');

test('pinned official Action parser preserves shared helper JSON and backend paths', {
  skip: process.env.CLAUDE_REVIEW_RUN_CONTAINER_TESTS !== '1', timeout: 60_000,
}, async () => {
  const upstream = await fs.realpath(process.env.CLAUDE_REVIEW_TRUSTED_ACTION_DIR);
  const config = configuration({ number: '17', repository: 'example/project', sha: 'a'.repeat(40), branch: 'main' });
  const script = `import {parseSdkOptions} from '/upstream/base-action/src/parse-sdk-options.ts'; const {sdkOptions:s}=parseSdkOptions({claudeArgs:await Bun.stdin.text()}); console.log(JSON.stringify({extraArgs:s.extraArgs,model:s.model,maxTurns:s.maxTurns,allowedTools:s.allowedTools}));`;
  const result = await new Promise((resolve, reject) => {
    const child = execFile('docker', ['run', '--rm', '-i', '--network', 'none', '--entrypoint', 'bun',
      '--mount', `type=bind,source=${upstream},target=/upstream,readonly`, BUN_IMAGE, '-e', script],
    { timeout: 45_000, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => error ? reject(new Error(`Pinned parser failed: ${stderr}`)) : resolve(JSON.parse(stdout)));
    child.stdin.on('error', () => {});
    child.stdin.end(config.claude_args);
  });
  assert.deepEqual(JSON.parse(result.extraArgs.agents), require('../claude-review/agents.json'));
  assert.deepEqual(JSON.parse(result.extraArgs['mcp-config']), MCP);
  assert.deepEqual(result.allowedTools, ALLOWED_TOOLS.split(','));
  assert.equal(result.maxTurns, 50);
  assert.equal(result.model, 'claude-opus-5-5');
  assert.ok(config.launcher.endsWith(path.join('claude-review', 'runtime', 'launcher.cjs')));
});
