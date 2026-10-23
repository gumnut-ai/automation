# Shared automation

Composite GitHub Actions for isolated, subscription-backed Claude review and
standing PR approval, plus a native dependency publisher boundary. Consumers pin a reviewed immutable commit. This repository
contains shared mechanics; repository policy and activation stay with callers.

| Component | Interface |
| --- | --- |
| `actions/claude-dispatch` | `enabled` (default `false`); validate metadata and dispatch the trusted default-branch workflow |
| `actions/claude-prepare` | `enabled`; re-fetch admission, create an execution check, build the isolated runtime; output validated identity, launcher, prompt and arguments |
| `actions/claude-report` | Admission/check ID and official Action results; finish the execution check and retain sanitized usage. When inference did not complete, the check says so and gives the safe failure category and the manual re-request |
| `actions/daemon-delivery` | `validate-proposal` (default `false`); resolves fresh native PR reviewer targets; exports `DAEMON_DELIVERY_TRUSTED` and `trusted-directory` |
| `actions/dependency-delivery` | No inputs; preserves trusted helpers and constrains the pinned native gh-aw publishers; exports `DEPENDENCY_MAINTENANCE_TRUSTED` and `trusted-directory` |
| `dependency-maintenance/compile.cjs` | Run from a consumer root with `/path/to/gh-aw`; compiles and corrects the fixed `dependency-maintenance` workflow for gh-aw v0.89.21 |
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
mediate inference and GitHub access. The GitHub backend exposes read tools only.
A summary backend posts only to the admitted PR, using its validated host identity
instead of model-supplied destinations. Local review policy must use
`mcp__review_summary__add_review_summary` for the summary and
`mcp__github_inline_comment__create_inline_comment` for inline findings. Admission
re-fetches live metadata, accepts only open, non-draft same-repository PRs targeting the default branch, and checks
manual actors or automatic dispatch origins. Contributor code is never executed
by the privileged reviewer jobs.

The caller owns the official Claude App installation, the OAuth subscription
secret `CLAUDE_CODE_OAUTH_TOKEN`, and `CLAUDE_PR_REVIEW_ENABLED` (exactly `true`
activates review). OAuth is the supported inference credential. It also owns
permissions, policy, required CI, review requirements, schedules and the standing
approval App. Keep review disabled until those are deliberately configured.

For standing approval, start with `PR_APPROVAL_MODE=shadow` and the exact
`PR_APPROVAL_BOT_LOGIN`. Assessment independently reads reviewer evidence and CI;
it does not itself review code. An execution check alone is not a sign-off.
Publication requires
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

## Native daemon human review handoff

`actions/daemon-delivery` runs in a trusted native gh-aw safe-output job after
v0.89.21 setup has populated `$RUNNER_TEMP/gh-aw/actions`, before native output
processing or any candidate branch checkout. Pin gh-aw setup to
`c35393777e5604a63721d09512263b1383301d4f` and this action to a reviewed immutable
commit. The action verifies the exact `add_reviewer.cjs` and handler-manager
hashes before patching either helper. It preserves native dependency ordering
while making reviewer requests depend on their newly created PR's temporary ID.
The native handler continues to own the API call and its configured restrictions.

The action copies trusted preparation, reviewer and human-account exclusion
helpers into a fresh `$RUNNER_TEMP` directory. It exports
`DAEMON_DELIVERY_TRUSTED` and the `trusted-directory` output. Subsequent readback
steps can load `require(process.env.DAEMON_DELIVERY_TRUSTED +
'/human-reviewer.cjs').isHumanReviewer`. A separate job can use that same helper
from a trusted checkout of `daemon-delivery/human-reviewer.cjs` at the same
reviewed shared revision; the environment export is local to the publisher job.
Dependency delivery uses this same canonical account-exclusion helper.

