# Shared automation

Read README.md before editing. Keep this repository generic and public: use
synthetic fixtures; do not add private repository names, tracker URLs,
credentials, transcripts or live usage reports to source or documentation.

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

Use GH-AW through its supported configuration and documented extension points.
Do not add or extend generated-workflow rewrites, downloaded-runtime patches,
or integrations with private GH-AW helpers. Existing corrections are migration
debt, not a pattern to copy. Use the caller's agreed security requirements;
accept native reconciliation, fallback and partial outcomes unless a demonstrated
security boundary requires otherwise. Workflow and security-file edits may be
proposed in PRs requiring CI, AI review and human approval; file exclusion is not
a mandatory publisher boundary. Record unsupported necessary boundaries
and reassess the platform instead of adding another compatibility patch.
Keep investigation, work selection and quality judgments with agents.
New executable dependencies and release assets must meet the caller's 14-day
supply-chain cooldown; distinguish a prerelease from a stable release.
