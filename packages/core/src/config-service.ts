import { Config, Context, Effect, Layer } from "effect";

type ConfigMap = Record<string, Config.Config<unknown>>;

export type ConfigValues<Fields extends ConfigMap> = {
  readonly [Key in keyof Fields]: Config.Success<Fields[Key]>;
};

export type ServiceClass<
  Self,
  Id extends string,
  Service,
> = Context.ServiceClass<Self, Id, Service> & {
  readonly configLayer: (input: Service) => Layer.Layer<Self>;
  readonly layer: Layer.Layer<Self, Config.ConfigError>;
};

const Service =
  <Self>() =>
  <const Id extends string, const Fields extends ConfigMap>(
    id: Id,
    fields: Fields
  ): ServiceClass<Self, Id, ConfigValues<Fields>> => {
    // @effect-diagnostics-next-line classSelfMismatch:off -- The generic factory hands the Self type in from the caller, which is the point of the pattern, so the class-name check does not apply here.
    class ConfigTag extends Context.Service<Self, ConfigValues<Fields>>()(id) {
      static configLayer(input: ConfigValues<Fields>): Layer.Layer<Self> {
        return Layer.succeed(this, input);
      }

      static get layer(): Layer.Layer<Self, Config.ConfigError> {
        return Layer.effect(
          this,
          Effect.gen(function* makeConfig() {
            // SAFETY: Config.all's conditional return type cannot be evaluated for a generic record, but for a Record<string, Config> it is exactly ConfigValues<Fields>.
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion
            const parsed = (yield* Config.all(fields)) as ConfigValues<Fields>;

            return parsed;
          })
        );
      }
    }

    return ConfigTag;
  };

export const ConfigService = { Service } as const;
