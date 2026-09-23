# Provenance

rat-stack bans comments in code (see AGENTS.md). Credit for borrowed code lives here instead.

| Code | Origin | Notes |
| --- | --- | --- |
| `scripts/oxlint-plugin-xstate-effect.ts` | [statelyai/xstate](https://github.com/statelyai/xstate) `scripts/oxlint-plugin-xstate-effect.mjs` at `xstate@6.0.0-alpha.58` (commit `0748e1b`), MIT | Ported onto the typed `@oxlint/plugins` API with the same behavior. Diff the logic against upstream when refreshing. |
| `scripts/oxlint-plugin-effect-tests.ts` | [t3code](https://github.com/pingdotgg/t3code) `oxlint-plugin-t3code/rules/no-manual-effect-runtime-in-tests.ts` | Adapted. |
| `packages/core/src/config-service.ts` | [opencode](https://github.com/sst/opencode) `packages/opencode/src/effect/config-service.ts` | Pattern moved onto the Effect 4 API. |
| `packages/capability/src/catalog.ts` | Executor's kernel IR and Cloudflare's Code Mode | Types for the code-mode `tools` object are generated from JSON Schema, never from Effect internals. |
| `packages/capability/test/mcp-harness.ts` | Effect's own `McpServer` tests | The server layer becomes a web handler; a fetch shim keeps the session headers. |
| `tools/oxlint/anti-slop/` | [dmmulroy/anti-slop](https://github.com/dmmulroy/anti-slop) at `c44ef22`, MIT | Vendored and owned; see `UPSTREAM.md` there. Its files keep upstream's comments. |

## Rule limits worth knowing

`xstate-effect/no-inline-effect` flags an Effect created inside an inline enqueue callback or passed inline to `enq.spawn(...)`. It matches the enqueue parameter by name (`enq` or `enqueue`) and recognizes an Effect only by its root identifier `Effect`. So `enq(() => Effect.log("x"))` is reported, but an Effect from a helper (`enq(() => makeEffect())`), a renamed namespace import, or a `Stream` or `Layer` root is not. Widening it needs type information. | `scripts/oxlint-plugin-patterns.ts`, `no-hand-rolled-surface` and `no-browser-globals-on-server` in `scripts/oxlint-plugin-boundaries.ts` | [foldkit/foldkit](https://github.com/foldkit/foldkit) `packages/oxlint-plugin-foldkit` at `95fed7f`, MIT | Rule ideas translated to rat-stack's nouns and rewritten on `@oxlint/plugins`; no code copied. Mapping in `.brain/projects/rat-devtools.svx`. | | `packages/devtools` | [foldkit/foldkit](https://github.com/foldkit/foldkit) `packages/devtools-mcp` at `95fed7f`, MIT | Tool shapes, path alphabet, and summary format follow Foldkit's devtools MCP; the implementation is ours. |
