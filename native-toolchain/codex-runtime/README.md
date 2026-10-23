# Native Codex runtime

`actions/codex-runtime` has no inputs or outputs. On a fresh runner it installs
the committed npm manifest and lock with scripts disabled, using an empty
temporary HOME and an isolated runner cache. Installation runs outside the
consumer checkout, so consumer npm configuration is not loaded. The manifest
and lock pin both the JavaScript wrapper and optional platform binaries.

The native gh-aw runtime command remains
`$RUNNER_TEMP/gh-aw/codex-runtime/node_modules/.bin/codex`; native detector
discovery uses the link at
`$RUNNER_TOOL_CACHE/scheduled-care-codex/0.156.1/bin/codex`.
Existing package trees or discovery links cause a failure instead of reuse.
The caller retains its native `engine.version` and provider configuration.

This overrides the native npm installer because the reviewed wrapper/platform
binary lock must control installation with lifecycle scripts disabled. Remove
the override when the native installer provides that same locked, script-free
installation and its detector plus sandbox discovery have been verified.
The action checks `codex --version`; it makes no inference or provider calls.

Run focused provider-free fixture tests with
`node --test native-toolchain/codex-runtime/*.test.cjs`.
