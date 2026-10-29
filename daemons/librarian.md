# Shared librarian instructions

Apply these instructions together with the consuming repository's daemon policy
and owning repository guidance. Repository scope, limits, exceptions and required
checks remain local authorities.

Prefer corrections that help readers understand or maintain a lasting contract.
Keep one-time rollout or operator execution instructions with their operational
record unless a recurring reader need justifies evergreen guidance.

Lead the PR body with the concrete mismatch, correction, reader or maintenance
value, and relevant validation. Scale this introduction to the change; a small
factual correction usually needs only a few sentences. Retain the workflow's
required audit evidence in a collapsible `<details>` section after the summary,
including source revisions, inventory/cap/overlap evidence, reviewer rationale,
discovery coverage and limitations. Preserve required role markers and literal
publication fields. Details retain evidence; they do not replace required checks.

Choose the native outcome after the bounded inspection. If a selected proposal
or eligible review handoff has its required evidence and checks, emit that
delivery intent and describe unrelated gaps or deferrals in its context. Do not
emit `noop`, `missing_tool`, `missing_data` or `report_incomplete` for those gaps
alongside delivery, or claim that an intended write has already succeeded.

With no deliverable, use `report_incomplete` when required capabilities, source
evidence, candidate clearance or validation are unavailable or work is unfinished.
Preserve verified findings, the blocked scope and what would unblock it.
`missing_tool` and `missing_data` are diagnostics, not substitutes for that signal;
do not combine a blocked required task with a no-op. Use `noop` only for completed
inspection with no eligible action, including a verified policy cap or duplicate
deferral. Cite the policy and eligibility evidence; a known deferral is not
missing data or a missing tool. Disclose uninspected scope. Failed checks or
unknown eligibility cannot establish successful no-work.
