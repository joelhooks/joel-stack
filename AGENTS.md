# Agent instructions

This file is the repo law for agents and contributors. Keep commands, validation rules, architecture constraints, and project-specific stop rules here. Read `VISION.md` for product intent before planning substantial work. `VISION.md` is not permission to bypass this file. Pi sessions also load `.pi/APPEND_SYSTEM.md` (project context) and the live repo-local extension `.pi/extensions/project.ts`.

## Stack contract

The pinned stack is declared in workspace `package.json` files and summarized in [README.md](./README.md#what-is-in-the-stack). Keep dependencies exact. Repo-local config wins; note drift instead of silently migrating the project.

- pnpm workspaces + Turborepo (`apps/*`, `packages/*`)
- Node `>=24.18.0` and pnpm `11.3.0`; do not replace pnpm with Bun or npm for installs
- Effect `4.0.0-rc.112` and `@effect/platform-node` `4.0.0-rc.112`
- XState `5.32.5` for finite lifecycles, retries, cancellation, and resumability
- TypeScript `7.0.2` in strict mode
- Oxlint `1.74.0` with Ultracite `7.9.4`, Oxfmt `0.59.0`, and Turborepo `2.10.5`
- varlock `1.19.0`: declare every env var in `.env.schema`, never read `.env.local` directly, run `pnpm env:check` after schema edits

## Packages

| Package | Path | Role |
| --- | --- | --- |
| `@ts-cli-template/core` | `packages/core` | Domain logic (example: file stats) |
| `@ts-cli-template/cli` | `apps/cli` | Effect CLI composition root |

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

Before writing, reviewing, or refactoring Effect or XState code, inspect vendored source for the pinned versions. Populate mirrors:

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

Mirrors are reference material, not runtime dependencies. Exclude them from typecheck, test, lint, and format. Do not vendor product-specific corpora in this template.

## Source control

Preserve existing work. Inspect status before editing, stage only files changed for the current task, and do not commit generated output, secrets, or populated `.agent_sources/github.com/` trees. Use the repository's existing source-control tool; do not initialize or migrate one without approval. Never pass `--no-verify` to git.

## Project law — fill in

<!-- TEMPLATE: Replace this comment with the product-specific rules that every contributor and agent must follow. Keep durable product intent in VISION.md, not here. -->

- [Name the rules that must remain true across implementations.]

## Architecture — fill in

<!-- TEMPLATE: Record the important module boundaries, dependency direction, data ownership, and state-machine seams. Link deeper docs instead of duplicating them. -->

- Domain / shared library code lives in `packages/*`
- CLI composition root lives in `apps/cli`
- Dependency direction: apps → packages → Effect/XState. Packages do not import apps.

## Boundaries and sign-off — fill in

<!-- TEMPLATE: Name changes agents may make directly and changes that need owner approval. Include security, privacy, deployment, public API, dependency, and destructive-data boundaries when they apply. -->

- Safe by default: [small, tested changes that preserve the current contract]
- Needs owner sign-off: [product promises, architecture changes, risky operations, or scope expansion]
