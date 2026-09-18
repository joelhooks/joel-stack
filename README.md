# TypeScript CLI template

[![CI](https://github.com/joelhooks/ts-cli-template/actions/workflows/ci.yml/badge.svg)](https://github.com/joelhooks/ts-cli-template/actions/workflows/ci.yml)

Joel's **agentic scaffold** for a Node.js CLI: why in `VISION.md` / `AGENTS.md`, fence in pins + checks + hooks. Public tree is steal-the-ideas, not a supported product. It ships as a **pnpm + Turborepo workspace** with a real Effect v4 CLI, tests, formatting, type-aware linting, and vendored source mirrors for Effect, effect-solutions, XState, and Alchemy.

## Create a repository

```sh
gh repo create <name> --template joelhooks/ts-cli-template
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
| `apps/cli` | `@ts-cli-template/cli` | Effect CLI entry |
| `packages/core` | `@ts-cli-template/core` | Shared domain example (file stats) |
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

## What is in the stack?

- **pnpm workspaces + Turborepo `2.10.13`** — cached `typecheck` / `test` / `build` across packages from day one.
- **Effect `4.0.0-rc.115`** — typed runtime, errors, filesystem service, CLI model (`effect/unstable/cli`).
- **`@effect/platform-node` `4.0.0-rc.115`** — Node-backed services; keep adapter and core pins matched.
- **TypeScript `7.0.2`** — strict module and index-access checks.
- **XState `6.0.0-alpha.58`** — ready for real lifecycle states; do not replace those with boolean soup.
- **Oxlint + Ultracite + Oxfmt** — native lint and format.
- **Vitest `5.0.1`** — unit and Effect integration tests.
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
