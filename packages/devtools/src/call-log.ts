import { Context, Effect, Layer, Ref, Schema } from "effect";

export const OutcomeSchema = Schema.TaggedUnion({
  Died: { message: Schema.String },
  Failed: { failure: Schema.Json, failureTag: Schema.String },
  Succeeded: { output: Schema.Json },
});

export type Outcome = typeof OutcomeSchema.Type;

export const CallEntrySchema = Schema.Struct({
  capability: Schema.String,
  durationMs: Schema.Int,
  index: Schema.Int,
  input: Schema.Json,
  outcome: OutcomeSchema,
  startedAt: Schema.Int,
});

export type CallEntry = typeof CallEntrySchema.Type;

export type NewCall = Omit<CallEntry, "index">;

export interface CallLogSnapshot {
  readonly entries: readonly CallEntry[];
  readonly firstIndex: number;
  readonly nextIndex: number;
}

export const DEFAULT_CAPACITY = 500;

const makeCallLog = (capacity: number) =>
  Effect.gen(function* buildCallLog() {
    const state = yield* Ref.make<{
      readonly entries: readonly CallEntry[];
      readonly nextIndex: number;
    }>({ entries: [], nextIndex: 0 });

    const append = (call: NewCall) =>
      Ref.modify(state, ({ entries, nextIndex }) => {
        const entry: CallEntry = { ...call, index: nextIndex };

        return [
          entry,
          {
            entries: [...entries, entry].slice(-capacity),
            nextIndex: nextIndex + 1,
          },
        ] as const;
      });

    const snapshot = Ref.get(state).pipe(
      Effect.map(({ entries, nextIndex }): CallLogSnapshot => ({
        entries,
        firstIndex: entries.at(0)?.index ?? nextIndex,
        nextIndex,
      }))
    );

    return { append, snapshot } as const;
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
