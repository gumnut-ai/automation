# Shared codebase-maintainer instructions

Apply these instructions together with the consuming repository's daemon policy
and owning repository guidance. Repository scope, limits, exceptions and required
checks remain local authorities.

- Propose only behavior-preserving cleanup with a concrete maintenance benefit.

- Preserve supported functionality, public contracts, tests, and dependency policy.
- Cite evidence that removed code is unreachable or that the simplified abstraction
  is redundant, including relevant callers and dynamic registration paths.

## Improving the codebase
Understand the relevant code, callers, tests, and repository conventions before
choosing a change. Focus the session on the current implementation: inspect a
promising area and trace its callers and tests before concluding there is no
worthwhile improvement. Use PR history to check a specific candidate for overlap
or prior rejection, rather than auditing all past maintenance work. A no-op
should explain the current code inspected and why changing it would not help.
Look for concrete maintenance costs, not just code that could be written
differently. Use these perspectives with judgment:

- **Reuse:** search for an existing helper, constant, type, or component before
  creating another. Consolidate copies that encode the same rule and could
  drift; preserve separate implementations with genuinely different contracts.
- **Simplification:** remove derivable state, repeated normalization, wrappers
  with no useful contract, identical branches, and unnecessary abstractions.
  Keep validation at real trust boundaries and guards needed by other callers.
- **Responsibility:** put a rule in the layer that owns it. Prefer a bounded fix
  to the shared mechanism over another caller-specific flag or compensating
  lifecycle protocol. Do not turn a local cleanup into a speculative redesign.
- **Minimalism:** remove redundant locals, unnecessary defensive copies, and
  comments that merely restate code. Preserve rationale and hidden constraints;
  shorter code is not necessarily clearer.

Compare the candidate with doing nothing and with the smallest useful change.
Callers and future maintenance should become meaningfully simpler; introducing
new indirection or options merely to hide duplication is not an improvement.
Verify behavioral equivalence, including supported cases the current tests may
not cover. In the PR, explain the concrete cost removed and why the new shape is
better; passing tests alone is not evidence of maintenance value. If the simpler
solution would change supported behavior or a public contract, report the
tradeoff for human judgment rather than implementing it.

## Thresholds
Propose a change when its concrete maintenance benefit outweighs its complexity
and review cost. Size is not a quota: a small change can remove a real drift risk
or clarify ownership. Avoid cosmetic churn, equally complex rewrites, and edits
made merely to produce a PR. Report a no-op only after completed discovery finds
no worthwhile improvement.
Blocked or unfinished discovery must emit report_incomplete, even with no edits.

Before editing, paginate existing open maintenance PRs and inspect their diffs.
Do not duplicate pending work from any executor or recreate a closed unmerged
proposal without material new evidence.
