import * as Cloudflare from "alchemy/Cloudflare";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { makeRoutes } from "./app.js";
import LegacyMcp from "./legacy-mcp/durable-object.js";
import { LEGACY_SESSION_HEADER } from "./legacy-mcp/session.js";
import { makeRateLimits, rateLimitDeclarations } from "./rate-limits.js";
import type { RateLimitBindings } from "./rate-limits.js";
import { layerWorkerLoader, sandboxLimits } from "./sandbox-worker-loader.js";
import type { WorkerLoaderBinding } from "./sandbox-worker-loader.js";

const cloudflareStaticCache = {
  // Cloudflare provides this global only when a request reaches the Worker.
  // oxlint-disable-next-line typescript/promise-function-async
  match: (request: Request) => caches.default.match(request),
  // Cloudflare provides this global only when a request reaches the Worker.
  // oxlint-disable-next-line typescript/promise-function-async
  put: (request: Request, response: Response) =>
    caches.default.put(request, response),
};

export default class Mischief extends Cloudflare.Worker<Mischief>()(
  "Mischief",
  {
    compatibility: { date: "2026-05-28" },
    dev: { port: 1337 },
    domain: { name: "ratstack.sh", redirects: ["www.ratstack.sh"] },
    main: import.meta.url,
  },
  Effect.gen(function* makeMischief() {
    yield* Cloudflare.WorkerLoader("CODE_SANDBOX");
    yield* Cloudflare.RateLimit("API_PER_IP", rateLimitDeclarations.API_PER_IP);
    yield* Cloudflare.RateLimit(
      "EXECUTE_GLOBAL",
      rateLimitDeclarations.EXECUTE_GLOBAL
    );
    yield* Cloudflare.RateLimit(
      "EXECUTE_PER_IP",
      rateLimitDeclarations.EXECUTE_PER_IP
    );

    const webBotAuthEnabled = yield* Config.Boolean(
      "WEB_BOT_AUTH_ENABLED"
    ).pipe(Config.withDefault(false));

    const webBotAuthPrivateJwk = yield* Config.option(
      Config.Redacted("WEB_BOT_AUTH_PRIVATE_JWK")
    );

    const environment = yield* Cloudflare.WorkerEnvironment;

    // These are the native runtime bindings declared above. Alchemy's typed
    // environment is populated dynamically, so this is the one boundary cast.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const bindings = environment as unknown as RateLimitBindings & {
      readonly CODE_SANDBOX: WorkerLoaderBinding;
    };

    const loader = bindings.CODE_SANDBOX;

    const rateLimits = makeRateLimits({
      API_PER_IP: bindings.API_PER_IP,
      EXECUTE_GLOBAL: bindings.EXECUTE_GLOBAL,
      EXECUTE_PER_IP: bindings.EXECUTE_PER_IP,
    });

    // Pre-2026-07-28 MCP clients get one object per session.
    const legacyMcp = yield* LegacyMcp;

    const workerRoutes = makeRoutes({
      legacyMcp: {
        forward: (session, request) => {
          const headers = new Headers(request.headers);
          headers.set(LEGACY_SESSION_HEADER, session);

          return legacyMcp
            .getByName(session)
            .fetch(HttpServerRequest.fromWeb(new Request(request, { headers })))
            .pipe(
              Effect.map((response) => HttpServerResponse.toWeb(response)),
              Effect.orDie
            );
        },
      },
      rateLimits,
      staticCache: cloudflareStaticCache,
      webBotAuth: {
        enabled: webBotAuthEnabled,
        ...(Option.isSome(webBotAuthPrivateJwk)
          ? { privateJwk: Redacted.value(webBotAuthPrivateJwk.value) }
          : {}),
      },
    }).pipe(Layer.provide(layerWorkerLoader(loader, sandboxLimits)));

    return {
      fetch: yield* HttpRouter.toHttpEffect(workerRoutes).pipe(Effect.orDie),
    };
  }).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding))
) {}
