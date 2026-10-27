# Native GH-AW assessment

Assessment snapshot: October 26, 2026. This is a provider-free evaluation, not a
runtime rollout. Existing consumer pins and corrections remain deployed.

## Agreed requirements

Use unmodified GH-AW and documented configuration/extensions. Preserve:

- Isolation of publisher credentials from agent and candidate execution.
- Reviewed dispatch-revision publication controls; never execute candidate
  programs with the publisher token.
- Configured repository/native branch restrictions, with no direct default-branch
  writes, automatic merges or approvals.
- CI, AI review and human approval before merge, including PRs that change
  workflows or security controls. Those files need not be mechanically excluded
  from proposal or repair branches.

Accept native reconciliation onto advanced heads, commit/signature and fallback
behavior subject to repository rules, environment placement across trusted jobs,
partial outcomes and native recovery. Exact bot IDs and exact investigated-head
binding are no longer mandatory gates. Agents own work selection, readiness,
human reviewer selection, counts and deduplication. These requirements supersede
the earlier assessment's stronger repair contract; a semantic difference alone
is not a platform defect or a reason to build a custom publisher.

Review applies to the resulting PR diff, not the agent's advertised patch.
Allowing workflow edits does not authorize candidate execution with publisher
credentials or a candidate's replacement of the current run's trusted controls.

## Stable release selection

The release list was refreshed October 26 at 23:49 UTC. Require 14 elapsed days
since release publication and executable asset availability, exclude drafts and
prereleases, and verify the selected immutable revision and asset digest.

| Stable release | Published UTC | Eligibility at the snapshot |
| --- | --- | --- |
| v0.93.5 | October 25, 17:17:17 | November 8, 17:17:17 |
| v0.91.12 | October 14, 04:49:11 | October 28, 04:49:11 |
| **v0.89.21** | September 23, 20:29:04 | **Newest eligible stable; tested** |

The selected release is the current compiler baseline, tested here without its
consumer corrections. Source/setup revision:
`c35393777e5604a63721d09512263b1383301d4f`. Darwin arm64 asset SHA-256:
`a2bd9cedfe5e6bdb8932a01644585a0fba446043f69ee146856b01372a4e4159`.
The asset was available September 23, 20:29:00 UTC. The earlier v0.91.9 probe was
a prerelease experiment; it is not the stable assessment candidate.

This compiler check does not establish eligibility for its whole runtime graph.
No images or new project dependencies were executed. In particular, native
v0.89.21 detection still emits versioned AWF image tags instead of the caller's
explicit digests. Runtime assets need review before deployment.

## Actual consumer coverage

The assessment used immutable current-main source snapshots from five consumer
repositories, not just the synthetic example. Private source, exact revisions,
source/candidate diffs, generated locks, logs and per-workflow results are
retained with the private task evidence; they are not distributed here.

| Maintenance role | Actual workflows tested |
| --- | ---: |
| Dependency overlay | 4 |
| Librarian | 4 |
| Code maintenance | 2 |
| Retirement | 1 |
| Changelog | 1 |
| Skill maintenance | 1 |
| **Total** | **13** |

PR-review workflows and standing reviewer approvals are excluded. All 13 exact
source workflows compiled natively. Their source still invokes compatibility
steps, so that alone is not evidence of patch-free operation.

Separate source-only candidates also compiled for all 13. The assessment:

- Removed shared publisher patch/preflight steps, custom handoff scripts,
  private native budget readers and dependent validation/readback jobs.
- Kept preparation, role imports, schedules/gates, sandbox selection and native
  file restrictions. Added explicit assessment instructions replacing the old
  transport protocol; these are evaluation candidates, not deployed policies.
- Used numeric native `add-reviewer`; dependency overlays also used native
  `assign-to-user`. New-PR handoff can happen on a later run. Dependency repair
  and handoff require `dependencies`; new dependency proposals receive it too.
  Existing role PRs without that label need deliberate admission before repair.
- Evaluated documented `patch-format: am` for creation. This supports linear
  histories; it does not support Git LFS uploads or promise merge preservation.
- Used documented per-job token hooks instead of correcting generated token
  permissions. See the authentication example below.

No generated YAML or downloaded runtime was edited. The probe loads native
modules only as test subjects; no private helper is integrated into production.

## Recorded results and revised interpretation

The original generated collector configurations and validation schemas drove local
Git fixtures and mocked GitHub APIs. Admitted fixture paths respect each
consumer's native file allowlist. Ten unconstrained configurations also carried
binary data and an executable; three restricted roles used a README edit.
These 13 candidates retained the earlier blocked-file policies; their results
are preserved, not presented as tests of newly enabled workflow publication.

