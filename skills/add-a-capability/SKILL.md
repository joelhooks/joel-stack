---
name: add-a-capability
description: Learn how one contract and its handler become a command, HTTP route, MCP tool, browser RPC, and sandbox call.
---

# Add a capability

Define the shared contract once. Implement its handler where the data and infrastructure live. Do not write separate business logic for each interface.

## 1. Define the contract

Put cross-process contracts in `packages/core/src/contracts.ts` and import `defineContract` from `@rat-stack/capability/contract`.

1. Define the input, output, and expected failure schemas.
2. Give the contract a stable name and short description.
3. Use `Schema.Struct` for the input.
4. Set honest annotations such as `readOnly`, `idempotent`, `destructive`, and `openWorld`.
5. Set `needsApproval: true` when the action needs approval. `implement` adds the `Approval` requirement and `ApprovalDenied` failure; the handler itself declares only the contract's failures.

```ts
export const doThingContract = defineContract("doThing", {
  annotations: { idempotent: true, readOnly: true },
  description: "Do one concrete thing",
  failure: ThingError,
  input: Schema.Struct({ id: Schema.String }),
  output: ThingResult,
});
```

Schemas must encode and decode without services. Keep server dependencies out of the contract module.

## 2. Implement it

Import `implement` from `@rat-stack/capability/implement`. Put the handler next to its service or server-side data. Keep it small; put real work in a service or lifecycle machine.

```ts
export const inspectFile = implement(inspectFileContract, ({ path }) =>
  runInspectMachine(path)
);
```

The handler input comes from the contract. Its Effect requirements and expected failures stay typed. `implement` supplies the approval gate when the contract requires it.

If the action needs a service, copy `packages/core/src/file-inspector.ts`. Use a `Context.Service` class. Capture dependencies in `make` and keep `static layer` beside it.

## 3. Register it

Add the implementation to the `capabilities` tuple consumed by its composition root. For the CLI example, that tuple lives in `packages/core/src/inspect-file.ts`:

```ts
import { doThing } from "./do-thing.js";

export const capabilities = [inspectFile, doThing] as const;
```

The order is public. The tuple feeds the projections and code-mode declarations.

## 4. Project the implementation

The CLI, HTTP, MCP, RPC, and code-mode projections take implemented capabilities. They read names, schemas, annotations, and approval settings from `capability.contract`.

- HTTP adds `POST /doThing` and updates OpenAPI.
- MCP adds a `doThing` tool with the same schemas and flags.
- The sandbox catalogue adds `tools.doThing(input)`.
- Sandbox calls decode input, run the same handler, then encode the result.

`toCommand` builds one CLI command from the registered tuple. Open `apps/cli/src/command.ts` only when the command needs a positional argument, custom renderer, or alias. Use `name`, `positional`, and `render` for those cases. `toCommand` adds `--json`; do not parse fields again or call the service directly.

RPC serves the browser, not an agent interface. Browser clients import contracts from `@rat-stack/core/contracts` and `toRpcGroup` from `@rat-stack/capability/rpc-group`; they do not import a handler or the server-side `toRpc` projection.

## 5. Test it

Use `@effect/vitest` and run Effects with `it.effect` or `it.layer`. Do not call `Effect.run*` or `ManagedRuntime.make` in tests.

1. Test the handler's output, expected failures, annotations, and approval behavior.
2. Add projection tests when the projection changes. Check that client RPC groups can be built from contracts alone.
3. Add a CLI e2e case when the new capability changes the command tree or a public interface.

Use `Schema.encodeEffect` to check encoded results and `Effect.flip` to inspect expected errors.

## 6. Finish

```sh
pnpm turbo run check test build
```

Fix failures. Do not loosen the checks, hooks, or pinned versions.
