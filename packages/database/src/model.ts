import { Schema } from "effect";

export const PersonIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("PersonId")
);

export type PersonId = typeof PersonIdSchema.Type;

export const RunIdSchema = Schema.String.check(Schema.isUUID(7)).pipe(
  Schema.brand("RunId")
);

export type RunId = typeof RunIdSchema.Type;

export const RunOutcomeSchema = Schema.TaggedUnion({
  Failed: { failure: Schema.String },
  Succeeded: {},
});

export type RunOutcome = typeof RunOutcomeSchema.Type;

export const RecordRunInputSchema = Schema.Struct({
  capability: Schema.NonEmptyString,
  outcome: RunOutcomeSchema,
  personId: PersonIdSchema,
});

export type RecordRunInput = typeof RecordRunInputSchema.Type;

export const ListRecentRunsInputSchema = Schema.Struct({
  limit: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  personId: PersonIdSchema,
});

export type ListRecentRunsInput = typeof ListRecentRunsInputSchema.Type;

export const DatabaseOperationSchema = Schema.Literals([
  "listRecent",
  "record",
]);

export type DatabaseOperation = typeof DatabaseOperationSchema.Type;

export const RunLogEntrySchema = Schema.Struct({
  capability: Schema.NonEmptyString,
  id: RunIdSchema,
  outcome: RunOutcomeSchema,
  personId: PersonIdSchema,
  recordedAt: Schema.Int,
});

export type RunLogEntry = typeof RunLogEntrySchema.Type;

export class DatabaseError extends Schema.TaggedError<DatabaseError>()(
  "DatabaseError",
  {
    cause: Schema.Defect(),
    operation: DatabaseOperationSchema,
  }
) {}
