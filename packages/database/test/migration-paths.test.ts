import { tmpdir } from "node:os";

import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";

import { PersonIdSchema, RunLog } from "../src/index.js";
import { localD1Layer, localPostgresLayer } from "./local-layers.js";

const personId = Schema.decodeSync(PersonIdSchema)("migration-path-check");

it.effect("loads migrations when the process runs outside the package", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => process.cwd()),
    (originalDirectory) =>
      Effect.gen(function* loadMigrationsFromTemporaryDirectory() {
        yield* Effect.sync(() => {
          process.chdir(tmpdir());
        });

        expect(process.cwd()).not.toBe(originalDirectory);

        const d1Entries = yield* RunLog.pipe(
          Effect.flatMap((runLog) => runLog.listRecent(personId, 1)),
          Effect.provide(localD1Layer)
        );

        const postgresEntries = yield* RunLog.pipe(
          Effect.flatMap((runLog) => runLog.listRecent(personId, 1)),
          Effect.provide(localPostgresLayer)
        );

        expect(d1Entries).toEqual([]);
        expect(postgresEntries).toEqual([]);
      }),
    (originalDirectory) =>
      Effect.sync(() => {
        process.chdir(originalDirectory);
      })
  )
);
