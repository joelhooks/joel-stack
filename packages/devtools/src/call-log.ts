import { Context, Effect, Layer, Schema } from "effect";

import { DEFAULT_CAPACITY, boundedLog } from "./ring.js";
import type { RingSnapshot } from "./ring.js";

export const OutcomeSchema = Schema.TaggedUnion({
  Died: { message: Schema.String },
  Failed: { failure: Schema.Json, failureTag: Schema.String },
  Succeeded: { output: Schema.Json },
});

export type Outcome = typeof OutcomeSchema.Type;

export const CallEntrySchema = Schema.Struct({
  as: Schema.Json,
  capability: Schema.String,
  durationMs: Schema.Int,
  index: Schema.Int,
  input: Schema.Json,
  outcome: OutcomeSchema,
  startedAt: Schema.Int,
});

export type CallEntry = typeof CallEntrySchema.Type;

export type NewCall = Omit<CallEntry, "index">;

export type CallLogSnapshot = RingSnapshot<CallEntry>;

const makeCallLog = (capacity: number) =>
  Effect.gen(function* buildCallLog() {
    const ring = yield* boundedLog<CallEntry>(capacity);

    return {
      append: (call: NewCall) => ring.append((index) => ({ ...call, index })),
      snapshot: ring.snapshot,
    } as const;
  });

export class CallLog extends Context.Service<
  CallLog,
  {
    readonly append: (call: NewCall) => Effect.Effect<CallEntry>;
    readonly snapshot: Effect.Effect<CallLogSnapshot>;
  }
>()("@rat-stack/devtools/CallLog") {
  static readonly layer = (capacity: number = DEFAULT_CAPACITY) =>
    Layer.effect(this, makeCallLog(capacity));
}