The `validate-proposal` input defaults to `false`, preserving patch-only callers.
With `true`, the caller must supply `GH_AW_AGENT_OUTPUT` through the step's
environment. Before patching, validation requires a clean native output envelope
containing one PR proposal and at most one human reviewer request targeting that
proposal's temporary ID in the same repository. A proposal without a reviewer
remains valid. Both modes constrain reviewer delivery to the current activation's
resolved same-repository PR and exactly one eligible human, without team reviewers.
Configure native `add-reviewer.target: '*'`; fixed or triggering targets are
rejected because they override the published PR number. Reviewer logins must be
canonical GitHub usernames, without surrounding whitespace.

Callers retain publisher authentication, permissions, admission, native safe-output
limits, work selection, review readiness, history, deduplication and delivery
readback. This action creates no credentials or additional publication policy.
It does not update or activate any consumer. Native integration tests use only
synthetic fixtures and the pinned source; real delivery remains a consumer check.

## Native dependency delivery

`actions/dependency-delivery` runs in a caller's trusted native gh-aw safe-output
job after v0.89.21 setup has populated `$RUNNER_TEMP/gh-aw/actions`, before any
publisher or candidate branch checkout. Pin gh-aw to
`c35393777e5604a63721d09512263b1383301d4f`. The action verifies the exact native
publisher source hashes before patching either file; source drift fails closed.
It copies delivery, preparation and human-account exclusion helpers from the
pinned shared action into a fresh directory under `$RUNNER_TEMP`, then applies
the native guards. It exports that directory through
`DEPENDENCY_MAINTENANCE_TRUSTED` for subsequent job steps and the
`trusted-directory` action output. The action has no inputs and creates no
credentials. The caller retains its existing isolated publisher authentication,
permissions, native safe-output configuration, protected-file policy and gates.

The delivery guard accepts same-repository open PRs targeting `main`, with exact
Dependabot or Renovate bot identities, or the exact Gumnut bot identity on a
`dependency-maintenance/` branch. Repairs require native signed commits and
`fallback_as_pull_request: false`. The guard binds native signed mutations to
the captured PR head through native compare-and-swap, disables Git push fallback
and replacement PR publication, and stops after an uncertain mutation. Native
bundle checks also inspect the resulting PR tree for protected files, including
merge-only changes. Native transport limitations still apply.

The human handoff accepts `{ pull_request_number, head_sha, reviewer, action }`,
where `action` is `assign` or `request_review`. It validates the exact PR head,
a human account with repository write access and known automation exclusions,
executes the selected action once, then reads back the result. Proposal caps,
review readiness, history, deduplication and work selection remain caller/agent
policy. Inspect uncertain publication before another run.

The [disabled synthetic consumer source](examples/consumer/.github/workflows/dependency-maintenance.md)
shows the complete native integration: read-only agent permissions and GitHub
tools, native creation and signed repair outputs, the human handoff script, and
the pinned shared action in `safe-outputs.steps` after native setup. Its explicit
`false` gate disables execution; it has no schedule. The publisher environment
and unset App references are examples only. Keep publisher credentials scoped to
the protected environment, outside the agent job.

Compile locally with the pinned v0.89.21 compiler:

```bash
gh aw compile --dir examples/consumer/.github/workflows --action-tag c35393777e5604a63721d09512263b1383301d4f
```

The example distributes raw native source only; remove the generated lockfile
after local validation. It does not include the admission steps or explicit AWF
image pins required by the shared compiler below. Its raw v0.89.21 output needs
`permission-issues: read` alongside `permission-pull-requests: write` in both
publisher App-token steps: native reviewer label checks need Issues read, which
that compiler omits. A real caller must review and commit its corrected workflow. Review generated
permissions, container pins, environment protection, credentials and repository
policy before any separate activation decision. Local contract tests establish
source compatibility and fixture behavior; hosted credential isolation and real
publication require separate consumer validation.

### Shared dependency compiler

Compatible consumers can replace their local correction wrapper with
`dependency-maintenance/compile.cjs` from an immutable checkout of this repository.
From the consumer repository root, check out a reviewed full commit (use the same
revision as its shared delivery action), then run the CLI directly:

