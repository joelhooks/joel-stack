import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as DrizzlePostgres from "alchemy/Drizzle/Postgres";
import * as RuntimeContext from "alchemy/RuntimeContext";
import { desc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Match from "effect/Match";

import { DatabaseError } from "./model.js";
import { runLogLayer } from "./run-log.js";
import { RunLogs as D1RunLogs } from "./schema/d1.js";
import { RunLogs as PostgresRunLogs } from "./schema/postgres.js";
import type { DatabaseVendorResource } from "./vendor.js";

export const RunLogLayer = (vendor: DatabaseVendorResource) =>
  Layer.unwrap(
    Match.value(vendor).pipe(
      Match.tags({
        D1: (d1) =>
          Effect.gen(function* makeD1RunLogLayer() {
            const client = yield* Cloudflare.D1.QueryDatabase(d1.database);

            const db = yield* Drizzle.D1(client);

            return runLogLayer(
              Effect.succeed({
                insert: (row) =>
                  db
                    .insert(D1RunLogs)
                    .values({
                      capability: row.capability,
                      failureTag: row.failureTag,
                      id: row.id,
                      outcome: row.outcome,
                      personId: row.personId,
                      recordedAt: row.recordedAt,
                    })
                    .returning()
                    .pipe(
                      Effect.map(([inserted]) => inserted),
                      Effect.mapError(
                        (cause) =>
                          new DatabaseError({ cause, operation: "record" })
                      ),
                      Effect.provide(RuntimeContext.RuntimeContext.phantom)
                    ),
                listRecent: (personId, limit) =>
                  db
                    .select()
                    .from(D1RunLogs)
                    .where(eq(D1RunLogs.personId, personId))
                    .orderBy(desc(D1RunLogs.recordedAt), desc(D1RunLogs.id))
                    .limit(limit)
                    .pipe(
                      Effect.mapError(
                        (cause) =>
                          new DatabaseError({ cause, operation: "listRecent" })
                      ),
                      Effect.provide(RuntimeContext.RuntimeContext.phantom)
                    ),
              })
            );
          }),
        HyperdrivePostgres: (postgres) =>
          Effect.gen(function* makePostgresRunLogLayer() {
            const client = yield* Cloudflare.Hyperdrive.Connect(
              postgres.connection
            );

            const db = yield* DrizzlePostgres.Postgres(client.connectionString);

            return runLogLayer(
              Effect.succeed({
                insert: (row) =>
                  db
                    .insert(PostgresRunLogs)
                    .values({
                      capability: row.capability,
                      failureTag: row.failureTag,
                      id: row.id,
                      outcome: row.outcome,
                      personId: row.personId,
                      recordedAt: row.recordedAt,
                    })
                    .returning()
                    .pipe(
                      Effect.map(([inserted]) => inserted),
                      Effect.mapError(
                        (cause) =>
                          new DatabaseError({ cause, operation: "record" })
                      ),
                      Effect.provide(RuntimeContext.RuntimeContext.phantom)
                    ),
                listRecent: (personId, limit) =>
                  db
                    .select()
                    .from(PostgresRunLogs)
                    .where(eq(PostgresRunLogs.personId, personId))
                    .orderBy(
                      desc(PostgresRunLogs.recordedAt),
                      desc(PostgresRunLogs.id)
                    )
                    .limit(limit)
                    .pipe(
                      Effect.mapError(
                        (cause) =>
                          new DatabaseError({ cause, operation: "listRecent" })
                      ),
                      Effect.provide(RuntimeContext.RuntimeContext.phantom)
                    ),
              })
            );
          }),
      }),
      Match.exhaustive
    )
  );
