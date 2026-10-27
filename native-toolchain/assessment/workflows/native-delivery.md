---
# Disabled synthetic source for the unmodified, cooldown-eligible stable compiler.
description: Disabled synthetic native delivery assessment.
if: 'false'
runs-on: ubuntu-latest
timeout-minutes: 30
permissions:
  contents: read
  issues: read
  pull-requests: read
tools:
  bash:
  - '*'
  github:
    toolsets:
    - repos
    - pull_requests
    - users
    allowed:
    - get_file_contents
    - list_pull_requests
    - pull_request_read
    allowed-repos:
    - fixture/project
    min-integrity: none
checkout:
  ref: ${{ github.sha }}
  fetch-depth: 0
  fetch:
  - dependabot/*
  - renovate/*
  - dependency-maintenance/*
engine: codex
sandbox:
  agent:
    version: v0.28.25
    images:
      agent: ghcr.io/github/gh-aw-firewall/agent:0.28.25@sha256:25fbbefb92b690d4e6ef34de8df057c0349e6adf2b7486c0cc56954a8e9a3cd4
      squid: ghcr.io/github/gh-aw-firewall/squid:0.28.25@sha256:94cac14372280dbf4a08d021d7b5810a9fd7d73c88802e04a9e05551b1cbcd09
      apiProxy: ghcr.io/github/gh-aw-firewall/api-proxy:0.28.25@sha256:c3c7082e73ba83052c580097e5a9c9c40a11e6f6b6fa0a4710e6859f83a62854
network:
  allowed:
  - defaults
  - github
safe-outputs:
  environment: fixture-dependency-publisher
  create-pull-request:
    max: 10
    base-branch: main
    branch-prefix: dependency-maintenance/
    allowed-branches:
    - dependency-maintenance/*
    preserve-branch-name: true
    fallback-as-issue: false
    if-no-changes: error
    protected-files:
      policy: blocked
      exclude:
      - package.json
      - package-lock.json
    signed-commits: false
    patch-format: am
    labels:
    - dependencies
  push-to-pull-request-branch:
    max: 10
    target: '*'
    signed-commits: true
    fallback-as-pull-request: false
    github-token-for-extra-empty-commit: none
    patch-format: bundle
    if-no-changes: error
    protected-files:
      policy: blocked
      exclude:
      - package.json
      - package-lock.json
    required-labels:
    - dependencies
  add-reviewer:
    max: 100
    target: '*'
    required-labels:
    - dependencies
  assign-to-user:
    max: 100
    target: '*'
    required-labels:
    - dependencies
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
  github-token: ${{ steps.native_job_token.outputs.token }}
'on':
  permissions:
    contents: read
    actions: read
  steps:
  - name: Synthetic admission
    run: 'true'
  workflow_dispatch: null
  roles:
  - admin
  - maintainer
  - write
jobs:
  safe_outputs:
    pre-steps:
    - name: Mint scoped synthetic publisher token
      id: native_job_token
      uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1
      with:
        client-id: ${{ vars.FIXTURE_PUBLISHER_CLIENT_ID }}
        private-key: ${{ secrets.FIXTURE_PUBLISHER_PRIVATE_KEY }}
        owner: fixture
        repositories: project
        permission-contents: write
        permission-pull-requests: write
        permission-issues: read
        permission-administration: read
  conclusion:
    pre-steps:
    - name: Mint scoped synthetic publisher token
      id: native_job_token
      uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1
      with:
        client-id: ${{ vars.FIXTURE_PUBLISHER_CLIENT_ID }}
        private-key: ${{ secrets.FIXTURE_PUBLISHER_PRIVATE_KEY }}
        owner: fixture
        repositories: project
        permission-contents: write
        permission-pull-requests: write
        permission-issues: read
        permission-administration: read
pre-steps:
- name: Use the read-only job token for agent checkout
  id: native_job_token
  env:
    GH_TOKEN: ${{ github.token }}
  run: echo "token=$GH_TOKEN" >> "$GITHUB_OUTPUT"
---

This disabled fixture assesses native delivery for `fixture/project`. Never install
or dispatch it. App references are unset. Agent checkout uses the read-only job
token; only native publisher jobs mint the scoped App token. Use native creation
and numeric assignment/review. Accept native repair reconciliation and recovery.
Keep readiness, human selection, counts and deduplication in agent instructions.
Respect native protected-file refusals and leave unsupported artifacts blocked.
The observation probe includes an unexpected-bundle counterexample: compilation
and normal am transport do not prove a safe protected-file boundary.
