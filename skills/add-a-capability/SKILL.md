---
name: add-a-capability
description: Learn how one Effect action becomes a command, HTTP route, MCP tool, and sandbox call.
---

# Add a capability

Build one action all the way through the stack. Copy the `inspectFile` example. Do not write separate business logic for each interface.

## 1. Define the action

Create `packages/core/src/<capability>.ts`.

1. Define the output schema and the schema for expected errors.
2. Call `defineCapability` from `@rat-stack/capability`.
3. Give the capability a stable name and a short description.
4. Use `Schema.Struct` for its input.
5. Set honest flags such as `readOnly`, `idempotent`, and `needsApproval`.
6. Keep the handler small. Put real work in a service or lifecycle machine.

```ts
export const doThing = defineCapability("doThing", {
  annotations: { idempotent: true, readOnly: true },
  description: "Do one concrete thing",
  failure: ThingError,
  handler: ({ id }) => ThingService.use((service) => service.run(id)),
  input: Schema.Struct({ id: Schema.String }),
  output: ThingResult,
});
```

Schemas must encode and decode without services. Put service dependencies on the handler's Effect.

If the action needs a service, copy `packages/core/src/file-inspector.ts`. Use a `Context.Service` class. Capture dependencies in `make`. Keep `static layer` beside it. Export the service and capability from `packages/core/src/index.ts`.

## 2. Register it

Add the capability to the `capabilities` tuple in `packages/core/src/inspect-file.ts`:

```ts
import { doThing } from "./do-thing.js";

export const capabilities = [inspectFile, doThing] as const;
```

The order is public. This tuple feeds HTTP, MCP, the catalogue, and sandbox declarations.

## 3. Add its command

In `apps/cli/src/command.ts`, call `toCommand(doThing, options)`. Add the result to `rootCommand` with `Command.withSubcommands`.

Use:

- `name` when the command name differs from the capability name
- `positional` for input fields that should be arguments
- `render` for readable output

`toCommand` adds `--json`. Do not parse the fields again or call the service directly.

## 4. Check the other interfaces

You do not need more handlers.

- HTTP adds `POST /doThing` and updates OpenAPI.
- MCP adds a `doThing` tool with the same schemas and flags.
- The sandbox catalogue adds `tools.doThing(input)`.
- Sandbox calls still decode input, run the same handler, and encode the result.

If the action needs a new service, provide its layer once in `apps/cli/src/cli.ts`.

## 5. Test it

Use `@effect/vitest`. Run Effects with `it.effect` or `it.layer`. Do not call `Effect.run*` or `ManagedRuntime.make` in tests.

Add these tests:

1. `packages/core/test/<capability>.test.ts`: check the output, expected errors, and flags.
2. Shared interface tests only when the code that builds those interfaces changes.
3. `apps/cli/test/cli.e2e.test.ts`: check the command, OpenAPI route, MCP tool, and sandbox declaration. Run the sandbox path when it adds useful coverage.

Use `Schema.encodeEffect` to check the encoded result. Use `Effect.flip` to inspect expected errors.

## 6. Finish

```sh
pnpm turbo run check test build
```

Fix failures. Do not loosen the checks, hooks, or pinned versions.
