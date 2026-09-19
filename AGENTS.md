# Agent instructions

This file is the repo law for agents and contributors. Keep commands, validation rules, architecture constraints, and project-specific stop rules here. Read `VISION.md` for product intent before planning substantial work. `VISION.md` is not permission to bypass this file. Pi sessions also load `.pi/APPEND_SYSTEM.md` (project context) and the live repo-local extension `.pi/extensions/project.ts`.

## Stack contract

The pinned stack is declared in workspace `package.json` files and summarized in [README.md](./README.md#what-is-in-the-stack). Keep dependencies exact. Repo-local config wins; note drift instead of silently migrating the project.

- pnpm workspaces + Turborepo (`apps/*`, `packages/*`)
- Node `>=24.18.0` and pnpm `11.3.0`; do not replace pnpm with Bun or npm for installs
- Effect `4.0.0-rc.115` and `@effect/platform-node` `4.0.0-rc.115`
- XState `6.0.0-alpha.58` for finite lifecycles, retries, cancellation, and resumability
- `@xstate/effect` `0.1.0-alpha.2` bridges the two: machines run as scoped Effects via `createEffectActor`, side effects are declared `fromEffect` actors. Vendored as a tarball in `vendor/` until npm has it; see `vendor/README.md` for the swap rule
- Alchemy `2.0.0-beta.78` (Infrastructure as Effects) for every cloud resource; declared in `apps/infra/alchemy.run.ts`, authenticated through Alchemy profiles, never through env vars in this repo
- TypeScript `7.0.2` in strict mode, patched by `@effect/tsgo` `0.45.0` in `prepare` so the Effect language service diagnostics in `tsconfig.base.json` fail `tsc`, not just the editor. Escape hatch for a real boundary: `// @effect-diagnostics-next-line <rule>:off` with a reason
- `@effect/vitest` `4.0.0-rc.115` for every Effect test: `it.effect` and `it.layer(layer)`; `Effect.run*` and `ManagedRuntime.make` in test files are a lint error
- `@oxlint/plugins` `1.83.0` for the two typed lint rules in `scripts/oxlint-plugin-*.ts`
- Oxlint `1.83.0` with Ultracite `7.12.0`, Oxfmt `0.68.0`, and Turborepo `2.10.13`
- varlock `1.19.0`: declare every env var in `.env.schema`, never read `.env.local` directly, run `pnpm env:check` after schema edits

## Packages

| Package | Path | Role |
| --- | --- | --- |
| `@rat-stack/capability` | `packages/capability` | `defineCapability` and the projections `toCommand`, `toHttpApi`, `toToolkit`, `toCodeMode` (catalog, `search`/`execute`, subprocess `Sandbox`) |
| `@rat-stack/core` | `packages/core` | Domain logic: the `inspectFile` capability, its lifecycle machine, `FileInspector` |
| `@rat-stack/cli` | `apps/cli` | Composition root: `stats`, `catalog`, `openapi`, `serve`, `mcp [--code-mode]` commands |
| `@rat-stack/infra` | `apps/infra` | Alchemy Stack: the project's cloud footprint as one Effect program |

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install workspace dependencies |
| `pnpm check` | Typecheck, verify formatting, and run type-aware linting |
| `pnpm fix` | Apply Oxfmt and safe Oxlint fixes |
| `pnpm test` | Build and run the Vitest suite once |
| `pnpm build` | Compile packages into `dist/` |
| `pnpm typecheck` | `turbo run typecheck` |
| `pnpm vendor:agent-sources` | Shallow-clone Effect, effect-solutions, xstate, and alchemy mirrors |
| `pnpm infra:plan` | Preview the Alchemy Stack diff without applying |
| `pnpm infra:deploy` / `pnpm infra:destroy` | Apply or tear down the Stack (asks for approval) |
| `pnpm exec lefthook install` | Install git hooks (also via `prepare`) |
| `pnpm turbo run check test build` | Required validation before claiming a change is ready |

Run `pnpm fix` only when you intend to rewrite files. Finish with `pnpm turbo run check test build`.

## Fence (cheating is uncomfortable)

Why lives in `AGENTS.md` / `VISION.md`. The stack and hooks are the enforceable fence. Fence wins over prose.

- Lefthook pre-commit runs `pnpm check` and `pnpm test`
- Agents must not use `git … --no-verify` (or equivalent hook bypass)
- Blocked by: Pi `.pi/extensions/git-interceptor`, Cursor `.cursor/hooks.json`, Claude Code `.claude/settings.json`
- Policy source: `scripts/vcs-command-policy.js`

If a hook fails, fix the failure. Do not disable the fence.

## Source-first Effect / XState work

Before writing, reviewing, or refactoring Effect or XState code, read `node_modules/effect/AGENTS.md` first: it ships with the installed version, so it is never stale. Then inspect vendored source for the pinned versions. Populate mirrors:

```sh
pnpm vendor:agent-sources
# or
./scripts/vendor-agent-sources.sh --refresh
```

Inventory: [`.agent_sources/README.md`](./.agent_sources/README.md).

| Need | Path |
| --- | --- |
| Effect Schema, Context.Service, CLI | `.agent_sources/github.com/Effect-TS/effect/` |
| Idiomatic Effect | `.agent_sources/github.com/kitlangton/effect-solutions/` |
| XState | `.agent_sources/github.com/statelyai/xstate/` |
| `@xstate/effect` (v6 Effect bridge) | `.agent_sources/github.com/statelyai/xstate/packages/xstate-effect/` (`README.md`, `docs/`, `src/*.test.ts`) |
| Alchemy resources, Cloudflare, AWS | `.agent_sources/github.com/alchemy-run/alchemy/` and https://alchemy.run/llms.txt |

Refs are derived from the workspace pins, so bumping a package and re-running the script keeps them matched. The script also links `.agent-sources/effect` (what the `pi-effect` tool reads) to the pinned Effect mirror.

Mirrors are reference material, not runtime dependencies. Exclude them from typecheck, test, lint, and format. Do not vendor product-specific corpora in this template.

## Source control

Preserve existing work. Inspect status before editing, stage only files changed for the current task, and do not commit generated output, secrets, or populated `.agent_sources/github.com/` trees. Use the repository's existing source-control tool; do not initialize or migrate one without approval. Never pass `--no-verify` to git.

## Project law — fill in

<!-- TEMPLATE: Replace this comment with the product-specific rules that every contributor and agent must follow. Keep durable product intent in VISION.md, not here. -->

- [Name the rules that must remain true across implementations.]

## Architecture — fill in

<!-- TEMPLATE: Record the important module boundaries, dependency direction, data ownership, and state-machine seams. Link deeper docs instead of duplicating them. -->

- Domain / shared library code lives in `packages/*`. `packages/core/src/file-inspector.ts` is the reference service shape: a `Context.Service` class whose `make` captures its dependencies so its methods carry no requirements, with `static layer` beside it. `packages/core/src/config-service.ts` derives a service from Effect `Config` (production `layer` reads the ConfigProvider, `configLayer` takes parsed values for tests); `AppConfig` is the instance and mirrors `.env.schema`
- CLI composition root lives in `apps/cli`; `apps/cli/src/inspect-machine.ts` is the reference shape for a lifecycle: the machine owns states, declared `fromEffect` actors own side effects and typed failures, `join` plus `Effect.orDie` hands the outcome back to Effect
- Effect-backed machines start only under `createEffectActor`, never `createActor`. Only actions and actors declared in `setupEffect` contribute to the actor's requirements; the `xstate-effect/no-inline-effect` lint rule enforces the inline cases
- Dependency direction: apps → packages → Effect/XState. Packages do not import apps.

## Boundaries and sign-off — fill in

<!-- TEMPLATE: Name changes agents may make directly and changes that need owner approval. Include security, privacy, deployment, public API, dependency, and destructive-data boundaries when they apply. -->

- Safe by default: [small, tested changes that preserve the current contract]
- Needs owner sign-off: [product promises, architecture changes, risky operations, or scope expansion]
