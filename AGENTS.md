# Shared automation

Read README.md before editing. Keep this repository generic and public: use
synthetic fixtures; do not add private repository names, tracker URLs,
credentials, transcripts or live usage reports to source or documentation.
Keep organization-specific assessments and rollout decisions in private repos.

The existing admission, isolation and standing-review semantics are the
contract. Repository policies, secrets, gates, schedules and protected publisher
environments belong to callers. Keep the official Claude Action step directly
in callers until real App authentication has been validated for any replacement.

Run `npm test` for unit and packaging contracts. CI also runs the opt-in Linux
container transport/isolation suite with dummy credentials. Integration jobs
must stay read-only and provider-free. Pin third-party Actions to full SHAs.
Action inputs are data: pass them through environment variables into quoted
commands, never interpolate them into shell source.

Update README.md and examples when changing the caller interface. A shared
code update does not update consumers: each consumer pins an immutable commit
and needs its own reviewed update. Do not activate reviewers or merge PRs.

Use GH-AW through supported configuration and documented extension points. Do not
add generated-workflow rewrites, downloaded-runtime patches or production
integrations with private GH-AW helpers. Existing corrections are migration debt.
Keep policy judgments with agents and use native security/concurrency controls.
