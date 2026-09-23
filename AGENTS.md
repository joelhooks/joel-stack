# Agent instructions

This file is the repo law for agents and contributors. It holds commands, validation rules, architecture constraints, and project stop rules. Read `VISION.md` for intent before planning substantial work. `VISION.md` does not override this file. Pi sessions also load `.pi/APPEND_SYSTEM.md` and the repo-local extension `.pi/extensions/project.ts`.

## Stack contract

Workspace `package.json` files declare the pinned stack. [README.md](./README.md#what-is-in-the-stack) summarizes it. Keep dependencies exact. Repo-local config wins. Record drift instead of silently migrating the project.

- pnpm workspaces + Turborepo (`apps/*`, `packages/*`)
- Node `>=24.18.0` and pnpm `11.3.0`; do not replace pnpm with Bun or npm for installs
- Effect `4.0.0-rc.117` and `@effect/platform-node` `4.0.0-rc.117`
- XState `6.0.0-alpha.59` for finite lifecycles, retries, cancellation, and resumability
- `@xstate/effect` `0.1.0-alpha.2` bridges the two: machines run as scoped Effects via `createEffectActor`, side effects are declared `fromEffect` actors. Published to npm 2026-09-19; `vendor/README.md` keeps the rules for the next unpublished pin
- Alchemy `2.0.0-beta.79` (Infrastructure as Effects) for every cloud resource; declared in `apps/infra/alchemy.run.ts`, authenticated through Alchemy profiles, never through env vars in this repo
- TypeScript `7.0.2` in strict mode, patched by `@effect/tsgo` `0.45.0` in `prepare` so the Effect language service diagnostics in `tsconfig.base.json` fail `tsc`, not just the editor. Escape hatch for a real boundary: `// @effect-diagnostics-next-line <rule>:off` with a reason
- `@effect/vitest` `4.0.0-rc.117` for every Effect test: `it.effect` and `it.layer(layer)`; `Effect.run*` and `ManagedRuntime.make` in test files are a lint error
- `@oxlint/plugins` `1.83.0` for the two typed lint rules in `scripts/oxlint-plugin-*.ts` and the vendored [anti-slop](https://github.com/dmmulroy/anti-slop) rules in `tools/oxlint/anti-slop/` (all generic rules plus the Effect group, at `error`). The copy is ours; `UPSTREAM.md` there says where it came from and how to take upstream fixes
- Oxlint `1.83.0` with Ultracite `7.12.0`, Oxfmt `0.68.0`, and Turborepo `2.11.2`
- varlock `1.20.0`: declare every env var in `.env.schema`, never read `.env.local` directly, run `pnpm env:check` after schema edits

## Packages

| Package | Path | Role |
| --- | --- | --- |
| `@rat-stack/capability` | `packages/capability` | `defineContract`, `implement`, and the `toCommand`, `toHttpApi`, `toToolkit`, `toRpc`, and `toCodeMode` projections |
| `@rat-stack/core` | `packages/core` | Shared `inspectFile`, `search`, and `read` contracts; `inspectFile` handler, lifecycle machine, and `FileInspector` |
| `@rat-stack/database` | `packages/database` | Database cartridge: the `RunLog` service and the `DatabaseVendor` choice (D1 or Hyperdrive Postgres), with each vendor's schema, migrations, and resources |
| `@rat-stack/auth` | `packages/auth` | Better Auth cartridge over the chosen `DatabaseVendor`: `Auth`, `CurrentPerson`, and the RPC middleware that provides it; only `Unauthenticated` crosses the wire. `@rat-stack/auth/devtools` adds `runAsPerson`, the dev-only `rat_test_person` capability, and `testPersonLayer` |
| `@rat-stack/devtools` | `packages/devtools` | 🐀 devtools cartridge: `CallLog`, `record`, and the `rat_*` capabilities that list, read, dispatch, replay, and diff capability calls |
| `@rat-stack/cli` | `apps/cli` | Composition root: `stats`, `catalog`, `openapi`, `serve [--devtools]`, `mcp [--code-mode] [--devtools]` commands |
| `@rat-stack/infra` | `apps/infra` | Alchemy Stack: the project's cloud footprint as one Effect program |
| `@rat-stack/mischief` | `apps/mischief` | Cloudflare Worker: the public site, agent discovery, and sandboxed execute surface |

## Nouns

| Noun | Home | Runtime job |
| --- | --- | --- |
| Contract | `packages/core/src/contracts.ts` | Shared name, schemas, failure, annotations, and approval setting. |
| Capability | `packages/core/src/inspect-file.ts` or `apps/mischief/src/capabilities/<name>.ts` | Binds one contract to its server-side handler with `implement`. |
| Projection | `packages/capability/src/to-<surface>.ts` | Expose implemented capabilities on one runtime surface. |
| Cartridge | `packages/<name>/src/` | One Layer with its own infrastructure; it must pass the cartridge test in `VISION.md`. |
| Machine | `packages/core/src/<name>-machine.ts` | Own one finite domain lifecycle. |
| Feature | `apps/web/src/features/<name>/` | Thin route and view that read client atoms. |
| Client | `apps/web/src/client/<name>.ts` | Own AtomRpc queries, named commands, and the local replica. |

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install workspace dependencies |
| `pnpm check` | Typecheck, verify formatting, and run type-aware linting |
| `pnpm lint` | Type-aware lint plus format check only; `turbo run check` runs this once at the root as `//#lint` |
| `pnpm fix` | Apply Oxfmt and safe Oxlint fixes |
| `pnpm test` | Build and run the Vitest suite once |
| `pnpm build` | Compile package outputs |
| `pnpm typecheck` | `turbo run typecheck` |
| `pnpm vendor:agent-sources` | Shallow-clone Effect, effect-solutions, xstate, alchemy, and better-auth mirrors |
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

Before writing, reviewing, or refactoring Effect or XState code, read the installed Effect package's `AGENTS.md` first, for example `packages/core/node_modules/effect/AGENTS.md`. It ships with the installed version, so it is never stale. Then inspect vendored source for the pinned versions. Populate mirrors:

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

## Project law

A child project replaces this section on day one with its own product rules. These rules describe the rat-stack template, not the product in a clone. Keep durable product intent in `VISION.md`.

- One contract, every surface. Define schemas and metadata with `defineContract`; bind a server-side handler with `implement` and add the capability to `capabilities`. CLI, HTTP, MCP, RPC, and code mode are projections in `packages/capability`. Do not add a command, route, or tool handler that bypasses a capability.
- Schemas are the contract. Input, output, and failure are Effect `Schema`; JSON Schema, OpenAPI, and the code-mode declarations are derived from them, never hand-written.
- Lifecycles are machines. Finite modes, retries, and cancellation live in XState machines started with `createEffectActor`; side effects live in declared `fromEffect` actors, never inline.
- The sandbox is a surface, not a bypass. Anything reachable from a code-mode program must be a capability and goes through that capability's schemas and handler.
- Gardener rule: add a lint rule before cleaning up a bad pattern; lint baselines only shrink. The routine is `skills/gardener`; before simplifying or replacing a design, run `skills/uncomplect`.
- No comments in code. `no-comments/no-comments` (`scripts/oxlint-plugin-no-comments.ts`) bans them, after Lauren Tan's Dune rule: agents copy comments, and a comment that explains a workaround spreads the workaround. Say it in a name, a type, a test, a commit message, or the Brain. Two kinds survive: tool directives, with the reason inline after `--`, and a one-line `SAFETY:` invariant above a type assertion. Plain JS files keep JSDoc blocks made only of type tags (`@param {string} command`), because that is their type syntax; Ultracite's JSDoc description rules are off for the same reason. Credit for borrowed code lives in `PROVENANCE.md`.
- Diagnostic overrides are targeted and explained: `// @effect-diagnostics-next-line <rule>:off -- <reason>`. File-level overrides exist only at projection boundaries (`packages/capability/src/to-toolkit.ts`, `packages/capability/src/to-code-mode.ts`, `packages/capability/src/to-rpc.ts`) and in process-spawning test files.
- Lint overrides follow the same rule: `// oxlint-disable-next-line <rule> -- <reason>`. Every type assertion carries a one-line `SAFETY:` comment naming the invariant it relies on. `unicorn/throw-new-error` is off because `Schema.TaggedError(...)` looks like a throw to it. Anti-slop overrides exist only where a type is erased on purpose (the projections in `packages/capability`, the sandbox RPC boundary, the lint plugin's AST walker); anywhere else, parse the value at its boundary with Effect `Schema`.
- Pins stay exact. A vendored dependency carries a matching `minimumReleaseAgeExclude` entry and a removal rule in `vendor/README.md`.

## Architecture

A child project replaces this section on day one with its own architecture. Record module boundaries, dependency direction, data ownership, and state-machine seams here. Link deeper docs instead of duplicating them.

- `rat-stack-boundaries/no-cross-layer-imports` enforces dependency direction: `apps/cli` → `packages/core` → `packages/capability` → Effect/XState. Packages do not import apps; `packages/capability` does not import domain code; `apps/infra` owns its Stack wiring. `core` owns shared contracts and the `inspectFile` handler; each capability's owner keeps its handler beside its data or infrastructure. Core depends on `capability` for `defineContract` and `implement`.
- `rat-stack-boundaries/no-browser-server-imports` applies to `apps/*/src/features/**` and `apps/*/src/client/**`. Browser modules may import only `@rat-stack/core/contracts` and `@rat-stack/capability/rpc-group` from these packages; they cannot import handler modules. `rat-stack-boundaries/no-feature-transport` applies to `apps/*/src/features/**`.
- `rat-stack-boundaries/no-hand-rolled-surface` keeps `Rpc.make`, `RpcGroup.make`, `HttpApi*`, `Tool.make`, and `Toolkit.make` inside `packages/capability`; everything else projects contracts. `rat-stack-boundaries/no-browser-globals-on-server` keeps `window`, `document`, `navigator`, and web storage in `apps/*/src/client/**` and `apps/*/src/features/**`.
- `rat-stack-patterns` (`scripts/oxlint-plugin-patterns.ts`): `contract-binding-matches-name` (`const searchContract = defineContract("search", …)`), `no-module-level-mutable-state` (module `let`/`var` in `apps/*/src` and `packages/*/src` leaks across Worker requests), and `acquire-release-constructs-in-acquire-body` (build pools inside acquire, not before).
- `packages/core/src/file-inspector.ts` is the reference service shape: a `Context.Service` class whose `make` captures its dependencies so its methods carry no requirements, with `static layer` beside it. `packages/core/src/config-service.ts` derives a service from Effect `Config` (production `layer` reads the ConfigProvider, `configLayer` takes parsed values for tests); `AppConfig` is the instance and mirrors `.env.schema`.
- `packages/core/src/inspect-machine.ts` is the reference shape for a lifecycle: the machine owns states, declared `fromEffect` actors own side effects and typed failures, `join` plus `Effect.orDie` hands the outcome back to Effect. `packages/core/src/contracts.ts` owns `inspectFileContract`; `packages/core/src/inspect-file.ts` implements it and registers the capability.
- Effect-backed machines start only under `createEffectActor`, never `createActor`. Only actions and actors declared in `setupEffect` contribute to the actor's requirements; the `xstate-effect/no-inline-effect` lint rule enforces the inline cases.
- `packages/capability/src`: `contract.ts` defines shared contracts; `implement.ts` binds typed handlers and adds approval requirements; `to-command.ts`, `to-http-api.ts`, `to-toolkit.ts`, `to-rpc.ts`, and `to-code-mode.ts` project implemented capabilities. `to-rpc-group.ts` builds the contract-only client group; `to-rpc.ts` derives the server group from those same contracts. `catalog.ts`, `sandbox-service.ts`, and `sandbox-subprocess.ts` support code mode. `to-code-mode.ts` imports from `to-toolkit.ts`, so MCP is a prerequisite for code mode.
- Devtools are capabilities: `devtools(capabilities)` wraps each handler with `aroundHandlers` to record into `CallLog`, and adds the `rat_*` capabilities, so every projection shows them. `rat_call` dispatches through `invokerFor`, the same path code mode uses. Machines report to devtools through `watchActor` (`@rat-stack/capability/actor-watch`), a no-op `ActorWatch` reference that the recorder overrides; `rat-stack-patterns/watch-effect-actors` requires the call. `devtools(capabilities, { runAs })` records each call's identity and lets `rat_call` take `as`; the composition root passes `runAsPerson` from `@rat-stack/auth/devtools`, so devtools never imports auth. `--devtools` binds `127.0.0.1` only. Plan and tool list: `.brain/projects/rat-devtools.svx`.
- `apps/cli/src/surfaces.ts` is the only place projections are instantiated; `apps/cli/src/command.ts` maps them to subcommands; `apps/cli/src/cli.ts` is the single composition root that provides `FileInspector` and `NodeServices`.
- The [README's Keep or cut section](./README.md#keep-or-cut) lists what to delete per surface.

## Web feature blueprint

`apps/web/src/features/<name>/` holds a thin route and view. It reads atoms and calls named commands from `apps/web/src/client/<name>.ts`; components never handle transport, retries, or process startup. The client owns AtomRpc queries and the local replica. The capability in `packages/core` is the shared typed edge, imported by both sides. A cartridge owns durable behavior.

One send follows one path: feature → named client command → AtomRpc → shared capability → server-side Durable Object or database cartridge. The server stays authoritative. Mutations carry `reactivityKeys` so the client reconciles its replica.

## Boundaries and sign-off

A child project replaces this section on day one with its own boundaries. This section names changes agents may make directly and changes that need owner approval.

- Safe by default: adding a capability in `packages/core` and wiring it into `capabilities`; new or tightened tests; a targeted diagnostic override with a written reason; README, AGENTS.md, and `.brain/` edits; tightening a lint rule; removing a surface by following Keep or cut.
- Needs owner sign-off: adding or changing a dependency version (pins are exact and CI installs cold); any edit to `oxlint.config.ts`, the diagnostics map in `tsconfig.base.json`, `lefthook.yml`, or `scripts/vcs-command-policy.js` that loosens the fence; anything under `apps/infra` and any `pnpm infra:deploy` or `infra:destroy`; widening sandbox permissions or adding a runtime that reaches the network; exposing `serve` or `mcp` beyond localhost; vendoring a package as a `file:` tarball; deleting `.agent_sources/` or `vendor/`.
