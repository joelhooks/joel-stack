import { NodeServices } from "@effect/platform-node";
import { PGlite } from "@electric-sql/pglite";
import { desc, eq } from "drizzle-orm";
import { drizzle as drizzlePostgres } from "drizzle-orm/pglite";
import { drizzle as drizzleSqlite } from "drizzle-orm/sql-js";
import { Clock, Context, Effect, FileSystem, Layer, Path } from "effect";
import initSqlJs from "sql.js";

import { DatabaseError } from "../src/model.js";
import { runLogLayer } from "../src/run-log.js";
import { RunLogs as D1RunLogs } from "../src/schema/d1.js";
import { RunLogs as PostgresRunLogs } from "../src/schema/postgres.js";

export class ControlledClock extends Context.Service<
  ControlledClock,
  { readonly setTime: (timestamp: number) => void }
>()("@rat-stack/database/test/ControlledClock") {}

const makeClock = () => {
  let now = 0;

  const service: Clock.Clock = {
    currentTimeMillis: Effect.sync(() => now),
    currentTimeMillisUnsafe: () => now,
    currentTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    currentTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
    monotonicTimeNanos: Effect.sync(() => BigInt(now) * 1_000_000n),
    monotonicTimeNanosUnsafe: () => BigInt(now) * 1_000_000n,
    sleep: () => Effect.void,
  };

  return {
    control: { setTime: (timestamp: number) => (now = timestamp) },
    service,
  };
};

const d1Layer = runLogLayer(
  Effect.gen(function* buildD1StoreOperations() {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const SQL = yield* Effect.tryPromise({
      catch: (cause) => new DatabaseError({ cause, operation: "record" }),
      // @effect-diagnostics-next-line asyncFunction:off -- SQL.js initializes its local SQLite engine through a Promise API.
      try: async () => await initSqlJs(),
    });

    const database = yield* Effect.acquireRelease(
      Effect.sync(() => new SQL.Database()),
      (connection) =>
        Effect.sync(() => {
          connection.close();
        })
    );

    const migrationRoot = path.resolve("migrations/d1");

    const migrationDirectories = (yield* fileSystem.readDirectory(
      migrationRoot
    )).toSorted();

    for (const directory of migrationDirectories) {
      const migration = yield* fileSystem.readFileString(
        path.resolve(migrationRoot, directory, "migration.sql")
      );

      yield* Effect.sync(() => database.exec(migration));
    }

    const db = drizzleSqlite(database);

    return {
      insert: (row) =>
        Effect.tryPromise({
          catch: (cause) => new DatabaseError({ cause, operation: "record" }),
          // @effect-diagnostics-next-line asyncFunction:off -- The SQL.js Drizzle adapter exposes Promise-based queries.
          try: async () => {
            const [inserted] = await db
              .insert(D1RunLogs)
              .values({
                capability: row.capability,
                failureTag: row.failureTag,
                id: row.id,
                outcome: row.outcome,
                personId: row.personId,
                recordedAt: row.recordedAt,
              })
              .returning();

            return inserted;
          },
        }),
      listRecent: (personId, limit) =>
        Effect.tryPromise({
          catch: (cause) =>
            new DatabaseError({ cause, operation: "listRecent" }),
          // @effect-diagnostics-next-line asyncFunction:off -- The SQL.js Drizzle adapter exposes Promise-based queries.
          try: async () =>
            await db
              .select()
              .from(D1RunLogs)
              .where(eq(D1RunLogs.personId, personId))
              .orderBy(desc(D1RunLogs.recordedAt), desc(D1RunLogs.id))
              .limit(limit),
        }),
    };
  })
);

const postgresLayer = runLogLayer(
  Effect.gen(function* buildPostgresStoreOperations() {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const connection = yield* Effect.acquireRelease(
      Effect.tryPromise({
        catch: (cause) => new DatabaseError({ cause, operation: "record" }),
        // @effect-diagnostics-next-line asyncFunction:off -- PGlite creates its local Postgres engine through a Promise API.
        try: async () => await PGlite.create(),
      }),
      (client) =>
        Effect.promise(
          // @effect-diagnostics-next-line asyncFunction:off -- PGlite closes its local Postgres engine through a Promise API.
          async () => {
            await client.close();
          }
        )
    );

    const migrationRoot = path.resolve("migrations/postgres");

    const migrationDirectories = (yield* fileSystem.readDirectory(
      migrationRoot
    )).toSorted();

    for (const directory of migrationDirectories) {
      const migration = yield* fileSystem.readFileString(
        path.resolve(migrationRoot, directory, "migration.sql")
      );

      yield* Effect.tryPromise({
        catch: (cause) => new DatabaseError({ cause, operation: "record" }),
        // @effect-diagnostics-next-line asyncFunction:off -- PGlite executes migration SQL through a Promise API.
        try: async () => await connection.exec(migration),
      });
    }

    const db = drizzlePostgres({ client: connection });

    return {
      insert: (row) =>
        Effect.tryPromise({
          catch: (cause) => new DatabaseError({ cause, operation: "record" }),
          // @effect-diagnostics-next-line asyncFunction:off -- PGlite's Drizzle adapter exposes Promise-based queries.
          try: async () => {
            const [inserted] = await db
              .insert(PostgresRunLogs)
              .values({
                capability: row.capability,
                failureTag: row.failureTag,
                id: row.id,
                outcome: row.outcome,
                personId: row.personId,
                recordedAt: row.recordedAt,
              })
              .returning();

            return inserted;
          },
        }),
      listRecent: (personId, limit) =>
        Effect.tryPromise({
          catch: (cause) =>
            new DatabaseError({ cause, operation: "listRecent" }),
          // @effect-diagnostics-next-line asyncFunction:off -- PGlite's Drizzle adapter exposes Promise-based queries.
          try: async () =>
            await db
              .select()
              .from(PostgresRunLogs)
              .where(eq(PostgresRunLogs.personId, personId))
              .orderBy(
                desc(PostgresRunLogs.recordedAt),
                desc(PostgresRunLogs.id)
              )
              .limit(limit),
        }),
    };
  })
);

const d1Clock = makeClock();

const postgresClock = makeClock();

export const localD1Layer = Layer.provideMerge(
  d1Layer,
  Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(Clock.Clock, d1Clock.service),
    Layer.succeed(ControlledClock, d1Clock.control)
  )
);

export const localPostgresLayer = Layer.provideMerge(
  postgresLayer,
  Layer.mergeAll(
    NodeServices.layer,
    Layer.succeed(Clock.Clock, postgresClock.service),
    Layer.succeed(ControlledClock, postgresClock.control)
  )
);
