# rat-stack 🐀

[![CI](https://github.com/joelhooks/rat-stack/actions/workflows/ci.yml/badge.svg)](https://github.com/joelhooks/rat-stack/actions/workflows/ci.yml)

Joel's **agentic scaffold** for an Effect app. `VISION.md` explains why. `AGENTS.md` defines the fence through exact pins, checks, and hooks. The public tree is for stealing ideas, not a supported product. It ships as a **pnpm + Turborepo workspace** with a real Effect v4 CLI, tests, formatting, type-aware linting, and vendored source mirrors for Effect, effect-solutions, XState, and Alchemy.

The shape it teaches: define a **Contract** once (Effect input, output, and failure schemas plus annotations), bind a server-side handler, then project that capability onto every agent surface. The same `inspectFile` capability is the `stats` command, `POST /inspectFile` with an OpenAPI document, and an MCP tool over stdio.

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
| `packages/capability` | `@rat-stack/capability` | `defineContract`, `implement`, and the `toCommand`, `toHttpApi`, `toToolkit`, `toRpc`, and `toCodeMode` projections |
| `packages/core` | `@rat-stack/core` | Domain example: the `inspectFile` contract, handler, and lifecycle machine |
| `apps/infra` | `@rat-stack/infra` | Alchemy Stack (Cloudflare by default) |
| `apps/mischief` | `@rat-stack/mischief` | Cloudflare Worker for the public site, agent discovery, and sandboxed execute |
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

`packages/capability/src` is where a capability becomes a `Command`, an `HttpApiEndpoint`, a `Tool`, and a catalog entry. `packages/core/src/inspect-file.ts` is the one capability shipped. Add another to `capabilities`, then verify every projection you keep; CLI command registration lives in `apps/cli/src/command.ts`.

## What is in the stack?

- **pnpm workspaces + Turborepo `2.11.2`**: cached `typecheck` / `test` / `build` across packages from day one.
- **Effect `4.0.0-rc.116`**: typed runtime, errors, filesystem service, and the three surfaces the capabilities project onto: `effect/unstable/cli`, `effect/unstable/httpapi` (with `OpenApi.fromApi`), and `effect/unstable/ai` (`Toolkit` + `McpServer`).
- **`@effect/platform-node` `4.0.0-rc.116`**: Node-backed services; keep adapter and core pins matched.
- **TypeScript `7.0.2`**: strict module and index-access checks.
- **XState `6.0.0-alpha.58`**: real lifecycle states; do not replace those with boolean soup.
- **`@xstate/effect` `0.1.0-alpha.2`**: the official XState v6 to Effect 4 bridge: `createEffectActor` runs a machine as a scoped Effect, `fromEffect` makes Effects into actors with typed failures and requirements. `packages/core/src/inspect-machine.ts` is the example.
- **Alchemy `2.0.0-beta.79`**: [Infrastructure as Effects](https://alchemy.run): `apps/infra/alchemy.run.ts` is the Stack; `pnpm infra:plan` / `infra:deploy` / `infra:destroy`; auth via `pnpm alchemy profile edit`.
- **Oxlint + Ultracite + Oxfmt**: native lint and format.
- **Vitest `5.0.1` + `@effect/vitest` `4.0.0-rc.116`**: `it.effect` and `it.layer` for every Effect test; running Effects by hand in a test file is a lint error.
- **`@effect/tsgo` `0.45.0`**: patches TypeScript 7 in `prepare` so Effect language-service diagnostics (leaked requirements, `any`/`unknown` in channels, global Date/fetch/console inside Effect, Node built-ins where Effect has a service) fail `tsc`.
- **varlock `1.20.0`**: `.env.schema` declares every variable with `@env-spec` decorators; `pnpm check` runs `varlock load`, secrets stay in gitignored `.env.local`.
- **Vendored agent sources**: Effect, [effect-solutions](https://github.com/kitlangton/effect-solutions), XState, [Alchemy](https://github.com/alchemy-run/alchemy) via `./scripts/vendor-agent-sources.sh` (not x-algorithm; that stays app-specific).
- **Agent fence**: lefthook pre-commit + Pi/Cursor/Claude hooks that block `git … --no-verify`. Cheating should be uncomfortable and obvious.

Every dependency is pinned exactly. Upgrade pins as a reviewed stack change, not ambient drift.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm typecheck` | Check TypeScript without emitting files |
| `pnpm check` | Typecheck, check formatting, and run type-aware linting |
| `pnpm fix` | Apply Oxfmt and safe Oxlint fixes |
| `pnpm test` | Run the Vitest suite once |
| `pnpm build` | Compile package outputs |
| `pnpm cli -- ...` | Build and run the CLI |
| `pnpm vendor:agent-sources` | Clone core lib mirrors |
| `pnpm turbo run check test build` | Cached verification pipeline |

## Agentic surface

Every clone includes `AGENTS.md` for repo law and commands, `CLAUDE.md` as Claude Code's pointer to that law, and `VISION.md` for project intent. Source mirrors live under `.agent_sources/` after you run the vendor script. Repo-local Pi extensions belong in `.pi/extensions/`.

## Make it yours

Start with the template:

```sh
gh repo create <name> --template joelhooks/rat-stack
```

Clone the new repository, then install it:

```sh
pnpm install
```

Rename the workspace package names before you build on the example. The current `name` fields are:

- `package.json`: `rat-stack`
- `apps/cli/package.json`: `@rat-stack/cli`
- `apps/infra/package.json`: `@rat-stack/infra`
- `apps/mischief/package.json`: `@rat-stack/mischief`
- `packages/capability/package.json`: `@rat-stack/capability`
- `packages/core/package.json`: `@rat-stack/core`

Rename the `bin` entry in `apps/cli/package.json`, the root command in `apps/cli/src/command.ts`, and the version in `apps/cli/src/version.ts`. Then change every matching import. The current workspace imports are `@rat-stack/capability`, `@rat-stack/cli`, `@rat-stack/core`, `@rat-stack/infra`, and `@rat-stack/mischief`. Find them with:

```sh
rg -n '@rat-stack/' --glob '*.json' --glob '*.ts' -l
```

A new scope changes line lengths, so run the formatter once after the rename:

```sh
pnpm fix
```

Replace `inspectFile` in `packages/core` with one useful capability. Add it to `capabilities`, then verify each surface you keep. Rewrite the Project law, Architecture, and Boundaries sections of `AGENTS.md` and the top of `.pi/APPEND_SYSTEM.md`; they describe rat-stack until you do. Keep expected failures typed and map them to deliberate exit codes.

`apps/mischief` is the public site and Worker. `apps/infra` is its Alchemy Stack. Delete both if you do not want a public site. If you keep them, change the Cloudflare Zone name and the DNS names and targets derived from it in `apps/infra/alchemy.run.ts`. Change the Worker domain and redirects in `apps/mischief/src/worker.ts`. Choose an Alchemy stage for each plan or deploy. The stage is a command-line choice, for example `--stage <stage>`. Configure credentials with:

```sh
pnpm alchemy profile edit --add Cloudflare
```

Run the acceptance gate before the first push:

```sh
pnpm turbo run check test build
```

## What it promises and how to check

- One capability reaches every kept surface. Proof: `packages/capability/test/to-command.test.ts`, `packages/capability/test/to-http-api.test.ts`, `packages/capability/test/to-toolkit.test.ts`, `packages/capability/test/to-code-mode.test.ts`, and `apps/cli/test/cli.e2e.test.ts`.
- Schemas are the contract. Proof: `packages/capability/test/catalog.test.ts`, `packages/capability/test/to-http-api.test.ts`, and `packages/capability/test/to-toolkit.test.ts` check derived JSON Schema and typed failures.
- A fresh sandbox isolates model code. Proof: `packages/capability/test/sandbox.test.ts` checks file-system and child-process denial plus timeout handling.
- Rate limits fail closed. Proof: `apps/mischief/test/worker.test.ts` checks 429 responses before another execute worker starts and when the global limit denies.
- Markdown is the default machine representation. Proof: `apps/mischief/test/worker.test.ts` checks Markdown without `Accept: text/html` and HTML only when requested.

## Keep or cut

The template is itself a project, so it ships more than a bare scaffold. Delete what you will not use on day one; the fence will tell you what else has to go. After any cut: trim `packages/capability/src/index.ts`, run `pnpm install`, `pnpm fix`, then `pnpm turbo run check test build`, and update the package table in `AGENTS.md`.

| Want | Keep | Delete |
| --- | --- | --- |
| Only the CLI | `packages/capability/src/contract.ts`, `packages/capability/src/implement.ts`, `packages/capability/src/to-command.ts`, and their tests; all of `packages/core` | every other file in `packages/capability/src` and `packages/capability/test`; `apps/cli/src/surfaces.ts`; the `catalog`, `openapi`, `serve`, and `mcp` commands in `apps/cli/src/command.ts`; `apps/cli/test/serve.test.ts` and the MCP and catalog cases in `apps/cli/test/cli.e2e.test.ts` |
| No code mode |  | `packages/capability/src/catalog.ts`, `packages/capability/src/code-mode.ts`, `packages/capability/src/sandbox-error.ts`, `packages/capability/src/sandbox-service.ts`, `packages/capability/src/sandbox-subprocess.ts`, and `packages/capability/src/to-code-mode.ts`; `packages/capability/test/catalog.test.ts`, `packages/capability/test/sandbox.test.ts`, and `packages/capability/test/to-code-mode.test.ts`; the `./sandbox` and `./code-mode` exports in `packages/capability/package.json`; `codeMode` and `mcpServer.codeMode` in `apps/cli/src/surfaces.ts`; the `catalog` command and the `--code-mode` flag in `apps/cli/src/command.ts`; the code-mode and catalog cases in `apps/cli/test/cli.e2e.test.ts` |
| No HTTP |  | `packages/capability/src/to-http-api.ts`, `packages/capability/src/http-api.ts`, and their tests; the `./http-api` export in `packages/capability/package.json`; `http`, `routes`, and `webServer` in `apps/cli/src/surfaces.ts`; the `openapi` and `serve` commands; `apps/cli/test/serve.test.ts`; the OpenAPI case in `apps/cli/test/cli.e2e.test.ts` |
| No MCP |  | `packages/capability/src/to-toolkit.ts`, `packages/capability/src/toolkit.ts`, their test, and `packages/capability/test/mcp-harness.ts`; the `./toolkit` export in `packages/capability/package.json`; `tools` and `mcpServer` in `apps/cli/src/surfaces.ts`; the `mcp` command; the MCP cases in `apps/cli/test/cli.e2e.test.ts`. Code mode imports from `packages/capability/src/to-toolkit.ts`, so cutting MCP cuts code mode too |
| No XState |  | `packages/core/src/inspect-machine.ts` and its test (call `FileInspector.inspect` directly from `packages/core/src/inspect-file.ts`); `xstate` and `@xstate/effect` in `packages/core/package.json` and their `minimumReleaseAgeExclude` entries in `pnpm-workspace.yaml`; `scripts/oxlint-plugin-xstate-effect.ts` and its entry in `oxlint.config.ts` |

`defineContract`, `implement`, and `toCommand` are the minimum that keep `stats` working. The contract module has no dependency on the other projections.

## License

MIT
