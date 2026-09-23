import { Clock, Context, Crypto, Effect, Layer, Match, Schema } from "effect";

import {
  DatabaseError,
  ListRecentRunsInputSchema,
  RecordRunInputSchema,
  RunIdSchema,
} from "./model.js";
import type {
  ListRecentRunsInput,
  RecordRunInput,
  RunLogEntry,
} from "./model.js";
import { runLogRepository } from "./store.js";
import type {
  PersistedRunLogRow,
  RunLogOperations,
  RunLogRepository,
} from "./store.js";

export class RunLog extends Context.Service<
  RunLog,
  {
    readonly record: (
      input: RecordRunInput
    ) => Effect.Effect<RunLogEntry, DatabaseError>;
    readonly listRecent: (
      personId: ListRecentRunsInput["personId"],
      limit: number
    ) => Effect.Effect<readonly RunLogEntry[], DatabaseError>;
  }
>()("@rat-stack/database/RunLog") {}

const makeRunLogService = (store: RunLogRepository, crypto: Crypto.Crypto) =>
  RunLog.of({
    listRecent: Effect.fn("RunLog.listRecent")(
      function* listRecent(personId, limit) {
        const parsed = yield* Schema.decodeEffect(ListRecentRunsInputSchema)({
          limit,
          personId,
        }).pipe(
          Effect.mapError(
            (cause) => new DatabaseError({ cause, operation: "listRecent" })
          )
        );

        return yield* store.listRecent(parsed.personId, parsed.limit);
      }
    ),
    record: Effect.fn("RunLog.record")(function* record(input) {
      const parsed = yield* Schema.decodeEffect(RecordRunInputSchema)(
        input
      ).pipe(
        Effect.mapError(
          (cause) => new DatabaseError({ cause, operation: "record" })
        )
      );

      const id = yield* crypto.randomUUIDv7.pipe(
        Effect.flatMap((value) => Schema.decodeEffect(RunIdSchema)(value)),
        Effect.mapError(
          (cause) => new DatabaseError({ cause, operation: "record" })
        )
      );

      const recordedAt = yield* Clock.currentTimeMillis;

      const row = Match.value(parsed.outcome).pipe(
        Match.tags({
          Failed: (outcome) =>
            ({
              capability: parsed.capability,
              failureTag: outcome.failure,
              id,
              outcome: "Failed",
              personId: parsed.personId,
              recordedAt,
            }) satisfies PersistedRunLogRow,
          Succeeded: () =>
            ({
              capability: parsed.capability,
              failureTag: null,
              id,
              outcome: "Succeeded",
              personId: parsed.personId,
              recordedAt,
            }) satisfies PersistedRunLogRow,
        }),
        Match.exhaustive
      );

      return yield* store.record(row);
    }),
  });

export const runLogLayer = <E, R>(
  operations: Effect.Effect<RunLogOperations, E, R>
) =>
  Layer.effect(
    RunLog,
    Effect.gen(function* buildRunLogLayer() {
      const storeOperations = yield* operations;
      const store = runLogRepository(storeOperations);
      const crypto = yield* Crypto.Crypto;

      return makeRunLogService(store, crypto);
    })
  );
