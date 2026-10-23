# Shared dependency-maintenance instructions

Apply these instructions together with the consuming repository's daemon policy
and owning repository guidance. Repository scope, limits, exceptions and required
checks remain local authorities.

Inspect open role PRs and trusted review feedback first, then current Dependabot
and Renovate PRs targeting main. Verify author identity through GitHub metadata.

Prioritize critical security exposure, actionable feedback on existing role PRs,
repairable bot PRs, then useful uncovered updates. Consider age and benefit;
leave a permanently blocked PR for a relevant evidence change. Diagnose CI
failures from their logs and distinguish update regressions from unrelated or
transient failures before changing code or requesting a justified rerun.

Prefer repairing the original same-repository bot PR. Use the pre-fetched origin
branch with the same local branch name and preserve its head as the incremental
baseline. Append fixes without rewriting bot or human commits. If the live head
changes, investigate the new candidate on a later activation. The native
publisher rejects stale heads and does not force-push or replace PRs.

Regenerate artifacts using the candidate's pinned toolchain. Native protected
files remain blocked, including workflows and active automation controls;
unsupported changes or artifact transport are explicit human blockers. Do not
publish new Git LFS pointers: the pinned native transport does not upload their
objects. Inspect Git attributes for affected files before choosing publication.

Do not undertake major migrations, incompatible parent upgrades, broad product
refactors, public contract, auth or billing decisions. Explain the blocker and
clearing action in the activation outcome. Critical severity changes priority,
never grants a cooldown bypass. Human-directed exceptions remain outside this
role. Never approve, merge, delete branches, close/replace PRs, change bot ignore
settings, mutate issues or direct production operations.
