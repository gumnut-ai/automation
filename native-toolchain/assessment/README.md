# Native GH-AW assessment

Assessment date: October 26, 2026. This is an evaluation record, not an upgrade
or activation. No production runtime, credentials or reviewer policy changes.

## Constraints

Use unmodified GH-AW through supported configuration and documented extension
points. Do not rewrite its generated workflows, patch downloaded JavaScript,
or depend on private helpers in production. Existing corrections are migration
debt. Agent instructions own investigation, useful-work selection, readiness
and deduplication; credential isolation and necessary security/concurrency
boundaries remain enforced outside the agent. A missing supported boundary is
a platform gap, not permission to weaken it or add another compatibility patch.

## Candidate selection

Apply 14 elapsed days to release publication and executable asset availability.
Verify immutable revisions and asset digests. Check newly introduced runtime
dependencies separately before deployment; an old compiler does not establish
their eligibility. Inspecting newer source does not authorize executing it.

| Release | Published UTC | Result on October 26 |
| --- | --- | --- |
| v0.93.5 | October 25, 17:17:17 | Latest non-prerelease; eligible November 8, 17:17:17 |
| v0.91.12 | October 14, 04:49:11 | Next non-prerelease candidate; eligible October 28, 04:49:11 |
| v0.91.9 | October 12, 17:41:31 | Newest aged candidate; upstream marks it prerelease |
| v0.89.21 | September 23, 20:29:04 | Newest aged non-prerelease; current baseline |

The isolated candidate is [v0.91.9](https://github.com/github/gh-aw/releases/tag/v0.91.9),
source `a1b579ff679a8c163f4091e70e6b3008d56c8de0`. Its Darwin arm64 asset SHA-256 is
`02a957859edf4e4b9ad7e501c089785a4153ec3940a0b730890cdf10fce581ce`;
the asset was available October 12, 17:41:23 UTC. This assessment does not
recommend promoting a prerelease. Release eligibility must be refreshed later.

## Reproduce without modifications

Download and verify that compiler and source revision outside the checkout.
In a disposable Git repository with a synthetic `fixture/project` origin, copy
`workflows/native-delivery.md` to `.github/workflows/native-delivery.md`. Run:

```bash
/path/to/verified/gh-aw compile native-delivery --action-tag a1b579ff679a8c163f4091e70e6b3008d56c8de0 --no-check-update
node /path/to/automation/native-toolchain/assessment/probe.cjs \
  /absolute/scratch/.github/workflows/native-delivery.lock.yml \
  /absolute/native-source/actions/setup/js
```

The fixture is disabled, has no schedule and uses unset synthetic credential
references. Do not install or dispatch it. Retain generated locks outside this
repository. Compilation warns that unrestricted PR targeting needs review.
The probe is an observation CLI, not a passing-capabilities test: inspect its
JSON results. It uses native producer, collector and publication handlers,
local Git repositories and mocked GitHub calls. Only the collector's fixed
output-directory constant is redirected in the test process. Native source
files are never edited and their aggregate fingerprint is compared afterward.
No inference, real API mutation, project dependency installation or container
execution occurs.

## Observed behavior

| Case | Unmodified v0.91.9 result |
| --- | --- |
| Native compilation | Succeeds without corrected lock output |
| Explicit sandbox image pins | Selected agent digest reaches detection; the corresponding old image correction is unnecessary for this fixture |
| Existing numeric PR handoff | Native assignment and reviewer intents both survive collection; numeric reviewer handler calls the mocked API successfully |
| New PR temporary-ID reviewer | Handler rejects `aw_proposal` even with its resolved number supplied; reversed intents remain in their original order |
| Repair baseline | Tool captures `base_commit`; generated collector schema discards it |
| Matching-head repair | Native tool → collector → publisher reaches one mocked signed mutation successfully despite the discarded field |
| Competing human commit | Publisher preserves the human file but rebases the repair and targets the advanced head; it does not defer the stale proposal |
| Signed API error | With `signed-commits: true` and replacement PR fallback disabled, publisher falls back to direct Git push; the local bare remote accepts an unsigned commit |
| Valid noop plus invalid intent | Collector retains noop and records an error without calling `core.setFailed`; this alone does not establish the later workflow conclusion |
| Native terminal signals | Noop and report-incomplete remain distinguishable collected types |

The signed-success API mock records the mutation request and returns a synthetic
OID; it does not create a signed commit. The API-error case performs a real Git
push only to a disposable local bare repository. A protected GitHub branch could
reject that push. No hosted signature, credential or CI-trigger guarantee is
claimed. The stale case preserves the competing file: it demonstrates a different
concurrency contract, not observed data loss.

Generated publisher tokens request Contents write, Pull requests write, Issues
write and Administration read for this fixture. The protected environment also
appears on `pre_activation`, as the native environment contract documents;
the agent job does not receive it. A source declaration of
`safe-outputs.github-app.permissions.issues: read` is rejected by this compiler.
These findings require scope/configuration review, not a generated permissions
patch. No real App exchange was tested.

## Architectural fit

GH-AW's read-only agent, sandbox and separate safe-output publication model fits
scheduled investigation and ordinary proposal creation. Documented custom safe
jobs/scripts can implement genuinely missing integrations without modifying the
framework. Sharing role instructions is compatible with that model.

Our stronger repair contract differs from native best-effort reconciliation:
we require publication against the exact investigated head, mandatory signed
mutations, no unsigned fallback and explicit recovery after uncertain writes.
The native matching-head happy path works, but the stale-head and API-error
fixtures do not satisfy that contract. Missing collector metadata by itself is
not proof of native repair failure; it broke the additional guard's contract.
Similarly, native numeric handoffs can avoid a custom handoff quantity patch,
while same-activation temporary-ID handoff remains unsupported in this probe.

Do not roll out this version as a drop-in replacement. First evaluate an aged
stable native release against these cases and any required protected-file and
uncertain-response cases. Resolve gaps upstream through supported native
configuration/features, or assess a different execution/publication platform.
A narrower native-only contract, such as readiness handoff on a later run, is
an explicit design option; changing required security/concurrency guarantees is
not an implicit upgrade fix. A replacement built on ordinary Actions and one
owned publisher avoids GH-AW internal coupling but transfers sandbox, budget,
transport and publication maintenance to us; it needs a concrete comparison.

Hosted admission, credential isolation, actual signed API behavior, ordinary PR
CI triggering, complete human handoff and scheduled operation remain unverified.
The existing protected-file controls must not be removed based on these probes.

## Source anchors

- [Native signed repair publisher](https://github.com/github/gh-aw/blob/a1b579ff679a8c163f4091e70e6b3008d56c8de0/actions/setup/js/push_to_pull_request_branch.cjs)
- [Signed replay and fallback behavior](https://github.com/github/gh-aw/blob/a1b579ff679a8c163f4091e70e6b3008d56c8de0/actions/setup/js/push_signed_commits.cjs)
- [Collector](https://github.com/github/gh-aw/blob/a1b579ff679a8c163f4091e70e6b3008d56c8de0/actions/setup/js/collect_ndjson_output.cjs)
- [Supported custom safe outputs](https://github.com/github/gh-aw/blob/a1b579ff679a8c163f4091e70e6b3008d56c8de0/docs/src/content/docs/reference/custom-safe-outputs.md)
- [Native environment contract](https://github.com/github/gh-aw/blob/a1b579ff679a8c163f4091e70e6b3008d56c8de0/docs/src/content/docs/reference/safe-outputs.md#environment-protection-environment)
