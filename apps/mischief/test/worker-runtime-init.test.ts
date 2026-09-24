import { expect, it } from "@effect/vitest";
import * as Cloudflare from "alchemy/Cloudflare";
import { ConfigProvider, Effect, Layer } from "effect";
import type { ConfigError } from "effect/Config";
import type * as Scope from "effect/Scope";

import type { MischiefRouteOptions } from "../src/app.js";
import type { RateLimitBindings } from "../src/rate-limits.js";
import type { WorkerLoaderBinding } from "../src/sandbox-worker-loader.js";
import { makeMischief } from "../src/worker.js";

type InitializedMischief = Effect.Effect<
  { readonly fetch: Cloudflare.Workers.HttpEffect },
  ConfigError,
  Scope.Scope
>;

const rateLimit = {
  // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's binding returns a native Promise.
  limit: () => Promise.resolve({ success: true }),
};

const rateLimitBindings: RateLimitBindings = {
  API_PER_IP: rateLimit,
  EXECUTE_GLOBAL: rateLimit,
  EXECUTE_PER_IP: rateLimit,
};

const workerEnvironment = {
  ...rateLimitBindings,
  CODE_SANDBOX: {
    load: () => {
      throw new Error("The runtime-init request must not invoke the sandbox");
    },
  } satisfies WorkerLoaderBinding,
};

const unavailableLegacyMcp = {
  forward: () => Effect.die(new Error("Unexpected legacy MCP request")),
} satisfies NonNullable<MischiefRouteOptions["legacyMcp"]>;

const runtimeBaseServices = Layer.mergeAll(
  Layer.succeed(Cloudflare.Workers.WorkerEnvironment, workerEnvironment),
  ConfigProvider.layer(ConfigProvider.fromUnknown({}))
);

const runtimeServices = Layer.provideMerge(
  Cloudflare.Workers.RateLimitBinding,
  runtimeBaseServices
);

it.effect(
  "starts the Worker and serves a request without deploy-time services",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = globalThis.__ALCHEMY_RUNTIME__;
        globalThis.__ALCHEMY_RUNTIME__ = true;

        return previous;
      }),
      () =>
        Effect.gen(function* runtimeRequest() {
          const erasedWorkerInit: unknown = makeMischief(
            unavailableLegacyMcp
          ).pipe(Effect.provide(runtimeServices));

          // SAFETY: runtimeServices provides the bindings Alchemy erases from the init effect type.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtimeServices provides the Worker init bindings.
          const workerInit = erasedWorkerInit as InitializedMischief;
          const worker = yield* workerInit;

          const handler = Cloudflare.Workers.makeRequestHandler(worker.fetch);

          const responseEffect: unknown = handler({
            context: {},
            env: workerEnvironment,
            input: new Request("https://ratstack.sh/not-a-route"),
            kind: "Cloudflare.Workers.WorkerEvent",
            type: "fetch",
          });

          if (responseEffect === undefined) {
            return yield* Effect.die(
              new Error("Worker fetch handler was absent")
            );
          }

          // SAFETY: Alchemy's handler provides request services before casting its response effect to any.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- makeRequestHandler erases its response effect type.
          const typedResponseEffect = responseEffect as Effect.Effect<Response>;
          const response = yield* typedResponseEffect;
          expect(response.status).toBe(404);

          return yield* Effect.void;
        }),
      (previous) =>
        Effect.sync(() => {
          globalThis.__ALCHEMY_RUNTIME__ = previous;
        })
    )
);
