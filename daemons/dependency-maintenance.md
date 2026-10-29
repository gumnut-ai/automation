# Shared dependency-maintenance instructions

Apply these instructions together with the consuming repository's daemon policy
and owning repository guidance. Repository scope, limits, exceptions and required
checks remain local authorities.

Inspect open role PRs and trusted review feedback first, then current Dependabot
and Renovate PRs targeting main. Verify author identity through GitHub metadata.

Select a human reviewer candidate from recent, substantive merged contributions
to the changed files, widening to the owning area when needed. Resolve the
GitHub login from that evidence; exclude the PR author and automation accounts.
Contribution history establishes suitability, not repository permissions. Verify
that the selected account is human and eligible using available repository
evidence; collaborator enumeration is not a prerequisite. Follow the caller's
configured handoff operations and inspect their results. A filtered collaborator
response means unavailable evidence, not no eligible humans.
If no suitable candidate is found or the handoff fails, report the incomplete
handoff without claiming assignment or review delivery.

Keep evidence compact before it enters the conversation. Use native query and
field filters, paginate relevant reads, and inspect targeted dependency roots.
Save large audit results locally and return selected package/version/advisory,
fix and release-date fields with coverage and errors; expand descriptions only
for candidates that need them. Avoid dumping whole lockfiles, generated workflows
or repeated full advisory lists. Summarization must preserve blockers and unknowns.

Discover capabilities from the installed, repository-pinned tools and their help
before declaring a scanner or resolver unavailable; for example, check `uv audit`
when uv is installed. Use supported native audits when GitHub advisory records
are unavailable. Prepare missing approved tools inside the sandbox when allowed
by repository instructions and network policy, verify their pinned versions, and
keep blocked evidence scoped to the affected claim rather than unrelated work.

Deliver one useful bounded update when its own evidence and required checks are
complete. An unavailable audit for another root, an unrelated advisory, or a
separate blocked PR does not prevent that delivery. Record those scoped gaps and
deferrals in the proposal body or handoff context without claiming complete
coverage. Do not emit `noop`, `missing_tool`, `missing_data` or `report_incomplete`
for those unrelated gaps alongside a delivery intent. If the selected patch's
own required evidence or checks are unavailable, withhold that patch.

Choose the native outcome after the bounded inspection. With no deliverable,
use `report_incomplete` when required capabilities, evidence or checks are
unavailable or work is unfinished; include verified findings, the blocked scope
and what would unblock it. `missing_tool` and `missing_data` are diagnostics,
not substitutes for `report_incomplete`. Do not combine a blocked required task
with a no-op. Use `noop` only for completed inspection with no eligible action,
including a verified cooldown, cap or duplicate deferral. Cite the policy and
eligibility evidence; a known cooldown is not missing data or a missing tool.
Keep uninspected scope explicit without claiming complete coverage. Never turn
a failed check or unknown eligibility into a successful no-work result.

Prioritize critical security exposure, actionable feedback on existing role PRs,
repairable bot PRs, then useful uncovered updates. Consider age and benefit;
leave a permanently blocked PR for a relevant evidence change. Diagnose CI
failures from their logs and distinguish update regressions from unrelated or
transient failures before changing code or requesting a justified rerun.

Prefer repairing the original same-repository bot PR. Use the pre-fetched origin
branch with the same local branch name and preserve its head as the incremental
baseline. Append fixes without rewriting bot or human commits. Respect the
configured publisher's reconciliation, refusal and recovery behavior when the
live head advances. Inspect its actual result before claiming delivery or
attempting further work; do not retry an uncertain write blindly.
If the configured tools cannot safely repair an existing PR, retain its URL,
observed head, actionable findings and blocking capability in the activation
outcome for the existing PR shepherd to resume under human authorization. Do not
open a replacement, trigger another agent or claim completed recovery. Preserve
human edits and pending review requests; missing initial human-review delivery
remains this role's responsibility under local policy. Apply the outcome rules
above without invalidating unrelated deliverable work.

Regenerate artifacts using the candidate's pinned toolchain. Publication follows
the caller's configured file policy and supported transport. Workflow changes
may be proposed when that policy permits them; they still require ordinary CI,
independent review and human approval. Unsupported changes or artifact transport
are explicit human blockers. Do not
publish new Git LFS pointers: the pinned native transport does not upload their
objects. Inspect Git attributes for affected files before choosing publication.

Do not undertake major migrations, incompatible parent upgrades, broad product
refactors, public contract, auth or billing decisions. Explain the blocker and
clearing action in the activation outcome. Critical severity changes priority,
never grants a cooldown bypass. Human-directed exceptions remain outside this
role. Never approve, merge, delete branches, close existing PRs, change bot ignore
settings, mutate issues or direct production operations.
