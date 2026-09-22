---
name: learn-rat-stack
description: Understand rat-stack before changing a clone, choosing a surface, adding behavior, or trimming the template.
---

# Learn rat-stack

Use this skill when you enter the repo or need to decide where a change belongs.

## Read first

1. Read `AGENTS.md`. It is repo law: pins, architecture, commands, boundaries, and stop rules.
2. Read `VISION.md`. It explains why the scaffold exists and which outcomes matter.
3. Read `README.md` for the current workspace and runnable example.
4. Before Effect or XState work, read `node_modules/effect/AGENTS.md` and the pinned mirrors listed in `AGENTS.md`.

A product clone should replace rat-stack's product intent and project-law sections instead of stretching them.

## The core rule

Define behavior once as a `Capability`:

- Effect Schema for input, output, and declared failure
- one Effect handler
- read-only, destructive, idempotent, and open-world annotations
- an approval flag

`packages/capability/src/capability.ts` defines that object. Domain capabilities live in `packages/core`. The `capabilities` tuple in `packages/core/src/inspect-file.ts` is the registry.

Four projections expose the same contract:

1. CLI: `toCommand` maps schema fields to arguments and flags.
2. HTTP: `toHttpApi` creates `POST /<capability>` endpoints and derived OpenAPI.
3. MCP: `toToolkit` creates one MCP tool per capability.
4. Code mode: `toCodeMode` creates `search` and `execute`; sandbox calls still pass through capability schemas and handlers.

`apps/cli/src/surfaces.ts` instantiates HTTP, MCP, and code mode from the registry. `apps/cli/src/command.ts` creates CLI commands. `apps/cli/src/cli.ts` is the composition root that provides service layers.

## Choose the next skill

- Add domain behavior: use `add-a-capability`.
- Add finite states, retries, cancellation, or another lifecycle: use `add-a-lifecycle-machine`.
- Remove unused surfaces from a clone: use `keep-or-cut`.

Do not bypass a capability with a custom route, command, MCP handler, or sandbox function. Schemas are the contract, and generated OpenAPI, MCP schemas, catalog JSON Schema, and code-mode declarations derive from them.

## Finish

Run the required gate:

```sh
pnpm turbo run check test build
```

Do not weaken the fence to make the gate pass.
