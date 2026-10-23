# Native workflow compatibility

This directory owns shared compatibility with gh-aw v0.89.21, setup commit
`c35393777e5604a63721d09512263b1383301d4f`, and the existing integrity-locked
Codex 0.156.1 setup. It selects no repository policy, credentials, activation,
schedules, images, inference model or publisher environment.

`gh-aw-v0.89.21.cjs` exposes three source/generated-text transformations:

- `correctDetectorImages` propagates the caller's three digest-qualified AWF
  images into detector predownloads and its container configuration.
- `normalizeActionReferences` preserves reviewed source annotations and gives
  the immutable setup action a reproducible release label.
- `correctPublisherIssuesRead` restores Issues read in the two native publisher
  App-token steps, without changing any other requested permission.

JavaScript callers import the functions. Existing Python correction wrappers
can use the file interface, choosing only the operations they need:

```bash
node .shared-automation/native-toolchain/gh-aw-v0.89.21.cjs \
  .github/workflows/maintenance.md .github/workflows/maintenance.lock.yml \
  correctDetectorImages normalizeActionReferences correctPublisherIssuesRead
```

Use an immutable shared checkout matching the caller's shared dependency
compiler or runtime action. All requested corrections validate before the file
is written. An error leaves native output unvalidated; do not commit or deploy
it. Unknown compiler versions, setup references or correction shapes fail closed.
Caller-specific reviewer policy, environment isolation and selected action
versions remain in the caller's existing wrapper. This is a compatibility
library, not another workflow compiler.

## Prefer native declarations

Admission needs no generated-code permission patch. Declare its existing read
scopes directly under `on.permissions`; the pinned compiler merges them into
`pre_activation`. The shared dependency compiler verifies that declaration and
the generated scopes. Use native permissions for new workflows too.

The pinned binary rejects `safe-outputs.github-app.permissions.issues` in source
frontmatter even though its internal token builder has override support. Keep
the publisher correction until a reviewed native release accepts the declaration
and emits Issues read in both publisher jobs. The scope is needed because native
reviewer label filtering calls the Issues API.

## Upstream evidence and removal conditions

- Detector pin propagation: the pinned [threat detector constructor](https://github.com/github/gh-aw/blob/c35393777e5604a63721d09512263b1383301d4f/pkg/workflow/threat_detection_external.go)
  copies the sandbox version but drops caller images. Remove this correction
  when actual compilation preserves selected digests in both image downloads
  and AWF configuration.
- Publisher label access: the pinned [reviewer handler](https://github.com/github/gh-aw/blob/c35393777e5604a63721d09512263b1383301d4f/actions/setup/js/add_reviewer.cjs)
  uses label filtering through the Issues API. Remove the correction after
  source configuration produces the same minimal token scopes in both jobs.
- Action annotations: the pinned [reference formatter](https://github.com/github/gh-aw/blob/c35393777e5604a63721d09512263b1383301d4f/pkg/workflow/action_reference.go)
  can use a SHA as its readable version. Remove normalization when online and
  offline compilation consistently preserve reviewed source annotations.

Test any native upgrade against real consumer regeneration before deleting a
workaround. The goal is to remove compatibility code as native support permits.

## Locked runtime setup

`actions/codex-runtime` packages the existing manifest and platform integrity
lock in `codex-runtime/`. It has no inputs and invokes no provider. The command
and native detector discovery path remain stable. See the [runtime contract](codex-runtime/README.md).
Consumers already using native setup can continue to do so; this action replaces
only existing copies of the locked installation.
