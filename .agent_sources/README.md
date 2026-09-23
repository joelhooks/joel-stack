# Agent source mirrors

Shallow git trees for source-first agent work. **Not runtime dependencies.** Populate:

```bash
./scripts/vendor-agent-sources.sh
./scripts/vendor-agent-sources.sh --refresh   # replace existing mirrors
```

Layout: `.agent_sources/github.com/<owner>/<repo>/` with `.agent-source.json` metadata per mirror.

## Inventory (core template libs)

Refs below are derived from the workspace `package.json` pins by `scripts/vendor-agent-sources.sh`; the table records what that resolves to today. The script also links `.agent-sources/effect` (read by the `pi-effect` tool) to the Effect mirror.

| Path | Upstream | Ref | Why |
| --- | --- | --- | --- |
| `github.com/Effect-TS/effect` | https://github.com/Effect-TS/effect.git | `effect@4.0.0-rc.117` | Effect v4 Schema, Context.Service, Config, platform-node, CLI, `@effect/vitest` |
| `github.com/kitlangton/effect-solutions` | https://github.com/kitlangton/effect-solutions.git | `main` | Idiomatic Effect patterns (Kit) |
| `github.com/statelyai/xstate` | https://github.com/statelyai/xstate.git | `xstate@6.0.0-alpha.59` | XState v6 core plus `packages/xstate-effect` (the `@xstate/effect` bridge and its docs) |
| `github.com/alchemy-run/alchemy` | https://github.com/alchemy-run/alchemy.git | `v2.0.0-beta.79` | Alchemy resources, Cloudflare and AWS providers, Effect-native Stack API |
| `github.com/better-auth/better-auth` | https://github.com/better-auth/better-auth.git | `better-auth@1.6.2` | Better Auth core, adapters, and plugins behind `packages/auth` |
| `github.com/TanStack/router` | https://github.com/TanStack/router.git | `@tanstack/react-start@1.166.15` | TanStack Start and Router behind `apps/web`; the router packages sit at that commit, not at the `@tanstack/react-router` pin |

**Not vendored here:** product-specific corpora (for example `xai-org/x-algorithm`). Add those in the consuming app's vendor script.

**Not vendored:** `Effect-TS/effect-smol` — archived; V4 source is only in `Effect-TS/effect`.

Inspect before non-trivial Effect or XState edits. Prefer these mirrors over `node_modules` for API shape and examples.
