# rat-stack 🐀

[![CI](https://github.com/joelhooks/rat-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/joelhooks/rat-stack/actions/workflows/ci.yml)

Joel's **agentic scaffold** for an Effect app (CLI, XState lifecycles, Alchemy infra, varlock config): why in `VISION.md` / `AGENTS.md`, fence in pins + checks + hooks. Public tree is steal-the-ideas, not a supported product. It ships as a **pnpm + Turborepo workspace** with a real Effect v4 CLI, tests, formatting, type-aware linting, and vendored source mirrors for Effect, effect-solutions, XState, and Alchemy.

The shape it teaches: define a **Capability** once (Effect Schema in, out, and failure; an Effect handler; read-only / destructive / approval annotations) and project it onto every agent surface. The same `inspectFile` capability is the `stats` command, `POST /inspectFile` with an OpenAPI document, and an MCP tool over stdio.

## Create a repository

```sh
gh repo create <name> --template joelhooks/rat-stack
```

Clone the new repository, then install and verify it:

```sh
nvm use
pnpm install
pnpm vendor:agent-sources
pnpm turbo run check test build
```

Node `24.18.0` and pnpm `11.3.0` are required. The requirement is declared in `.nvmrc`, `engines`, `devEngines`, and `packageManager`.

## Workspace layout

| Path | Package | Role |
| --- | --- | --- |
| `apps/cli` | `@rat-stack/cli` | Composition root: `stats`, `openapi`, `serve`, `mcp` |
| `packages/capability` | `@rat-stack/capability` | `defineCapability` plus `toCommand`, `toHttpApi`, `toToolkit` |
| `packages/core` | `@rat-stack/core` | Domain example: the `inspectFile` capability and its lifecycle machine |
| `apps/infra` | `@rat-stack/infra` | Alchemy Stack (Cloudflare by default) |
| `.agent_sources/` | — | Shallow upstream mirrors (gitignored clones; see README there) |

## Try the example CLI

The included `stats` command counts bytes, Unicode characters, words, and lines in a file:

```sh
pnpm cli stats README.md
pnpm cli stats README.md --json
```

After `pnpm build`, you can run the built entrypoint directly:

```sh
node apps/cli/dist/cli.js stats README.md
```

The same capability on the other surfaces:

```sh
pnpm cli openapi                 # OpenAPI 3.1 document for the REST projection
pnpm cli serve --port 3000       # POST /inspectFile, GET /openapi.json, GET /docs
pnpm cli mcp                     # MCP server over stdio, one tool per capability
pnpm cli mcp --code-mode         # MCP server with two tools: search and execute
pnpm cli catalog --types         # the `tools` declarations a code-mode program sees
```

Code mode is the fourth projection. The model gets `search` (ranked matches with TypeScript signatures) and `execute` (a JavaScript program with `tools` in scope). The program runs in a fresh Node subprocess under `--permission`, so it cannot touch the file system or spawn processes; its only way out is `tools.<name>(input)`, which the host validates against that capability's input schema and runs through the same handler as every other surface. Network egress is not blocked by Node's permission model; put a Worker or Deno runtime behind the same `Sandbox` service for real isolation.

`packages/capability/src` is where a capability becomes a `Command`, an `HttpApiEndpoint`, a `Tool`, and a catalog entry. `packages/core/src/inspect-file.ts` is the one capability shipped; add another to `capabilities` and every command picks it up.

## What is in the stack?

- **pnpm workspaces + Turborepo `2.10.13`** — cached `typecheck` / `test` / `build` across packages from day one.
- **Effect `4.0.0-rc.115`** — typed runtime, errors, filesystem service, and the three surfaces the capabilities project onto: `effect/unstable/cli`, `effect/unstable/httpapi` (with `OpenApi.fromApi`), and `effect/unstable/ai` (`Toolkit` + `McpServer`).
- **`@effect/platform-node` `4.0.0-rc.115`** — Node-backed services; keep adapter and core pins matched.
- **TypeScript `7.0.2`** — strict module and index-access checks.
- **XState `6.0.0-alpha.58`** — real lifecycle states; do not replace those with boolean soup.
- **`@xstate/effect` `0.1.0-alpha.2`** — the official XState v6 to Effect 4 bridge: `createEffectActor` runs a machine as a scoped Effect, `fromEffect` makes Effects into actors with typed failures and requirements. `apps/cli/src/inspect-machine.ts` is the example. Vendored in `vendor/` until its npm publish lands.
- **Alchemy `2.0.0-beta.78`** — [Infrastructure as Effects](https://alchemy.run): `apps/infra/alchemy.run.ts` is the Stack; `pnpm infra:plan` / `infra:deploy` / `infra:destroy`; auth via `pnpm alchemy profile edit`.
- **Oxlint + Ultracite + Oxfmt** — native lint and format.
- **Vitest `5.0.1` + `@effect/vitest` `4.0.0-rc.115`** — `it.effect` and `it.layer` for every Effect test; running Effects by hand in a test file is a lint error.
- **`@effect/tsgo` `0.45.0`** — patches TypeScript 7 in `prepare` so Effect language-service diagnostics (leaked requirements, `any`/`unknown` in channels, global Date/fetch/console inside Effect, Node built-ins where Effect has a service) fail `tsc`.
- **varlock `1.19.0`** — `.env.schema` declares every variable with `@env-spec` decorators; `pnpm check` runs `varlock load`, secrets stay in gitignored `.env.local`.
- **Vendored agent sources** — Effect, [effect-solutions](https://github.com/kitlangton/effect-solutions), XState, [Alchemy](https://github.com/alchemy-run/alchemy) via `./scripts/vendor-agent-sources.sh` (not x-algorithm; that stays app-specific).
- **Agent fence** — lefthook pre-commit + Pi/Cursor/Claude hooks that block `git … --no-verify`. Cheating should be uncomfortable and obvious.

Every dependency is pinned exactly. Upgrade pins as a reviewed stack change, not ambient drift.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Check TypeScript without emitting files |
| `pnpm check` | Typecheck, check formatting, and run type-aware linting |
| `pnpm fix` | Apply Oxfmt and safe Oxlint fixes |
| `pnpm test` | Run the Vitest suite once |
| `pnpm build` | Compile packages into `dist/` |
| `pnpm cli -- ...` | Build and run the CLI |
| `pnpm vendor:agent-sources` | Clone core lib mirrors |
| `pnpm turbo run check test build` | Cached verification pipeline |

## Agentic surface

Every clone includes `AGENTS.md` for repo law and commands, `CLAUDE.md` as Claude Code's pointer to that law, and `VISION.md` for project intent. Source mirrors live under `.agent_sources/` after you run the vendor script. Repo-local Pi extensions belong in `.pi/extensions/`.

## Make it yours

1. Rename workspace package names and the `bin` entry.
2. Rename the root command and version in `apps/cli/src/command.ts`.
3. Replace `packages/core` stats and its tests with one useful vertical slice.
4. Keep expected failures typed and map them to deliberate exit codes.
5. Run `pnpm turbo run check test build` before the first push.

## License

MIT
