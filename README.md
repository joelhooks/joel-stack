# TypeScript CLI template

[![CI](https://github.com/joelhooks/ts-cli-template/actions/workflows/ci.yml/badge.svg)](https://github.com/joelhooks/ts-cli-template/actions/workflows/ci.yml)

A strict, batteries-included starting point for a Node.js command-line app. It ships with a real Effect v4 CLI, tests, formatting, type-aware linting, Turborepo task caching, and GitHub Actions CI.

## Create a repository

```sh
gh repo create <name> --template joelhooks/ts-cli-template
```

Clone the new repository, then install and verify it:

```sh
nvm use
npm install
npx turbo run check test build
```

Node `24.18.0` and npm `11.16.0` are required. The requirement is declared in `.nvmrc`, `engines`, `devEngines`, and `packageManager`, so local development and CI use the same runtime contract.

## Try the example CLI

The included `stats` command counts bytes, Unicode characters, words, and lines in a file:

```sh
npm run cli -- stats README.md
npm run cli -- stats README.md --json
```

After `npm run build`, you can run the built entrypoint directly:

```sh
node dist/cli.js stats README.md
```

The command demonstrates typed arguments, generated help, a typed filesystem error, Node platform layers, and intentional exit codes. Replace it with your own domain rather than growing the example into a grab bag.

## What is in the stack?

- **Effect `4.0.0-beta.98`** provides the typed runtime, errors, filesystem service, and CLI model. The parser comes from `effect/unstable/cli`; the separate `@effect/cli` package is still on the Effect v3 line. Effect v4 is an exact beta pin on purpose.
- **`@effect/platform-node` `4.0.0-beta.98`** supplies Node-backed services and the process runner. Adapter and core versions stay matched.
- **TypeScript `7.0.2`** runs with strict module and index-access checks. The linter owns unused-code policy; TypeScript owns type and module safety.
- **XState `5.32.5`** is ready for commands that grow real lifecycle states, retries, cancellation, or resumability. Do not replace those states with a pile of booleans.
- **Oxlint `1.74.0` + Ultracite `7.9.4`** provide native, type-aware linting. `oxlint-tsgolint` enables the type-aware rules without experimental compiler diagnostics.
- **Oxfmt `0.59.0`** supplies one formatter shared with the Ultracite preset.
- **Vitest `4.1.10`** runs fast unit and Effect integration tests. The tests use Effect directly because the current `@effect/vitest` release peers on Effect v3 and Vitest v3.
- **Turborepo `2.10.5`** gives the single package cached `typecheck`, `check`, `test`, and `build` tasks now, without requiring a later task-runner migration.
- **Node `24.18.0` + npm `11.16.0`** are the runtime. This template does not use Bun.

Every dependency is pinned exactly. Upgrade pins as a reviewed stack change, not as ambient drift.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Check TypeScript without emitting files |
| `npm run check` | Typecheck, check formatting, and run type-aware linting |
| `npm run fix` | Apply Oxfmt and safe Oxlint fixes |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run build` | Compile `src/` into `dist/` |
| `npm run cli -- ...` | Build and run the CLI |
| `npx turbo run check test build` | Run the cached verification pipeline |

## Make it yours

1. Rename the package and `bin` entry in `package.json`.
2. Rename the root command and version in `src/command.ts`.
3. Replace `stats` and its tests with one useful vertical slice of your CLI.
4. Keep expected failures typed and map them to deliberate exit codes.
5. Run `npx turbo run check test build` before the first push.

## License

MIT
