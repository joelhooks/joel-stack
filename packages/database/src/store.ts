import { Effect, Schema } from "effect";

import {
  DatabaseError,
  PersonIdSchema,
  RunIdSchema,
  RunLogEntrySchema,
  RunOutcomeSchema,
} from "./model.js";
import type { DatabaseOperation, PersonId, RunLogEntry } from "./model.js";

export const PersistedRunLogRowSchema = Schema.Struct({
  capability: Schema.NonEmptyString,
  failureTag: Schema.NullOr(Schema.String),
  id: RunIdSchema,
  outcome: Schema.Literals(["Failed", "Succeeded"]),
  personId: PersonIdSchema,
  recordedAt: Schema.Int,
});

export type PersistedRunLogRow = typeof PersistedRunLogRowSchema.Type;

export interface RunLogOperations {
  readonly insert: (
    row: PersistedRunLogRow
  ) => Effect.Effect<unknown, DatabaseError>;
  readonly listRecent: (
    personId: PersonId,
    limit: number
  ) => Effect.Effect<readonly unknown[], DatabaseError>;
}

export interface RunLogRepository {
  readonly record: (
    row: PersistedRunLogRow
  ) => Effect.Effect<RunLogEntry, DatabaseError>;
  readonly listRecent: (
    personId: PersonId,
    limit: number
  ) => Effect.Effect<readonly RunLogEntry[], DatabaseError>;
}

const invalidOutcome = (operation: DatabaseOperation) =>
  Effect.fail(
    new DatabaseError({
      cause: new Error("Stored run outcome does not match its failure tag"),
      operation,
    })
  );

const decodeEntry = (operation: DatabaseOperation, row: PersistedRunLogRow) => {
  let outcome: RunLogEntry["outcome"];

  if (row.outcome === "Succeeded") {
    if (row.failureTag === null) {
      outcome = RunOutcomeSchema.cases.Succeeded.make({});
    } else {
      return invalidOutcome(operation);
    }
  } else if (row.failureTag === null) {
    return invalidOutcome(operation);
  } else {
    outcome = RunOutcomeSchema.cases.Failed.make({ failure: row.failureTag });
  }

  return Schema.decodeEffect(RunLogEntrySchema)({
    capability: row.capability,
    id: row.id,
    outcome,
    personId: row.personId,
    recordedAt: row.recordedAt,
  }).pipe(Effect.mapError((cause) => new DatabaseError({ cause, operation })));
};

export const runLogRepository = (
  storeOperations: RunLogOperations
): RunLogRepository => ({
  listRecent: Effect.fn("RunLogRepository.listRecent")(
    function* listRecent(personId, limit) {
      const rows = yield* storeOperations.listRecent(personId, limit);

      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach is not Array#forEach; the callback is an effectful mapper.
      const persisted = yield* Effect.forEach(rows, (row) =>
        Schema.decodeUnknownEffect(PersistedRunLogRowSchema)(row).pipe(
          Effect.mapError(
            (cause) => new DatabaseError({ cause, operation: "listRecent" })
          )
        )
      );

      // oxlint-disable-next-line unicorn/no-array-method-this-argument -- Effect.forEach is not Array#forEach; the callback is an effectful mapper.
      return yield* Effect.forEach(persisted, (row) =>
        decodeEntry("listRecent", row)
      );
    }
  ),
  record: Effect.fn("RunLogRepository.record")(function* record(row) {
    const value = yield* storeOperations.insert(row);

    const persisted = yield* Schema.decodeUnknownEffect(
      PersistedRunLogRowSchema
    )(value).pipe(
      Effect.mapError(
        (cause) => new DatabaseError({ cause, operation: "record" })
      )
    );

    return yield* decodeEntry("record", persisted);
  }),
});
