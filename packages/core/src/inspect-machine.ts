import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Data, Effect, Schema } from "effect";
import { types } from "xstate";

import { FileInspector } from "./file-inspector.js";
import type { FileStats, FileStatsError } from "./stats.js";

export type InspectOutcome = Data.TaggedEnum<{
  Inspected: { readonly stats: FileStats };
  Unreadable: { readonly error: FileStatsError };
}>;

export const inspectOutcome = Data.taggedEnum<InspectOutcome>();

interface InspectContext {
  readonly outcome: InspectOutcome | undefined;
  readonly path: string;
}

const readStats = fromEffect({
  effect: ({ input }) =>
    FileInspector.use((inspector) => inspector.inspect(input.path)),
  schemas: { input: Schema.Struct({ path: Schema.String }) },
});

export const inspectMachine = setupEffect({
  actors: { readStats },
  schemas: {
    context: types<InspectContext>(),
    input: Schema.Struct({ path: Schema.String }),
  },
}).createMachine({
  context: ({ input }) => ({ outcome: undefined, path: input.path }),
  initial: "reading",
  output: ({ context }) => context.outcome,
  states: {
    inspected: { type: "final" },
    reading: {
      invoke: {
        input: ({ context }) => ({ path: context.path }),
        onDone: {
          context: ({ event }) => ({
            outcome: inspectOutcome.Inspected({ stats: event.output }),
          }),
          target: "inspected",
        },
        onError: {
          context: ({ event }) => ({
            outcome: inspectOutcome.Unreadable({ error: event.error }),
          }),
          target: "unreadable",
        },
        src: "readStats",
      },
    },
    unreadable: { type: "final" },
  },
});

export const runInspectMachine = Effect.fn("runInspectMachine")(
  function* runInspectMachine(path: string) {
    const actor = yield* createEffectActor(inspectMachine, { input: { path } });
    yield* watchActor("inspectMachine", actor);
    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- A machine-level error or an early stop is a programming error here: the domain failure travels through the `unreadable` state, not the actor. A machine's ErrorFrom is unknown by design (statelyai/xstate#5725), so the unknown-error diagnostic is off for this one call and orDie closes it.
    const outcome = yield* join(actor).pipe(Effect.orDie);

    if (outcome === undefined) {
      return yield* Effect.die(
        new Error("inspectMachine completed without an outcome")
      );
    }

    return yield* inspectOutcome.$match(outcome, {
      Inspected: ({ stats }) => Effect.succeed(stats),
      Unreadable: ({ error }) => Effect.fail(error),
    });
  },
  Effect.scoped
);
