import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import { layerWorkerLoader, sandboxLimits } from "../sandbox-worker-loader.js";
import type { WorkerLoaderBinding } from "../sandbox-worker-loader.js";
import { legacyMcpRuntime } from "./runtime.js";
import { LEGACY_SESSION_HEADER, openLegacySession } from "./session.js";
import type { StoredSession } from "./session.js";

const SESSION_KEY = "session";

export default class LegacyMcp extends Cloudflare.DurableObject<LegacyMcp>()(
  "LegacyMcp",
  Effect.gen(function* makeLegacyMcp() {
    const environment = yield* Cloudflare.WorkerEnvironment;

    // SAFETY: the object shares its Worker's environment. The Worker declares this binding; the object only reads it. This is the one boundary cast.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const bindings = environment as {
      readonly CODE_SANDBOX: WorkerLoaderBinding;
    };

    const state = yield* Cloudflare.DurableObjectState;

    const forward = yield* legacyMcpRuntime(
      layerWorkerLoader(bindings.CODE_SANDBOX, sandboxLimits)
    );

    // @effect-diagnostics-next-line returnEffectInGen:off -- Alchemy's DurableObject contract returns the per-instance Effect.
    return Effect.gen(function* makeInstance() {
      const session = yield* openLegacySession({
        forward,
        storage: {
          load: state.storage.get<StoredSession>(SESSION_KEY),
          save: (stored) => state.storage.put(SESSION_KEY, stored),
        },
      });

      return {
        fetch: Effect.gen(function* serveSession() {
          const request = yield* HttpServerRequest.HttpServerRequest;

          const web = yield* HttpServerRequest.toWeb(request).pipe(
            Effect.orDie
          );

          const id = web.headers.get(LEGACY_SESSION_HEADER) ?? "";

          return HttpServerResponse.fromWeb(yield* session.handle(web, id));
        }),
      };
    });
  })
) {}
