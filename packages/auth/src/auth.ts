import { BetterAuth, Memory } from "@alchemy.run/better-auth";
import type {
  BetterAuthInstance,
  BetterAuthProps,
} from "@alchemy.run/better-auth";
import { CloudflareD1 } from "@alchemy.run/better-auth/CloudflareD1";
import { CloudflareHyperdrive } from "@alchemy.run/better-auth/CloudflareHyperdrive";
import { DatabaseVendor } from "@rat-stack/database";
import { Context, Effect, Layer, Match } from "effect";

export const authOptions = {
  basePath: "/auth",
  emailAndPassword: { enabled: true },
} as const;

export type AuthInstance = BetterAuthInstance<typeof authOptions>;

export interface AuthLayerOptions {
  readonly id?: string;
  readonly secret?: BetterAuthProps["secret"];
}

export interface MemoryLayerOptions {
  readonly baseURL?: string;
}

// @effect-diagnostics-next-line leakingRequirements:off -- Better Auth methods intentionally retain the per-request RuntimeContext requirement.
export class Auth extends Context.Service<Auth, AuthInstance>()(
  "@rat-stack/auth/Auth"
) {
  static layer(options: AuthLayerOptions = {}) {
    return Layer.unwrap(
      Effect.gen(function* buildAuthLayer() {
        const vendor = yield* DatabaseVendor;

        const database = Match.value(vendor).pipe(
          Match.tags({
            D1: (d1) => CloudflareD1(d1.database),
            HyperdrivePostgres: (postgres) =>
              CloudflareHyperdrive(postgres.connection, {
                migrate: postgres.migrationUrl,
              }),
          }),
          Match.exhaustive
        );

        const optionsWithId =
          options.id === undefined
            ? authOptions
            : { ...authOptions, id: options.id };

        const configuredOptions =
          options.secret === undefined
            ? optionsWithId
            : { ...optionsWithId, secret: options.secret };

        return Layer.effect(
          Auth,
          BetterAuth(configuredOptions).pipe(Effect.provide(database))
        );
      })
    );
  }

  static memoryLayer(secret: string, options: MemoryLayerOptions = {}) {
    const configured =
      options.baseURL === undefined
        ? { ...authOptions, secret }
        : { ...authOptions, baseURL: options.baseURL, secret };

    return Layer.effect(
      Auth,
      BetterAuth(configured).pipe(Effect.provide(Memory()))
    );
  }
}
