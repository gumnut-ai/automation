---
description: Disabled synthetic fixture/project dependency delivery example.
# Compile with gh-aw v0.89.21:
# gh aw compile --dir examples/consumer/.github/workflows --action-tag c35393777e5604a63721d09512263b1383301d4f
# Generated locks are local validation artifacts, not distributed by this example.
on:
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
network:
  allowed: [defaults, github]
safe-outputs:
  # The protected environment belongs to native safe-output delivery, outside
  # the agent job. App references are unset; no credentials are provided.
  environment: fixture-dependency-publisher
  github-app:
    client-id: ${{ vars.FIXTURE_PUBLISHER_CLIENT_ID }}
    private-key: ${{ secrets.FIXTURE_PUBLISHER_PRIVATE_KEY }}
    owner: fixture
    repositories: [project]
  create-pull-request:
    max: 1
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
    max: 1
    target: "*"
    signed-commits: true
    fallback-as-pull-request: false
    github-token-for-extra-empty-commit: none
    patch-format: bundle
    if-no-changes: error
    protected-files:
      policy: blocked
      exclude: [package.json, package-lock.json]
  scripts:
    handoff-dependency-pr:
      description: Execute one selected human assignment or review request at the exact dependency PR head.
      inputs:
        pull_request_number:
          description: Existing eligible dependency PR number.
          type: number
          required: true
        head_sha:
          description: Exact current full head SHA.
          type: string
          required: true
        reviewer:
          description: Human repository writer selected by caller policy.
          type: string
          required: true
        action:
          description: Selected missing action, assign or request_review.
          type: string
          required: true
      script: |
        return await require(process.env.DEPENDENCY_MAINTENANCE_TRUSTED + '/delivery.cjs').handoff({ github, context, item });
  # Native setup precedes these safe-output steps. Keep the shared boundary
  # before all publishers, including readiness-only handoffs without a checkout.
  steps:
    - name: Constrain native dependency delivery
      uses: gumnut-ai/automation/actions/dependency-delivery@38e220e56a4a3530acaccad28e278736c0a314b3
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

This disabled example shows the delivery integration for `fixture/project`.
GitHub tools and agent credentials are read-only; local edits and tests use the
checkout. Never give the agent publisher credentials. Use native safe outputs
for a compatible dependency PR, a signed repair to an eligible bot PR, or one
human handoff. Follow the caller's reviewed capacity, CI readiness and reviewer
selection policy; stop for unsupported transport or protected-file changes.
