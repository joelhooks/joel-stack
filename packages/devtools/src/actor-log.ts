import { Context, Effect, Layer, Schema } from "effect";

import { DEFAULT_CAPACITY, boundedLog } from "./ring.js";
import type { RingSnapshot } from "./ring.js";

export const ActorEntrySchema = Schema.Struct({
  actorId: Schema.String,
  at: Schema.Int,
  context: Schema.Json,
  event: Schema.Json,
  eventType: Schema.String,
  index: Schema.Int,
  kind: Schema.Literals(["started", "transition", "deadletter"]),
  machine: Schema.String,
  rootId: Schema.String,
  state: Schema.Json,
  status: Schema.String,
});

export type ActorEntry = typeof ActorEntrySchema.Type;

export type NewActorEntry = Omit<ActorEntry, "index">;

export type ActorLogSnapshot = RingSnapshot<ActorEntry>;

const makeActorLog = (capacity: number) =>
  Effect.gen(function* buildActorLog() {
    const ring = yield* boundedLog<ActorEntry>(capacity);

    return {
      append: (entry: NewActorEntry) =>
        ring.append((index) => ({ ...entry, index })),
      snapshot: ring.snapshot,
    } as const;
  });

export class ActorLog extends Context.Service<
  ActorLog,
  {
    readonly append: (entry: NewActorEntry) => Effect.Effect<ActorEntry>;
    readonly snapshot: Effect.Effect<ActorLogSnapshot>;
  }
>()("@rat-stack/devtools/ActorLog") {
  static readonly layer = (capacity: number = DEFAULT_CAPACITY) =>
    Layer.effect(this, makeActorLog(capacity));
}
