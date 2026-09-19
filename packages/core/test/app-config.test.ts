import { expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Layer } from "effect";

import { AppConfig } from "../src/index.js";

// AppConfig.layer reads whatever ConfigProvider is in scope, so a test can
// feed it a plain object instead of the process environment.
const withProvider = (root: unknown) =>
  Layer.provide(
    AppConfig.layer,
    ConfigProvider.layer(ConfigProvider.fromUnknown(root))
  );

it.effect("reads APP_ENV through the active ConfigProvider", () =>
  Effect.gen(function* readsFromProvider() {
    const config = yield* AppConfig;
    expect(config.appEnv).toBe("test");
  }).pipe(Effect.provide(withProvider({ APP_ENV: "test" })))
);

it.effect("falls back to the declared default", () =>
  Effect.gen(function* fallsBackToDefault() {
    const config = yield* AppConfig;
    expect(config.appEnv).toBe("development");
  }).pipe(Effect.provide(withProvider({})))
);

it.effect("rejects values outside the literal set", () =>
  Effect.gen(function* rejectsUnknownLiteral() {
    const error = yield* Effect.flip(
      Layer.build(withProvider({ APP_ENV: "staging" }))
    );
    expect(error._tag).toBe("ConfigError");
  })
);

it.effect("configLayer skips parsing for tests", () =>
  Effect.gen(function* skipsParsingInTests() {
    const config = yield* AppConfig;
    expect(config.appEnv).toBe("production");
  }).pipe(Effect.provide(AppConfig.configLayer({ appEnv: "production" })))
);
