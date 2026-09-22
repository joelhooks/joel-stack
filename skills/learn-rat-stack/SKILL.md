---
name: learn-rat-stack
description: See how Effect, XState, TypeScript, Alchemy, and four agent interfaces fit together.
---

# Learn the stack

Use this repo as a working map of the stack. Rat-stack is the example. The pieces are what you are here to learn.

## The pieces

- **Effect** defines schemas, typed errors, services, layers, commands, HTTP routes, and MCP tools.
- **XState** owns work with real states, retries, cancellation, or resume points.
- **TypeScript 7** checks the types. Effect diagnostics catch mistakes that normal TypeScript misses.
- **Oxlint, Oxfmt, Vitest, and lefthook** keep the same rules in the editor, tests, and commits.
- **pnpm and Turborepo** connect the packages and cache their checks.
- **Alchemy** declares and deploys the Cloudflare Worker. Start with `learn-alchemy` to see the whole cloud footprint as one Effect program.
- **The command line, HTTP, MCP, and sandbox** are four ways to call the same action.

## Trace one action

Start with `inspectFile`.

1. `packages/core/src/inspect-file.ts` defines the action and its schemas.
2. `packages/core/src/file-inspector.ts` does the file work through an Effect service.
3. `packages/core/src/inspect-machine.ts` models the work as an XState machine.
4. `packages/capability/src` turns the action into commands, HTTP routes, MCP tools, and sandbox calls.
5. `apps/cli/src/surfaces.ts` creates those interfaces.
6. `apps/cli/src/cli.ts` provides the services they need.
7. `apps/infra/alchemy.run.ts` declares the cloud resources.

Rat-stack calls the shared action a `Capability`. It has an input schema, an output schema, a schema for expected errors, one Effect handler, and flags that say whether it reads, writes, repeats safely, or needs approval.

The `capabilities` tuple in `packages/core/src/inspect-file.ts` lists every action. Add one there and each interface picks it up. Do not write a second handler for one interface.

## Read before changing a piece

1. Read `AGENTS.md` for commands, pins, boundaries, and checks.
2. Read `VISION.md` for the reason the pieces are assembled this way.
3. Read the package or source file you plan to change.
4. Before Effect or XState work, read `node_modules/effect/AGENTS.md` and the pinned source listed in `AGENTS.md`.

If this is a product repo copied from rat-stack, replace rat-stack's product notes and project rules. Keep the stack lessons that still help the product.

## Pick the next skill

- Learn Effect schemas and shared interfaces: use `add-a-capability`.
- Learn Effect and XState together: use `add-a-lifecycle-machine`.
- Learn which pieces can stand alone: use `keep-or-cut`.
- Learn the cloud footprint and deployment graph: use `learn-alchemy`.

## Finish

Run:

```sh
pnpm turbo run check test build
```

Fix failures. Do not weaken the checks.
