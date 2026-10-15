'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');

// Use the MCP SDK already pinned by the official Action. Like its inline
// backend, this runs in a credentialed Bun sidecar, outside the agent.
function summaryPublisher(env, request = fetch, redact = value => value) {
  const owner = env.REPO_OWNER;
  const repo = env.REPO_NAME;
  const number = env.PR_NUMBER;
  if (!/^[A-Za-z0-9-]+$/.test(owner || '') || !/^[A-Za-z0-9_.-]+$/.test(repo || '') ||
      !/^[1-9][0-9]*$/.test(number || '') || !env.GITHUB_TOKEN) throw new Error('Review summary identity unavailable');
  const url = `${env.GITHUB_API_URL || 'https://api.github.com'}/repos/${owner}/${repo}/issues/${number}/comments`;
  return async ({ body }) => {
    try {
      if (typeof body !== 'string' || !body.trim() || body.length > 65536) throw new Error();
      const response = await request(url, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: redact(body) }),
      });
      if (!response.ok) throw new Error();
      const { id, html_url } = await response.json();
      return { content: [{ type: 'text', text: JSON.stringify({ id, html_url }) }] };
    } catch {
      // Do not echo response bodies, headers or exception text containing keys.
      return { isError: true, content: [{ type: 'text', text: 'Review summary publication failed; inspect the PR before retrying.' }] };
    }
  };
}

async function main() {
  const actionDir = process.env.GITHUB_ACTION_PATH;
  const upstream = createRequire(path.join(actionDir, 'package.json'));
  const { McpServer } = upstream('@modelcontextprotocol/sdk/server/mcp.js');
  const { StdioServerTransport } = upstream('@modelcontextprotocol/sdk/server/stdio.js');
  const { z } = upstream('zod');
  // Preserve the coordinator's HTML verdict marker. The official comment
  // server calls sanitizeContent, which strips it; reuse only secret redaction.
  const { redactSecrets } = await import(path.join(actionDir, 'src/github/utils/sanitizer.ts'));
  const server = new McpServer({ name: 'PR review summary', version: '1.0.0' });
  server.tool('add_review_summary', 'Post the final summary to the admitted pull request.',
    { body: z.string().min(1).max(65536) }, summaryPublisher(process.env, fetch, redactSecrets));
  await server.connect(new StdioServerTransport());
}

if (require.main === module) main().catch(() => { console.error('Review summary backend unavailable'); process.exitCode = 1; });
module.exports = { summaryPublisher };
