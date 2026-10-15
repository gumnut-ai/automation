'use strict';

const fs = require('node:fs');
const path = require('node:path');
const agents = require('./agents.json');

const ACTION_SHA = '2dca132ff0e0c4094ce6048b422c6915a071210b';
const RUNTIME_IMAGE = require('./runtime/image.cjs');
const ALLOWED_TOOLS = 'ToolSearch,Agent(haiku-helper),Read,Grep,Glob,mcp__github__pull_request_read,mcp__github__get_file_contents,mcp__github__get_commit,mcp__github__list_commits,mcp__github__search_code,mcp__github__issue_read,mcp__github__add_issue_comment,mcp__github_inline_comment__create_inline_comment';
// The official Action expands its own GITHUB_ACTION_PATH when parsing args.
// Keep that backend path separate from the shared package's location.
const MCP = { mcpServers: { github_inline_comment: {
  command: 'bun', args: ['--no-env-file', '--config=${GITHUB_ACTION_PATH}/bunfig.toml', 'run', '${GITHUB_ACTION_PATH}/src/mcp/github-inline-comment-server.ts'],
  env: { REPO_OWNER: '${CLAUDE_REVIEW_OWNER}', REPO_NAME: '${CLAUDE_REVIEW_REPO}', PR_NUMBER: '${CLAUDE_REVIEW_PR_NUMBER}', CLASSIFY_INLINE_COMMENTS: 'false' },
} } };
const quote = value => `'${value.replaceAll("'", "'\\''")}'`;

function configuration({ number, repository, sha, branch, root = path.resolve(__dirname, '..') }) {
  if (!/^[1-9][0-9]*$/.test(number || '') || !Number.isSafeInteger(Number(number)) ||
      !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') || !/^[a-f0-9]{40}$/i.test(sha || '') ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(branch || '')) throw new Error('Invalid prepared review identity');
  const args = [
    '--model claude-opus-5-5', '--effort medium', '--max-turns 50',
    '--restricted', '--strict-mcp-config', '--permission-mode dontAsk',
    '--tools ToolSearch,Agent,Read,Grep,Glob',
    `--agents ${quote(JSON.stringify(agents))}`,
    `--mcp-config ${quote(JSON.stringify(MCP))}`,
    `--allowedTools ${quote(ALLOWED_TOOLS)}`,
  ].join(' ');
  return {
    launcher: path.join(root, 'claude-review/runtime/launcher.cjs'),
    claude_args: args,
    prompt: `Independently review PR #${number} in ${repository}.\nTrusted policy SHA: ${sha}; trusted target branch: ${branch}.\nUse mcp__github__get_file_contents with that trusted SHA as sha to read\n.github/claude-review/INSTRUCTIONS.md first, then follow it.\nUse the live PR head and base, not the event's old snapshot.`,
  };
}

if (require.main === module) {
  try {
    const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const values = configuration({ number: process.env.REVIEW_PR_NUMBER, repository: process.env.GITHUB_REPOSITORY, sha: process.env.GITHUB_SHA, branch: event.repository?.default_branch });
    // JSON strings are single-line outputs; the prompt uses a fixed delimiter
    // absent from every validated identity and static prompt component.
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `launcher=${values.launcher}\nclaude_args=${values.claude_args}\nprompt<<REVIEW_PROMPT_END\n${values.prompt}\nREVIEW_PROMPT_END\n`);
  } catch { console.error('::error::Shared reviewer configuration unavailable.'); process.exitCode = 1; }
}

module.exports = { configuration, ACTION_SHA, RUNTIME_IMAGE, ALLOWED_TOOLS, MCP };
