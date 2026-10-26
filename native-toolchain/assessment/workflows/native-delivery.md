---
description: Disabled synthetic native delivery assessment.
on:
  permissions:
    contents: read
    actions: read
  steps:
    - name: Synthetic admission
      run: "true"
  workflow_dispatch:
  roles: [admin, maintainer, write]
# Deliberately disabled. A caller must review its policy, credentials and protected
# environment before replacing this gate and installing a compiled workflow.
if: "false"
runs-on: ubuntu-latest
timeout-minutes: 30
permissions:
  contents: read
  issues: read
  pull-requests: read
tools:
  bash: ["*"]
  github:
    toolsets: [repos, pull_requests, users]
    allowed: [get_file_contents, list_pull_requests, pull_request_read]
    allowed-repos: [fixture/project]
    min-integrity: none
checkout:
  ref: ${{ github.sha }}
  fetch-depth: 0
  fetch: ["dependabot/*", "renovate/*", "dependency-maintenance/*"]
engine: codex
sandbox:
  agent:
    version: v0.28.25
    images:
      agent: ghcr.io/github/gh-aw-firewall/agent:0.28.25@sha256:25fbbefb92b690d4e6ef34de8df057c0349e6adf2b7486c0cc56954a8e9a3cd4
      api-proxy: ghcr.io/github/gh-aw-firewall/api-proxy:0.28.25@sha256:c3c7082e73ba83052c580097e5a9c9c40a11e6f6b6fa0a4710e6859f83a62854
      squid: ghcr.io/github/gh-aw-firewall/squid:0.28.25@sha256:94cac14372280dbf4a08d021d7b5810a9fd7d73c88802e04a9e05551b1cbcd09
network:
  allowed: [defaults, github]
safe-outputs:
  # Native transport capacity; work-count caps belong to agent policy.
  # The protected environment belongs to native safe-output delivery, outside
  # the agent job. App references are unset; no credentials are provided.
  environment: fixture-dependency-publisher
  github-app:
    client-id: ${{ vars.FIXTURE_PUBLISHER_CLIENT_ID }}
    private-key: ${{ secrets.FIXTURE_PUBLISHER_PRIVATE_KEY }}
    owner: fixture
    repositories: [project]
  create-pull-request:
    max: 10
    base-branch: main
    branch-prefix: dependency-maintenance/
    allowed-branches: ["dependency-maintenance/*"]
    preserve-branch-name: true
    fallback-as-issue: false
    if-no-changes: error
    protected-files:
      policy: blocked
      exclude: [package.json, package-lock.json]
  push-to-pull-request-branch:
    max: 10
    target: "*"
    signed-commits: true
    fallback-as-pull-request: false
    github-token-for-extra-empty-commit: none
    patch-format: bundle
    if-no-changes: error
    protected-files:
      policy: blocked
      exclude: [package.json, package-lock.json]
  add-reviewer:
    max: 100
    target: "*"
  assign-to-user:
    max: 100
    target: "*"
  noop:
    report-as-issue: false
  missing-tool:
    create-issue: false
  missing-data:
    create-issue: false
  report-incomplete:
    create-issue: false
  report-failure-as-issue: false
  report-failed-jobs: false
---

This disabled fixture assesses native delivery for `fixture/project`.
GitHub tools and agent credentials are read-only; local edits and tests use the
checkout. Never give the agent publisher credentials. Use native safe outputs
for a compatible dependency PR, a signed repair to an eligible bot PR, or one
human handoff. Follow the caller's reviewed capacity, CI readiness and reviewer
selection policy; stop for unsupported transport or protected-file changes.
