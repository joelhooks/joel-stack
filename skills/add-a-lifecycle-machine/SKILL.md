---
name: add-a-lifecycle-machine
description: Learn how XState owns a lifecycle while Effect owns its work, errors, and services.
---

# Add a lifecycle machine

Use this to learn the seam between XState and Effect. Copy `packages/core/src/inspect-machine.ts` when the work has states that matter. Keep a direct Effect when it does not.

Before changing Effect or XState code, read `node_modules/effect/AGENTS.md`. Then read the pinned XState and `@xstate/effect` source listed in `AGENTS.md`.

## 1. Write the states first

List the states and final results before writing the machine.

For file inspection, the states are `reading`, `inspected`, and `unreadable`. The final result is either `Inspected` with file stats or `Unreadable` with a `FileStatsError`.

Use an explicit result union when a known error should move the machine into a final state.

## 2. Put side effects in actors

Define each side effect with `fromEffect` outside the machine:

```ts
const performWork = fromEffect({
  effect: ({ input }) => ThingService.use((service) => service.run(input.id)),
  schemas: { input: Schema.Struct({ id: Schema.String }) },
});
```

These actors carry typed errors and service dependencies. Declare them through `setupEffect`. Do not return an Effect from an inline XState callback.

## 3. Build the machine

Pass the actors and schemas to `setupEffect`, then call `createMachine`:

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

XState owns states and moves between them. Effect owns side effects, errors, services, and cleanup.

## 4. Run it inside Effect

Start the machine with `createEffectActor`. Do not use XState's `createActor`. Hand the actor to `watchActor` from `@rat-stack/capability/actor-watch`, then wait for it with `join` inside `Effect.scoped`:

```ts
export const runThingMachine = Effect.fn("runThingMachine")(function* (
  id: string
) {
  const actor = yield* createEffectActor(thingMachine, { input: { id } });
  yield* watchActor("thingMachine", actor);
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

`watchActor` does nothing until devtools runs the capability. Then `rat_list_actors`, `rat_list_transitions`, and `rat_get_actor` show every state and event. `rat-stack-patterns/watch-effect-actors` fails lint when a runtime module starts an actor without it.

A missing result or machine-level error is a bug in this design. A known product error belongs in the final result. `join` has an `unknown` machine-error channel, so the example uses one narrow diagnostic override before `Effect.orDie`.

Call the runner from the capability handler. Provide its service layer in `apps/cli/src/cli.ts`.

## 5. Test both endings

Use `@effect/vitest` with `it.layer`.

Start the machine with `createEffectActor` and wait with `join`. Check the final state and result for success and failure. Also test that the runner returns the success value and puts the known failure in Effect's error channel.

The `xstate-effect/no-inline-effect` rule blocks inline Effect logic. Fix the code instead of disabling the rule.

## 6. Finish

```sh
pnpm turbo run check test build
```
