# Shared review automation

Composite GitHub Actions for isolated, subscription-backed Claude review and
standing PR approval. Consumers pin a reviewed immutable commit. This repository
contains shared mechanics; repository policy and activation stay with callers.

| Component | Interface |
| --- | --- |
| `actions/claude-dispatch` | `enabled` (default `false`); validate metadata and dispatch the trusted default-branch workflow |
| `actions/claude-prepare` | `enabled`; re-fetch admission, create an execution check, build the isolated runtime; output validated identity, launcher, prompt and arguments |
| `actions/claude-report` | Admission/check ID and official Action results; finish the execution check and retain sanitized usage |
| `actions/pr-approval` | `operation`: `source`, `route`, `inspect`, or `publish`; explicit mode, bot identity, numbers and publisher token as applicable |

See each `action.yml` for exact input and output names.

## Use in a consumer

Copy [the consumer example](examples/consumer/) into a repository. Select the same reviewed full commit SHA from this repository for every shared
action reference in its workflows. Examples pin a published source revision;
verify the selected revision before deploying. Keep the filenames
`claude-review.yml`, `pr-approval-request.yml` and `pr-approval-coordinator.yml`:
request routing verifies those names and the native admission receipt step.
Customize `.github/claude-review/INSTRUCTIONS.md` on the trusted default branch.
Use a GitHub-hosted Linux runner with Docker; shared scripts use its Node runtime.

Keep `anthropics/claude-code-action` directly in the consumer workflow, pinned to
the `ACTION_SHA` exported by `claude-review/config.cjs`. Its official App exchange
and SDK stay on the host; the custom launcher starts a nonroot, read-only CLI
container without host credentials. A model proxy and allowlisted MCP gateway
mediate inference and GitHub access. Admission re-fetches live metadata, accepts
only open, non-draft same-repository PRs targeting the default branch, and checks
manual actors or automatic dispatch origins. Contributor code is never executed
by the privileged reviewer jobs.

The caller owns the official Claude App installation, the OAuth subscription
secret `CLAUDE_CODE_OAUTH_TOKEN`, and `CLAUDE_PR_REVIEW_ENABLED` (exactly `true`
activates review). OAuth is the supported inference credential. It also owns
permissions, policy, required CI, review requirements, schedules and the standing
approval App. Keep review disabled until those are deliberately configured.

For standing approval, start with `PR_APPROVAL_MODE=shadow` and the exact
`PR_APPROVAL_BOT_LOGIN`. Assessment independently reads reviewer evidence and CI;
it does not itself review code. Sign-offs can persist across pushes under the
standing policy; an execution check alone is not a sign-off. Publication requires
`PR_APPROVAL_MODE=publish` and a separate `pr-approval-publisher` environment.
Configure that environment to admit only the protected default branch, with
required human reviewers as appropriate. Store `PR_APPROVAL_APP_ID` and
`PR_APPROVAL_APP_PRIVATE_KEY` there. The App installation needs Contents write
for approvals that count toward protected-branch requirements; the runtime
installation token requests only Pull requests write, scoped to the intended
repository. Only the publisher job mints its token, then
reassesses immediately before publishing. Never pass that token to assessment or
inference. These examples do not configure environment protection or enable any
reviewer or publisher.

## Updates and rollback

A shared change does not update consumers. Review its diff, run validation, then
update all shared pins in one consumer PR. Keep policy, gates and environment
protection local. Preserve existing activation gates and modes during migration.
For new installations, start with review disabled and approval in shadow mode;
verify admission, rejection, execution reporting and review evidence before any
separate activation decision. Roll back by restoring the previous reviewed SHA
in every shared action reference. Disable the caller gate or publication mode to
stop new work while investigating; already-running jobs require cancellation.
Official Action/runtime pin changes need a coordinated consumer update.

## Validation

Run `npm test` (no installation required). CI also checks workflow syntax and
security and runs the opt-in Linux Docker isolation/transport suite using dummy
credentials. It builds `claude-review/runtime`, pulls digest-pinned sidecars,
checks out the pinned official Action and installs its frozen production backend
dependencies with scripts disabled. No provider secrets are available to CI.

The Docker suite proves transport and credential boundaries against fixtures;
it does not validate paid inference, subscription health, real App exchange,
repository/environment protection, delivery of a real review or production
approval eligibility. Those require separately authorized consumer validation.
`tests/fixtures/workflows` are regression inputs, not deployable examples. Keep
all examples and fixtures synthetic and suitable for public distribution.