| Case | Stable native result |
| --- | --- |
| New admitted proposal | Succeeds in all 13 fixtures; real local branch push, mocked PR creation |
| Binary bytes/executable mode | Preserved in all 10 applicable direct-push fixtures |
| Advertised protected-file edit or rename | Refused in all 13 |
| Foreign repository creation | Refused by the native tool in all 13 |
| Default branch during creation | Unchanged in all 13; requested branch is normalized to the actual admitted agent branch |
| Numeric review request | Mocked API succeeds for all 13 |
| Numeric assignment | Mocked API succeeds for all 4 dependency configurations |
| Dependency repair | All 4 matching-head cases reach a mocked signed mutation |
| Advanced head | All 4 dependency repairs preserve the human file and reconcile; the direct-push changelog fixture instead defers on non-fast-forward |
| Unauthorized repair | Foreign head repository, default/protected branch and hidden protected bundle edit are refused in all 5 repair configurations; missing label is refused in the 4 label-constrained configurations |
| Signed API failure | Dependency repair can fall back to an unsigned local Git push; accepted native semantics, not a signature guarantee |
| Mixed valid/invalid output | Native collection retains valid items and records errors; accepted partial outcomes |
| Unexpected creation bundle | All 13 creation configurations can publish a protected workflow edit absent from the advertised patch, even with `patch-format: am`; no longer an adoption blocker under the revised contract |

The last row is a native validation mismatch. The agent writes a safe patch, then
supplies an additional canonical bundle with a protected file. The creation publisher prefers that bundle by
presence and its direct-push route lacks the patch route's post-apply check.
Selecting `am` changes capture behavior, but does not prohibit bundle replay.
The fixture checks the actual local remote tree, not just a mocked success flag.

The file is visible in the resulting PR diff. The test demonstrates publication
to a proposal branch, not a default-branch write, merge or credential leak.
It reproduces one shared publisher behavior under 13 configurations, not 13
independent defects or observed malicious daemon runs. Because workflow edits
are now permitted through CI, AI review and human approval, closing this mismatch
is no longer a prerequisite for native adoption. Do not add a compatibility patch
for this superseded restriction.

## Native adoption decision

**No demonstrated architectural blocker remains under the agreed requirements.**
Use native GH-AW rather than retain compatibility code for exact-head binding,
signed-only publication, temporary-ID handoff or protected-file exclusion.
That is a platform-fit conclusion, not evidence that a production migration has
already passed hosted validation.

Native `protected-files: allowed` permits protected-file changes. For workflow
creation and repair, `allow-workflows: true` requires `safe-outputs.github-app`
and adds Workflows write to the minted App token. These are documented source
settings; no generated YAML or runtime change is needed. Role-specific file
allowlists may still deliberately narrow a role's work.

The disabled synthetic fixture now exercises this simpler native App path with
workflow changes allowed. Unlike the historical 13-consumer candidates, it uses
automatic native token minting rather than custom token pre-steps. It requires
Issues write for assignment and Workflows write for workflow edits. The recorded installation
snapshot has Issues read and lacks Workflows write, so permission setup is
needed before using that path. No App grant or real token mint is performed by
this assessment. Ordinary proposals can still use the scoped token hooks below.

The revised fixture compiles without corrections. Local Git tests admit a visible
workflow addition and rename on proposal branches, keeping the default branch
unchanged. Workflow repair reaches mocked signed API mutations. Foreign-repository,
default/protected-branch and missing-label repair cases are still refused. The
generated agent remains read-only and contains no publisher-key reference; only
the two publisher jobs mint App tokens. This is one new synthetic configuration,
not a rerun of the historical 13 configurations with file policies changed.

Before switching a consumer, complete a hosted canary and inspect its result:

| Remaining rollout gate | Evidence needed |
| --- | --- |
| Publisher and agent isolation | Read-only agent credentials; publisher key/token excluded from candidate execution, including cross-repository read-tool setup |
| Trusted publication | Reviewed workflow revision and pinned native code control publication; no candidate hooks, tests or scripts run with the publisher token |
| Ordinary PR path | Real App-authenticated creation and repair trigger required CI and AI review on the published changes; human approval is required and the App cannot bypass the merge requirements |
| Workflow-edit capability | Deliberately configure native allowed-file policy and App Workflows write; verify a visible workflow edit reaches a PR and its checks/reviews |
| Runtime eligibility | Review the complete runtime graph against cooldown and pinning requirements; native v0.89.21 detection still emits versioned AWF image tags |

