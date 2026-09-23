import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as DrizzlePostgres from "alchemy/Drizzle/Postgres";
import * as RuntimeContext from "alchemy/RuntimeContext";
import { desc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DatabaseError } from "./model.js";
import { runLogLayer } from "./run-log.js";
import { RunLogs } from "./schema/postgres.js";

export interface HyperdrivePostgresOptions {
  readonly id: string;
  readonly origin: Cloudflare.Hyperdrive.Origin;
  readonly dev?: Cloudflare.Hyperdrive.DevOrigin;
}

export const HyperdrivePostgres = ({
  id,
  origin,
  dev,
}: HyperdrivePostgresOptions) =>
  Layer.unwrap(
    Effect.gen(function* buildHyperdrivePostgresLayer() {
      yield* Drizzle.Schema(`${id}-postgres-schema`, {
        dialect: "postgres",
        out: "./packages/database/migrations/postgres",
        schema: "./packages/database/src/schema/postgres.ts",
      });

      const connectionOptions =
        dev === undefined
          ? { caching: { disabled: true }, origin }
          : { caching: { disabled: true }, dev, origin };

      const connection = yield* Cloudflare.Hyperdrive.Connection(
        `${id}-hyperdrive`,
        connectionOptions
      );

      const client = yield* Cloudflare.Hyperdrive.Connect(connection);
      const db = yield* DrizzlePostgres.Postgres(client.connectionString);

      return runLogLayer(
        Effect.succeed({
          insert: (row) =>
            db
              .insert(RunLogs)
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
                  (cause) => new DatabaseError({ cause, operation: "record" })
                ),
                Effect.provide(RuntimeContext.RuntimeContext.phantom)
              ),
          listRecent: (personId, limit) =>
            db
              .select()
              .from(RunLogs)
              .where(eq(RunLogs.personId, personId))
              .orderBy(desc(RunLogs.recordedAt), desc(RunLogs.id))
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
    })
  ).pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding));
