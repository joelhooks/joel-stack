import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import {
  InvalidDatabaseInput,
  PersonIdSchema,
  RunLog,
  RunOutcomeSchema,
} from "../src/index.js";
import type { RunLogEntry } from "../src/index.js";
import {
  ControlledClock,
  localD1Layer,
  localPostgresLayer,
} from "./local-layers.js";

const primaryPerson = Schema.decodeSync(PersonIdSchema)("person-record");

const orderPerson = Schema.decodeSync(PersonIdSchema)("person-order");

const otherPerson = Schema.decodeSync(PersonIdSchema)("person-other");

const compareRunIdsDescending = (left: RunLogEntry, right: RunLogEntry) => {
  if (left.id > right.id) {
    return -1;
  }

  if (left.id < right.id) {
    return 1;
  }

  return 0;
};

const backends = [
  { label: "D1 with local SQLite", layer: localD1Layer },
  { label: "Hyperdrive Postgres with PGlite", layer: localPostgresLayer },
] as const;

for (const backend of backends) {
  it.layer(backend.layer)(`RunLog ${backend.label}`, (test) => {
    test.effect("records both outcome variants with the Effect clock", () =>
      Effect.gen(function* recordOutcomes() {
        const runLog = yield* RunLog;
        const clock = yield* ControlledClock;

        clock.setTime(1_714_567_890_123);

        const success = yield* runLog.record({
          capability: "inspectFile",
          outcome: RunOutcomeSchema.cases.Succeeded.make({}),
          personId: primaryPerson,
        });

        const failure = yield* runLog.record({
          capability: "inspectFile",
          outcome: RunOutcomeSchema.cases.Failed.make({
            failure: "ApprovalDenied",
          }),
          personId: primaryPerson,
        });

        expect(success.personId).toBe(primaryPerson);
        expect(success.capability).toBe("inspectFile");
        expect(success.recordedAt).toBe(1_714_567_890_123);
        expect(success.outcome).toEqual(
          RunOutcomeSchema.cases.Succeeded.make({})
        );
        expect(failure.personId).toBe(primaryPerson);
        expect(failure.capability).toBe("inspectFile");
        expect(failure.recordedAt).toBe(1_714_567_890_123);
        expect(failure.outcome).toEqual(
          RunOutcomeSchema.cases.Failed.make({ failure: "ApprovalDenied" })
        );
        expect(success.id).not.toBe(failure.id);
      })
    );

    test.effect(
      "filters by person, limits results, and orders by timestamp then id descending",
      () =>
        Effect.gen(function* listRecentRuns() {
          const runLog = yield* RunLog;
          const clock = yield* ControlledClock;

          clock.setTime(1_714_567_890_123);

          const tiedA = yield* runLog.record({
            capability: "first",
            outcome: RunOutcomeSchema.cases.Succeeded.make({}),
            personId: orderPerson,
          });

          const tiedB = yield* runLog.record({
            capability: "second",
            outcome: RunOutcomeSchema.cases.Succeeded.make({}),
            personId: orderPerson,
          });

          const other = yield* runLog.record({
            capability: "otherPerson",
            outcome: RunOutcomeSchema.cases.Succeeded.make({}),
            personId: otherPerson,
          });

          const tiedC = yield* runLog.record({
            capability: "third",
            outcome: RunOutcomeSchema.cases.Succeeded.make({}),
            personId: orderPerson,
          });

          clock.setTime(1_714_567_891_123);

          const newest = yield* runLog.record({
            capability: "newest",
            outcome: RunOutcomeSchema.cases.Succeeded.make({}),
            personId: orderPerson,
          });

          const tiedById = [tiedA, tiedB, tiedC].toSorted(
            compareRunIdsDescending
          );

          const recent = yield* runLog.listRecent(orderPerson, 100);
          const limited = yield* runLog.listRecent(orderPerson, 2);

          expect(recent.map((entry) => entry.id)).toEqual([
            newest.id,
            ...tiedById.map((entry) => entry.id),
          ]);
          expect(limited.map((entry) => entry.id)).toEqual([
            newest.id,
            tiedById[0]?.id,
          ]);
          expect(recent.some((entry) => entry.id === other.id)).toBe(false);
        })
    );

    test.effect("rejects limits outside the public schema", () =>
      Effect.gen(function* invalidLimits() {
        const runLog = yield* RunLog;

        const belowMinimum = yield* Effect.flip(
          runLog.listRecent(primaryPerson, 0)
        );

        const aboveMaximum = yield* Effect.flip(
          runLog.listRecent(primaryPerson, 101)
        );

        const invalidRecord = yield* Effect.flip(
          runLog.record({
            capability: "",
            outcome: RunOutcomeSchema.cases.Succeeded.make({}),
            personId: primaryPerson,
          })
        );

        expect(belowMinimum).toBeInstanceOf(InvalidDatabaseInput);
        expect(belowMinimum._tag).toBe("InvalidDatabaseInput");
        expect(belowMinimum.operation).toBe("listRecent");
        expect(aboveMaximum).toBeInstanceOf(InvalidDatabaseInput);
        expect(aboveMaximum._tag).toBe("InvalidDatabaseInput");
        expect(aboveMaximum.operation).toBe("listRecent");
        expect(invalidRecord).toBeInstanceOf(InvalidDatabaseInput);
        expect(invalidRecord._tag).toBe("InvalidDatabaseInput");
        expect(invalidRecord.operation).toBe("record");
      })
    );
  });
}
