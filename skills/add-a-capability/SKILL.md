---
name: add-a-capability
description: Add one schema-typed behavior to rat-stack and project it through CLI, HTTP, MCP, and code mode without duplicating handlers.
---

# Add a capability

Follow the existing `inspectFile` vertical slice. Do not write separate business logic for each surface.

## 1. Define the domain contract

In `packages/core/src/<capability>.ts`:

1. Define or import the output and failure schemas. Expected failures must be typed.
2. Call `defineCapability` from `@rat-stack/capability`.
3. Give it a stable name and short description.
4. Use a `Schema.Struct` input. Annotate fields with descriptions where useful.
5. Supply output and failure schemas, truthful annotations, and `needsApproval` when required.
6. Keep the handler thin. Call a domain service or lifecycle machine instead of putting transport logic in it.

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

Capability schemas must be plain: decoding and encoding cannot require services. Put dependencies in the handler's Effect requirement channel.

If the behavior needs a service, follow `packages/core/src/file-inspector.ts`: use a `Context.Service` class, capture dependencies in `make`, and keep `static layer` beside it. Export the capability and service from `packages/core/src/index.ts`.

## 2. Register it

In `packages/core/src/inspect-file.ts`, import the new capability and add it to the exported `capabilities` tuple:

```ts
import { doThing } from "./do-thing.js";

export const capabilities = [inspectFile, doThing] as const;
```

Keep catalog order intentional. This tuple feeds the HTTP, MCP, catalog, and code-mode projections in `apps/cli/src/surfaces.ts`.

## 3. Add the CLI projection

In `apps/cli/src/command.ts`, create a command with `toCommand(doThing, options)` and add it to `rootCommand`'s `Command.withSubcommands` list.

Use `name` when the public command name differs from the capability name. Use `positional` for selected input fields. Use `render` for human output; `toCommand` then adds `--json` automatically.

Do not hand-parse schema fields or call the service directly from the command.

## 4. Confirm every surface

No extra handler is needed for the other surfaces:

- `toHttpApi("RatStack", capabilities)` creates `POST /doThing` and includes it in OpenAPI.
- `toToolkit(capabilities)` exposes an MCP tool named `doThing` with the same schemas and annotations.
- `toCodeMode(capabilities)` adds it to catalog search and generated `tools.doThing(input)` declarations.
- Every code-mode call decodes input, runs the same handler, and encodes output or declared failure.

Provide any new service layer once in `apps/cli/src/cli.ts`, following `FileInspector.layer` and `NodeServices.layer`. The projections preserve handler requirements.

## 5. Test the vertical slice

Use `@effect/vitest`. Run Effects with `it.effect` or `it.layer`; do not call `Effect.run*` or `ManagedRuntime.make` in tests.

Add focused tests:

1. `packages/core/test/<capability>.test.ts`: run the handler through a test layer; assert encoded output, typed failure, and annotations.
2. `packages/capability/test/*`: change these only when projection behavior changes. Existing tests already cover CLI parsing, HTTP success/failure, MCP schemas/calls, catalog declarations/search, and sandbox execution.
3. `apps/cli/test/cli.e2e.test.ts`: run the built command; assert the OpenAPI path, MCP tool listing, and catalog declaration include the new capability; exercise code mode when the capability adds a meaningful execution path.

Use `Schema.encodeEffect` when asserting the wire shape. Use `Effect.flip` to inspect typed failures.

## 6. Verify

```sh
pnpm turbo run check test build
```

If the gate fails, fix the implementation. Do not loosen diagnostics, lint rules, hooks, or exact pins.