```bash
git clone https://github.com/gumnut-ai/automation.git .shared-automation
git -C .shared-automation checkout --detach "$AUTOMATION_SHA"
node .shared-automation/dependency-maintenance/compile.cjs "$GH_AW_COMPILER"
```

Set `AUTOMATION_SHA` to the reviewed full commit and `GH_AW_COMPILER` to the local
v0.89.21 executable. Keep the temporary shared checkout out of consumer commits.
The CLI invokes `compile dependency-maintenance` with the pinned setup action and
`--no-check-update`, then corrects `.github/workflows/dependency-maintenance.lock.yml`.
It leaves the workflow source unchanged. The source must include admission steps
that generate `pre_activation`, three digest-qualified `sandbox.agent.images`
entries (`agent`, `apiProxy`, `squid`), and a scalar `safe-outputs.environment`.
Native generation must produce `safe_outputs` and `conclusion`, each with one
publisher App-token step, plus the `detection` job using AWF v0.28.25.

The shared corrections grant admission only Contents/Actions read, pin detector
images to the source digests, add Issues read to both publisher tokens, and remove
the caller's publisher environment from other jobs. They also normalize the setup
release label and preserve source action annotations. Repository policy, schedules,
activation gates, image selections, credentials and environment protection remain
caller-owned. Unexpected source or generated structure fails the command; any raw
lockfile left by native compilation is unvalidated and must not be committed or
deployed. Review the generated diff before committing it. This CLI supplies the
corrections above for compatible consumers; no manual lockfile patch is needed.

## Shared daemon instructions

`daemons/librarian.md`, `daemons/codebase-maintainer.md` and
`daemons/dependency-maintenance.md` contain portable role instructions as plain
Markdown. A consumer embeds its selected role file through a native gh-aw import
pinned to a reviewed full commit SHA, with `inlined-imports: true`, and applies it
together with its local daemon policy. Compilation embeds the instructions; the
agent does not fetch policy at runtime.

For example, add `inlined-imports: true` and an `imports` entry of
`gumnut-ai/automation/daemons/librarian.md@<reviewed-full-commit-sha>` to the
consumer's workflow frontmatter, replacing the placeholder with its reviewed SHA.

The consumer owns scope, schedules, activation, limits, required checks,
dependency exceptions, release evidence, lifecycle and retirement rules, and
human review policy. The shared files supply common behavior without caller
frontmatter or a configuration schema. Updating a shared file does not update
consumers: review the change, update the immutable import and regenerate each
consumer workflow while preserving its local policy.

## Standing approval policy

Reviewer sign-offs and the coordinator's approval are standing decisions that
can persist across pushes. A new commit or deleted review comment does not by
itself revoke an existing approval. Later reviewer concerns can cause the
coordinator to withdraw its own approval; maintainers can explicitly dismiss it.

Claude's structured verdict tolerates whitespace, capitalization, field order,
punctuation and emphasis wrappers, and HTML line breaks. It still requires one
explicit marker with a verdict and valid head/base revisions. Duplicate markers,
duplicate or unknown fields, and substantive same-line text do not establish a
sign-off; significant findings continue to block approval.

CI is an independent merge condition, owned by the consumer. Pending or failed
CI does not revoke an existing approval, and an approval is not a signal that
current CI is green. The implementation currently waits for observed
current-head CI to pass before publishing a new coordinator approval; that
publication gate does not change the approval's lifetime.

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

Run `npm test` (no installation required). Native delivery integration tests
run when `GH_AW_SETUP_DIR` points to the pinned `actions/setup/js` source directory:

```bash
GH_AW_SETUP_DIR=/path/to/gh-aw/actions/setup/js node --test daemon-delivery/*.test.cjs dependency-maintenance/*.test.cjs
```

CI checks out the immutable native source and enables these tests, which use only
disposable local Git fixtures and dummy identities. CI also checks workflow syntax and
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
