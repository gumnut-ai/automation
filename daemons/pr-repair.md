# Shared existing-PR repair instructions

A role that publishes PRs also maintains its existing proposals. Apply this
alongside local scope, eligibility, limits, checks and human-review policy.

Before new overlapping work, inspect actionable CI and review feedback on open
same-repository PRs owned by this role. Verify ownership from author, scope and
history, not a label alone, and record the current head. Prefer a supported repair
over a competing proposal. Human direction and role exclusions still apply;
repair capability does not expand scope or authorize a rejected change.

For an eligible repair, use the actual fetched origin head-ref branch with the
same local name and retain its observed remote-tracking head as the incremental
baseline. Fetch the verified branch through read-only access when needed. Append
committed fixes without rebasing, force-pushing or otherwise rewriting existing
commits. Preserve human edits, PR identity and pending review requests. Validate
the complete candidate with the owning project's checks. Count repairs against
existing per-activation proposal and commit limits; open-PR creation caps do not
prevent maintaining an existing PR. Do not update a PR created in this activation.

Request the configured native branch-update output with the actual local branch
and explicit repository/PR number. Read back its result before claiming delivery.
If the remote head advances or the write is uncertain, reconcile actual GitHub
state before further work; do not blindly retry or open a replacement PR. A changed
head waits for exact-head CI and independent review before a later human handoff.
Never approve or merge PRs.

When the configured tools cannot safely finish, retain the existing PR URL,
observed head, actionable findings and blocking capability in the activation
outcome for the existing authorized shepherd. Preserve verified work and apply
the role's native outcome rules; blocked required work is incomplete, not a
successful no-op. Do not launch another agent or claim recovery has completed.
