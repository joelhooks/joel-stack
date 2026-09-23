---
name: uncomplect
description: Find what a rat-stack design braids together, separate it into capabilities, cartridges, machines, features, and clients, and fence the separation so the next change cannot braid it again. Use when asked to simplify, review, or replace a design, "what would Rich Hickey do", "optimize for deletion", or "define this error out of existence".
basis:
  - https://github.com/joelhooks/skills/tree/main/skills/uncomplect
---

# Uncomplect rat-stack

Rat-stack is a reference that other projects copy, so a braid here becomes a braid in every copy. This skill applies the general [uncomplect](https://github.com/joelhooks/skills/tree/main/skills/uncomplect) lenses to rat-stack's own pieces. Read that skill for the full reasoning behind each lens; this one says where each lens lands in this repo.

Treat the current code as a working prototype. It proves which behavior matters, not that its structure was right. The goal is fewer braided concerns, not fewer lines.

## Read first

Read `AGENTS.md` for the nouns and folders, `VISION.md` for the cartridge test, and the decisions in `.brain/`. Read the code, tests, and receipts for the design under review. Check Effect, XState, and Alchemy APIs against the pinned mirrors in `.agent_sources/`, because these libraries are prereleases and change every few days.

You are done when every recommendation names the file it rests on, the behavior it preserves, and what it deletes.

## Find the braids

Build the table:

| Concern | What is braided together? | Where it should live | Separation move |
| ------- | ------------------------- | -------------------- | --------------- |

These are the braids rat-stack is built to avoid. Check for each one:

- **Behavior inside a projection.** An HTTP handler, MCP tool, CLI command, or RPC handler that does domain work. The rule belongs in the capability's handler, with input, output, and failures as Effect Schemas. Every projection is derived from that one definition, so a rule written in one projection is missing from the others.
- **Transport inside a feature.** A component that calls `fetch`, builds an RPC client, or retries. The client owns transport, the local replica, and named commands; the feature reads atoms and calls those commands.
- **Vendor inside a caller.** Drizzle queries, SQL dialect, or a provider SDK outside the cartridge. Callers use the service tag. The vendor Layer owns the schema, the queries, and the resources, so swapping vendors is one `Layer.provide` line.
- **Infrastructure apart from the code that uses it.** A Worker, database, or queue declared somewhere the consuming Layer cannot see. The cartridge declares its own resources and bindings, so removing it removes them.
- **Stack wiring inside runtime code.** Runtime modules that import `apps/infra`, or a Stack module that does work when imported.
- **Policy inside mechanism.** Approval checks, rate limits, or retry rules written into a handler. Approval comes from `needsApproval` on the capability, which adds the `Approval` requirement and the `ApprovalDenied` failure to every projection; retry policy belongs to the boundary service, and only for typed transient failures.
- **Lifecycle inside domain data.** Status strings and booleans that encode modes. Modes with different legal events belong in a machine under `@xstate/effect`; see `add-a-lifecycle-machine`.
- **Two authorities.** A read model, cache, or client replica that makes decisions. The host, meaning the Durable Object or the database cartridge, is authoritative. The client holds a replica and reconciles through `reactivityKeys`. Rat-stack uses "projection" for an interface derived from a capability, so call DDD's projection a read model here.

## Deepen the seam

A capability is rat-stack's deep module: one definition hides validation, errors, approval, and every interface behind a name and three schemas. A cartridge is the other: one service tag hides a vendor and its infrastructure.

For each proposed piece, ask what it removes. A new tag, Layer, or state that deletes nothing is ceremony. For a consequential change, design it twice as two capability signatures, input, output, and failure schemas, and compare what callers must know and what each deletes.

## Run the cartridge test

A unit is replaceable when it passes the cartridge test from `VISION.md`: labeled, pushes in, pulls out, self-contained, and easy to trash. Check it concretely:

1. Delete the package and its one `Layer.provide` or Stack line. `pnpm turbo run check test build` should still pass. When it fails, the errors name every place that reached into the unit; Alchemy types each binding into the code that reads it, so infrastructure leaks show up too.
2. Nothing outside the unit imports its internals.
3. It could be rewritten from its schemas, tests, and receipts in about a week.

`keep-or-cut` shows the same test applied to the stack's own interfaces.

## Fence the separation

Agents copy what they find, so a separation that lives only in a review comes back. Put each one on the highest rung that can hold it, following Lauren Tan's ladder in `VISION.md`:

1. **Codebase.** A type or API that makes the braid impossible to write: a Schema at the boundary, a tagged error, a required binding, a service tag in place of a concrete import.
2. **Static analysis.** An import boundary or an Oxlint rule in `scripts/`, with a real-`oxlint` fixture test beside the others in `packages/core/test/`. The `gardener` skill has the routine.
3. **Rules.** A line in `AGENTS.md`, only when neither of the above can hold it.

Keep one paved path. When two ways to do the same thing exist, delete one.

## Output

Lead with one verdict, either `More complicated locally, simpler overall` or `More machinery, no net simplification`.

Then give the braid table, the proposed nouns and folders, the capability or cartridge signature, the machine if one is needed, the cartridge test result, the deletion list, the fence for each separation, and one material question. Report what becomes impossible, what becomes obvious, and what disappears; the deletion list makes the case.
