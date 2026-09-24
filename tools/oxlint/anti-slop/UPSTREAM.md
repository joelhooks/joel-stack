# Upstream

Vendored from [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at commit `c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b` (2026-09-10), using that commit's `install-anti-slop` skill assets. MIT licensed; see `LICENSE`.

These files are ours now. Change a rule when it stops matching how rat-stack works, and record the change here. To take upstream fixes, follow the upstream `install-anti-slop` skill's update procedure: stage the new revision beside this copy and merge, never overwrite.

## Local changes

- 2026-09-24, `rules/no-unknown-parameters.ts`: the first parameter of a promise rejection handler (the second argument to `.then`, or the argument to `.catch`) is exempt, whatever its name. It is the function form of a `catch` clause and receives `unknown` by nature. Without this, the rule (which exempted only `cause`) and Ultracite's `unicorn/catch-error-name` (which requires `error`) could not both pass. Tests: `packages/core/test/unknown-parameters-rule.test.ts`.
- 2026-09-24, `shared/dictionary-types.ts`: the intersection branch returns its first unsafe member through a destructured binding, so it typechecks under `noUncheckedIndexedAccess`. Behavior unchanged. The whole `tools/oxlint` tree is now in the root `//#typecheck-scripts` gate. Found by drovr.
