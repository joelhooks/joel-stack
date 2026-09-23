import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as RuntimeContext from "alchemy/RuntimeContext";
import { desc, eq } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { DatabaseError } from "./model.js";
import { runLogLayer } from "./run-log.js";
import { RunLogs } from "./schema/d1.js";

export interface D1Options {
  readonly id: string;
}

export const D1 = ({ id }: D1Options) =>
  Layer.unwrap(
    Effect.gen(function* buildD1Layer() {
      const migrations = yield* Drizzle.Schema(`${id}-d1-schema`, {
        dialect: "sqlite",
        out: "./packages/database/migrations/d1",
        schema: "./packages/database/src/schema/d1.ts",
      });

      const database = yield* Cloudflare.D1.Database(`${id}-d1`, {
        migrations,
      });

      const client = yield* Cloudflare.D1.QueryDatabase(database);
      const db = yield* Drizzle.D1(client);

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
  ).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));
