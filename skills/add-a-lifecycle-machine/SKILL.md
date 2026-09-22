---
name: add-a-lifecycle-machine
description: Add an Effect-backed XState lifecycle for finite states, retries, cancellation, or resumable work in rat-stack.
---

# Add a lifecycle machine

Mirror `packages/core/src/inspect-machine.ts` when behavior has real modes or transitions. Do not replace a direct Effect unless the lifecycle matters.

Before editing Effect or XState code, read `node_modules/effect/AGENTS.md`, then inspect the pinned XState and `@xstate/effect` sources listed in `AGENTS.md`.

## 1. Name the lifecycle

Write the states and terminal outcomes first. Keep domain failures in an explicit outcome union when the machine must transition on them.

For file inspection, the machine owns `reading`, `inspected`, and `unreadable`. The terminal outcome is either `Inspected` with stats or `Unreadable` with `FileStatsError`.

## 2. Declare side-effect actors

Define each side effect with `fromEffect` outside the machine:

```ts
const performWork = fromEffect({
  effect: ({ input }) => ThingService.use((service) => service.run(input.id)),
  schemas: { input: Schema.Struct({ id: Schema.String }) },
});
```

Declared actors carry typed failures and service requirements. Only actions and actors declared through `setupEffect` contribute requirements to the Effect actor. Never return an Effect from an inline XState callback or spawn inline Effect logic.

## 3. Build with `setupEffect`

Use `setupEffect` with the declared actors and schemas, then call `createMachine`:

```ts
type ThingOutcome =
  | { readonly _tag: "Succeeded"; readonly value: ThingResult }
  | { readonly _tag: "Failed"; readonly error: ThingError };
interface ThingContext {
  readonly id: string;
  readonly outcome: ThingOutcome | undefined;
}

export const thingMachine = setupEffect({
  actors: { performWork },
  schemas: {
    context: types<ThingContext>(),
    input: Schema.Struct({ id: Schema.String }),
  },
}).createMachine({
  context: ({ input }) => ({ id: input.id, outcome: undefined }),
  initial: "working",
  output: ({ context }) => context.outcome,
  states: {
    working: {
      invoke: {
        src: "performWork",
        input: ({ context }) => ({ id: context.id }),
        onDone: {
          target: "succeeded",
          context: ({ context, event }) => ({
            ...context,
            outcome: { _tag: "Succeeded", value: event.output },
          }),
        },
        onError: {
          target: "failed",
          context: ({ context, event }) => ({
            ...context,
            outcome: { _tag: "Failed", error: event.error },
          }),
        },
      },
    },
    succeeded: { type: "final" },
    failed: { type: "final" },
  },
});
```

Let XState own states and transitions. Let Effect own side effects, typed errors, services, and resource scope.

## 4. Run it as an Effect

Start Effect-backed machines only with `createEffectActor`, never XState's `createActor`. Wait with `join` inside `Effect.scoped`:

```ts
export const runThingMachine = Effect.fn("runThingMachine")(function* (
  id: string
) {
  const actor = yield* createEffectActor(thingMachine, { input: { id } });
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off
  const outcome = yield* join(actor).pipe(Effect.orDie);
  if (outcome === undefined) {
    return yield* Effect.die(new Error("machine completed without an outcome"));
  }
  if (outcome._tag === "Failed") {
    return yield* outcome.error;
  }
  return outcome.value;
}, Effect.scoped);
```

A machine-level error or early stop is a defect in this shape. The domain failure travels through a final state. `join` has an `unknown` machine error channel, so the reference uses a targeted `anyUnknownInErrorContext` diagnostic override and `Effect.orDie`.

Call the runner from the capability handler, as `packages/core/src/inspect-file.ts` does. Provide the actor's service layer at the composition root in `apps/cli/src/cli.ts`.

## 5. Test both terminal paths

Use `@effect/vitest` with `it.layer`. Start the machine with `createEffectActor`, `join` it, then assert both the final snapshot state and output. Also test that the runner returns success and lifts the domain failure into Effect's error channel.

The `xstate-effect/no-inline-effect` rule in `scripts/oxlint-plugin-xstate-effect.ts`, wired through `oxlint.config.ts`, guards the declared-actor boundary. Do not disable it to make inline Effect logic pass.

## 6. Verify

```sh
pnpm turbo run check test build
```
