import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  databaseMigrationDirectory,
  databaseSchemaFile,
} from "./migrations.js";
import { RunLogLayer } from "./run-log-vendor.js";
import { DatabaseVendor } from "./vendor.js";

export interface D1Options {
  readonly id: string;
}

export const D1 = ({ id }: D1Options) =>
  Layer.unwrap(
    Effect.gen(function* buildD1Layer() {
      const migrations = yield* Drizzle.Schema(`${id}-d1-schema`, {
        dialect: "sqlite",
        out: databaseMigrationDirectory("d1"),
        schema: databaseSchemaFile("d1"),
      });

      const database = yield* Cloudflare.D1.Database(`${id}-d1`, {
        migrations,
      });

      const vendor = { _tag: "D1" as const, database };

      return Layer.mergeAll(
        RunLogLayer(vendor),
        Layer.succeed(DatabaseVendor, vendor)
      );
    })
  ).pipe(Layer.provide(Cloudflare.D1.QueryDatabaseBinding));