GitHub App publication supports ordinary event-triggered CI; mocks do not prove
that a consumer's particular triggers, required checks or review rules are wired
correctly. Verify new and updated PRs, including workflow edits, before removing
that consumer's compatibility guards. Keep automatic merge/approval outputs
unconfigured. Existing reviewer and standing-approval systems are not changed by
this assessment. These are rollout/configuration gates, not demonstrated reasons
to reject GH-AW or build another framework.

## Supported authentication configuration

Native assignment causes automatic App-token generation to request Issues write.
The recorded installation snapshot has Issues read and Pull requests write. GitHub documents
[Pull requests write as sufficient for PR assignment](https://docs.github.com/en/rest/issues/assignees#add-assignees-to-an-issue).
A supported alternative is explicit scoped token minting in publisher jobs:

```yaml
safe-outputs:
  github-token: ${{ steps.native_job_token.outputs.token }}
  # Keep the caller's protected publisher environment here.
jobs:
  safe_outputs:
    pre-steps:
      - id: native_job_token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1
        # Caller-owned App inputs; Contents/PR write, Issues/Administration read.
  conclusion:
    pre-steps:
      - id: native_job_token
        uses: actions/create-github-app-token@bcd2ba49218906704ab6c1aa796996da409d3eb1
        # Same caller-owned inputs/scopes, minted in this job.
pre-steps:
  - id: native_job_token
    env:
      GH_TOKEN: ${{ github.token }}
    run: echo "token=$GH_TOKEN" >> "$GITHUB_OUTPUT"
```

The agent's step supplies its existing read-only job token, never the publisher
App key. The compiler requires the token step in each consuming job. The historical
consumer candidates use this configuration; the disabled fixture instead shows
automatic native App minting with workflow permission. The generated agent token
step was executed with a dummy value for each historical candidate; all 13 produced the expected
output without printing the token. No real App token was minted.

Generated job permissions remain read-only for agents. One consumer additionally
uses native App-authenticated cross-repository read tools on the agent host;
raw-key exclusion from candidate execution needs hosted sandbox verification.
A host-job secret reference or environment attachment alone proves neither a
leak nor complete isolation. Engine environment declarations contain no publisher
key. Publisher source authority is also a hosted verification requirement.

## Reproduce and interpret

Verify the stable compiler/source and create a disposable Git checkout from the
consumer's immutable revision. First compile the exact source; then apply the
source adaptations above to an isolated copy, recording its diff. Compile with:

```bash
/path/to/verified/gh-aw compile <workflow-name> --dir .github/workflows \
  --action-tag c35393777e5604a63721d09512263b1383301d4f --no-check-update
node /path/to/automation/native-toolchain/assessment/probe.cjs \
  /absolute/consumer/.github/workflows/<workflow-name>.lock.yml \
  /absolute/native-source/actions/setup/js
```

Use the disabled synthetic `workflows/native-delivery.md` when private consumer
source is unavailable. Copy it into a disposable `.github/workflows/` directory;
never install or dispatch it. It is representative, not the actual consumer set.
The probe is an observation CLI, not a passing-capabilities test: a zero exit code
means observations were collected, including the protected-file counterexample.

The probe redirects only the collector output-directory constant in memory.
Native transport uses its original `/tmp/gh-aw` paths with unique fixture branch
names; only those fixtures' patch/bundle files are removed afterward. Child
environments omit credentials. All Git remotes are disposable local directories,
GitHub calls are mocks, and native source fingerprints are compared afterward.
The changelog's dynamic target is bound to synthetic PR 12 as GitHub would resolve
trusted admission output; that test substitution is recorded in the JSON.
Signed API mocks return synthetic OIDs and do not create real signed commits.

Hosted inference, dependency installation, App exchange, actual signatures,
ordinary PR CI, sandbox credential isolation, complete human handoff and scheduled
operation remain unverified. The architecture recommendation is native GH-AW
under the relaxed contract, followed by a hosted canary and consumer rollout.
This assessment does not authorize production activation or establish that the
remaining rollout gates have passed.

## Source anchors

- [Stable release](https://github.com/github/gh-aw/releases/tag/v0.89.21)
- [Creation publisher and transport selection](https://github.com/github/gh-aw/blob/c35393777e5604a63721d09512263b1383301d4f/actions/setup/js/create_pull_request.cjs)
- [Native repair publisher](https://github.com/github/gh-aw/blob/c35393777e5604a63721d09512263b1383301d4f/actions/setup/js/push_to_pull_request_branch.cjs)
- [Signed replay and fallback](https://github.com/github/gh-aw/blob/c35393777e5604a63721d09512263b1383301d4f/actions/setup/js/push_signed_commits.cjs)
- [Supported token hooks and environments](https://github.com/github/gh-aw/blob/c35393777e5604a63721d09512263b1383301d4f/docs/src/content/docs/reference/safe-outputs.md)
