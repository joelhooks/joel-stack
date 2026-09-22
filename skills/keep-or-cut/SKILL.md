---
name: keep-or-cut
description: Remove unused rat-stack surfaces from a new clone while preserving the smallest working capability-to-CLI scaffold and its fence.
---

# Keep or cut rat-stack

Use this on day one of a clone. Delete surfaces you will not use; do not keep speculative machinery.

Read `AGENTS.md` first. Preserve unrelated product work. Inspect imports and tests before deleting files.

## Minimum: CLI only

The smallest working slice is:

- `packages/capability/src/capability.ts`
- `packages/capability/src/to-command.ts`
- their tests
- all of `packages/core`
- the CLI composition needed by the projected command

`defineCapability` plus `toCommand` keeps the shipped `stats` command working. `capability.ts` does not depend on the other projections.

For CLI only, delete:

- every other file and matching test in `packages/capability/src` and `packages/capability/test`
- `apps/cli/src/surfaces.ts`
- `catalog`, `openapi`, `serve`, and `mcp` commands from `apps/cli/src/command.ts`
- `apps/cli/test/serve.test.ts`
- catalog, OpenAPI, MCP, and code-mode cases from `apps/cli/test/cli.e2e.test.ts`

## Cut code mode

Delete:

- `packages/capability/src/catalog.ts`
- `packages/capability/src/code-mode.ts`
- `packages/capability/src/sandbox-error.ts`
- `packages/capability/src/sandbox-service.ts`
- `packages/capability/src/sandbox-subprocess.ts`
- `packages/capability/src/to-code-mode.ts`
- `packages/capability/test/catalog.test.ts`
- `packages/capability/test/sandbox.test.ts`
- `packages/capability/test/to-code-mode.test.ts`
- `codeMode` and `mcpServer.codeMode` from `apps/cli/src/surfaces.ts`
- the `catalog` command and `--code-mode` flag from `apps/cli/src/command.ts`
- catalog and code-mode cases from `apps/cli/test/cli.e2e.test.ts`
- the `./sandbox` and `./code-mode` exports from `packages/capability/package.json`

## Cut HTTP

Delete:

- `packages/capability/src/to-http-api.ts`, `packages/capability/src/http-api.ts`, and the projection test
- the `./http-api` export from `packages/capability/package.json`
- `http`, `routes`, and `webServer` from `apps/cli/src/surfaces.ts`
- the `openapi` and `serve` commands from `apps/cli/src/command.ts`
- `apps/cli/test/serve.test.ts`
- the OpenAPI case from `apps/cli/test/cli.e2e.test.ts`

## Cut MCP

Delete:

- `packages/capability/src/to-toolkit.ts`, `packages/capability/src/toolkit.ts`, and the projection test
- `packages/capability/test/mcp-harness.ts`
- `tools` and `mcpServer` from `apps/cli/src/surfaces.ts`
- the `mcp` command from `apps/cli/src/command.ts`
- MCP cases from `apps/cli/test/cli.e2e.test.ts`
- the `./toolkit` export from `packages/capability/package.json`

Code mode imports `to-toolkit.ts`. Cutting MCP therefore cuts code mode too; apply both lists.

## Cut XState

Delete:

- `packages/core/src/inspect-machine.ts` and its test
- `xstate` and `@xstate/effect` from `packages/core/package.json`
- their `minimumReleaseAgeExclude` entries from `pnpm-workspace.yaml`
- `scripts/oxlint-plugin-xstate-effect.ts`
- its entry in `oxlint.config.ts`

Then call `FileInspector.inspect` directly from the capability handler in `packages/core/src/inspect-file.ts`.

## Clean every cut

1. Remove stale exports from `packages/capability/src/index.ts` and any affected package barrel.
2. Remove stale imports, layers, commands, and tests found by the compiler.
3. Update the package table in `AGENTS.md` so repo law matches the clone.
4. Refresh the lockfile and format intentional changes:

```sh
pnpm install
pnpm fix
pnpm turbo run check test build
```

Let the fence expose every dangling reference. Do not silence diagnostics or delete tests unrelated to the removed surface.
