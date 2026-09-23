import { Action } from "alchemy";
import type { Input } from "alchemy";
import { CurrentRuntimeContext, sanitizeKey } from "alchemy/RuntimeContext";
import {
  connectionSourceDigest,
  resolveConnectionSource,
} from "alchemy/SQL/ConnectionSource";
import type { StaticConnectionSource } from "alchemy/SQL/ConnectionSource";
import type { SqlExecutor } from "alchemy/SQL/Migrations/Format";
import { makePgMigrationExecutor } from "alchemy/SQL/Migrations/PgExecutor";
import {
  normalizeMigrationsInput,
  runMigrations,
} from "alchemy/SQL/Migrations/Registry";
import * as Effect from "effect/Effect";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";

class PostgresMigrationConnectionError extends Schema.TaggedError<PostgresMigrationConnectionError>()(
  "PostgresMigrationConnectionError",
  { cause: Schema.Defect() }
) {}

interface MigrationInput {
  readonly databaseId: string;
  readonly directory: string;
  readonly schemaHash: string;
  readonly sourceDigest: string;
}

export const runPostgresMigrations = (
  directory: string,
  executor: SqlExecutor
) =>
  runMigrations({
    input: normalizeMigrationsInput(directory),
    stamped: {},
    withExecutor: (apply) => apply(executor),
  });

export const registerPostgresMigrations = (options: {
  readonly id: string;
  readonly databaseId: Input<string>;
  readonly directory: string;
  readonly schemaHash: Input<string>;
  readonly source: StaticConnectionSource;
}) =>
  Effect.gen(function* registerMigrations() {
    const Migrate = Action(
      "Database.PostgresMigrate",
      Effect.gen(function* makeRunner() {
        const connectionUrl = yield* resolveConnectionSource(options.source);

        return (input: MigrationInput) =>
          Effect.scoped(
            Effect.gen(function* applyMigrations() {
              const url = Redacted.value(yield* connectionUrl);

              const { Client } = yield* Effect.promise(
                // oxlint-disable-next-line promise-function-async -- Effect.promise consumes a Promise factory directly.
                () => import("pg")
              );

              return yield* Effect.acquireUseRelease(
                Effect.tryPromise({
                  catch: (cause) =>
                    new PostgresMigrationConnectionError({ cause }),
                  // @effect-diagnostics-next-line asyncFunction:off -- The pg client exposes Promise-based connection setup.
                  try: async () => {
                    const connection = new Client({ connectionString: url });

                    await connection.connect();

                    return connection;
                  },
                }),
                (connection) =>
                  runPostgresMigrations(
                    input.directory,
                    makePgMigrationExecutor(connection)
                  ),
                (connection) =>
                  Effect.tryPromise({
                    catch: (cause) =>
                      new PostgresMigrationConnectionError({ cause }),
                    // @effect-diagnostics-next-line asyncFunction:off -- The pg client exposes Promise-based shutdown.
                    try: async () => {
                      await connection.end();
                    },
                  }).pipe(Effect.orDie)
              );
            })
          );
      })
    );

    const result = yield* Migrate(`${options.id}-postgres-migrations`, {
      databaseId: options.databaseId,
      directory: options.directory,
      schemaHash: options.schemaHash,
      sourceDigest: connectionSourceDigest(options.source),
    });

    const runtimeContext = yield* CurrentRuntimeContext;

    if (runtimeContext !== undefined) {
      yield* runtimeContext.set(
        sanitizeKey(`${options.id}PostgresMigrations`),
        result
      );
    }
  });
