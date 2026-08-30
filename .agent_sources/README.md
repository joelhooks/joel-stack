# Agent source mirrors

Shallow git trees for source-first agent work. **Not runtime dependencies.** Populate:

```bash
./scripts/vendor-agent-sources.sh
./scripts/vendor-agent-sources.sh --refresh   # replace existing mirrors
```

Layout: `.agent_sources/github.com/<owner>/<repo>/` with `.agent-source.json` metadata per mirror.

## Inventory (core template libs)

| Path | Upstream | Ref | Why |
| --- | --- | --- | --- |
| `github.com/Effect-TS/effect` | https://github.com/Effect-TS/effect.git | `effect@4.0.0-rc.110` | Effect v4 Schema, Context.Service, platform-node, CLI |
| `github.com/kitlangton/effect-solutions` | https://github.com/kitlangton/effect-solutions.git | `main` | Idiomatic Effect patterns (Kit) |
| `github.com/statelyai/xstate` | https://github.com/statelyai/xstate.git | `xstate@5.32.5` | Lifecycle machines |

**Not vendored here:** product-specific corpora (for example `xai-org/x-algorithm`). Add those in the consuming app's vendor script.

**Not vendored:** `Effect-TS/effect-smol` — archived; V4 source is only in `Effect-TS/effect`.

Inspect before non-trivial Effect or XState edits. Prefer these mirrors over `node_modules` for API shape and examples.
