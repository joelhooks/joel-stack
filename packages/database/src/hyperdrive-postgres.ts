import * as Cloudflare from "alchemy/Cloudflare";
import * as Drizzle from "alchemy/Drizzle";
import type { StaticConnectionSource } from "alchemy/SQL/ConnectionSource";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";

import {
  databaseMigrationDirectory,
  databaseSchemaFile,
} from "./migrations.js";
import { RunLogLayer } from "./run-log-vendor.js";
import { DatabaseVendor } from "./vendor.js";

export type PostgresOrigin = Omit<
  Cloudflare.Hyperdrive.PublicOrigin,
  "scheme"
> & { readonly scheme: "postgres" | "postgresql" };

export type PostgresDevOrigin = Omit<
  Cloudflare.Hyperdrive.DevOrigin,
  "scheme"
> & { readonly scheme: "postgres" | "postgresql" };

export interface HyperdrivePostgresOptions {
  readonly id: string;
  readonly origin: PostgresOrigin;
  readonly dev?: PostgresDevOrigin;
  readonly migrate?: StaticConnectionSource;
}

const connectionString = (origin: PostgresOrigin | PostgresDevOrigin) => {
  const url = new URL(`${origin.scheme}://${origin.host}`);
  url.port = origin.port === undefined ? "" : String(origin.port);
  url.pathname = `/${origin.database}`;
  url.username = origin.user;
  url.password = Redacted.value(origin.password);
  url.searchParams.set("sslmode", "require");

  return Redacted.make(url.toString());
};

export const HyperdrivePostgres = ({
  id,
  origin,
  dev,
  migrate,
}: HyperdrivePostgresOptions) =>
  Layer.unwrap(
    Effect.gen(function* buildHyperdrivePostgresLayer() {
      const migrations = yield* Drizzle.Schema(`${id}-postgres-schema`, {
        dialect: "postgres",
        out: databaseMigrationDirectory("postgres"),
        schema: databaseSchemaFile("postgres"),
      });

      const connectionOptions =
        dev === undefined
          ? { caching: { disabled: true }, origin }
          : { caching: { disabled: true }, dev, origin };

      const connection = yield* Cloudflare.Hyperdrive.Connection(
        `${id}-hyperdrive`,
        connectionOptions
      );

      const migrationUrl = migrate ?? connectionString(dev ?? origin);

      if (globalThis.__ALCHEMY_RUNTIME__ !== true) {
        const { registerPostgresMigrations } = yield* Effect.promise(
          // oxlint-disable-next-line promise-function-async -- Effect.promise consumes a Promise factory directly.
          () => import("./postgres-migrations.js")
        );

        yield* registerPostgresMigrations({
          databaseId: connection.hyperdriveId,
          directory: databaseMigrationDirectory("postgres"),
          id,
          schemaHash: migrations.snapshotHash,
          source: migrationUrl,
        });
      }

      const vendor = {
        _tag: "HyperdrivePostgres" as const,
        connection,
        migrationUrl,
      };

      return Layer.mergeAll(
        RunLogLayer(vendor),
        Layer.succeed(DatabaseVendor, vendor)
      );
    })
  ).pipe(Layer.provide(Cloudflare.Hyperdrive.ConnectBinding));
