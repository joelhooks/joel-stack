// A service whose implementation is derived from Effect `Config`.
//
// Pattern lifted from opencode (packages/opencode/src/effect/config-service.ts)
// and moved onto the rc.115 API. Effect `Config` stays the source of truth for
// env names, defaults, and validation; this generates a typed service plus a
// production layer (reads the active ConfigProvider) and a test layer (takes
// already-parsed values). varlock validates the same variables at the shell
// boundary; this is the in-process half.
import { Config, Context, Effect, Layer } from "effect";

type ConfigMap = Record<string, Config.Config<unknown>>;

/** The service shape inferred from an object of Effect `Config` definitions. */
export type Shape<Fields extends ConfigMap> = {
  readonly [Key in keyof Fields]: Config.Success<Fields[Key]>;
};

/** A Context service class with generated layers for config-backed services. */
export type ServiceClass<
  Self,
  Id extends string,
  Service,
> = Context.ServiceClass<Self, Id, Service> & {
  /** Provide already-parsed config, useful in tests. */
  readonly configLayer: (input: Service) => Layer.Layer<Self>;
  /** Parse config once from the active ConfigProvider and provide the service. */
  readonly layer: Layer.Layer<Self, Config.ConfigError>;
};

/**
 * Create a Context service whose implementation is derived from Effect `Config`.
 *
 * ```ts
 * class AppConfig extends ConfigService.Service<AppConfig>()(
 *   "@rat-stack/core/AppConfig",
 *   { appEnv: Config.Literals(["development", "production"], "APP_ENV") }
 * ) {}
 *
 * const live = AppConfig.layer
 * const test = AppConfig.configLayer({ appEnv: "production" })
 * ```
 */
const Service =
  <Self>() =>
  <const Id extends string, const Fields extends ConfigMap>(
    id: Id,
    fields: Fields
  ): ServiceClass<Self, Id, Shape<Fields>> => {
    // The generic factory hands the Self type in from the caller, which is the
    // point of the pattern, so the class-name check does not apply here.
    // @effect-diagnostics-next-line classSelfMismatch:off
    class ConfigTag extends Context.Service<Self, Shape<Fields>>()(id) {
      static configLayer(input: Shape<Fields>): Layer.Layer<Self> {
        return Layer.succeed(this, input);
      }

      static get layer(): Layer.Layer<Self, Config.ConfigError> {
        return Layer.effect(
          this,
          Effect.gen(function* makeConfig() {
            // Config.all's conditional return type cannot be evaluated for a
            // generic record, but for a Record<string, Config> it is exactly
            // Shape<Fields>.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            const parsed = (yield* Config.all(fields)) as Shape<Fields>;

            return parsed;
          })
        );
      }
    }

    return ConfigTag;
  };

/** Namespace-style access: `ConfigService.Service<Self>()(id, fields)`. */
export const ConfigService = { Service } as const;
