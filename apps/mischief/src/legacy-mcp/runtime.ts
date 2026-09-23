import type { Sandbox } from "@rat-stack/capability/sandbox";
import { Context, Effect, Layer } from "effect";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { legacyMcpProtocols, mcpLayer } from "../app.js";

type WebHandler = (request: Request) => Promise<Response>;

/**
 * Effect's stateful MCP runtime for the legacy protocols, as a request
 * handler. The Durable Object and the tests build it the same way.
 *
 * Two details keep it honest:
 * - It builds with its own memo map, so it gets a private router even when
 *   built inside another router's request (where `HttpRouter.toHttpEffect`
 *   would reuse the caller's router and collide on `/mcp`).
 * - Effect sets `Mcp-Session-Id` and some statuses in pre-response handlers,
 *   which only a server wrapper runs. `HttpEffect.toWebHandler` is the wrapper.
 */
export const legacyMcpRuntime = (sandbox: Layer.Layer<Sandbox>) =>
  Effect.gen(function* makeLegacyMcpRuntime() {
    const scope = yield* Effect.scope;
    const memoMap = yield* Layer.makeMemoMap;

    const context = yield* Layer.buildWithMemoMap(
      Layer.provideMerge(
        mcpLayer(legacyMcpProtocols).pipe(Layer.provide(sandbox)),
        HttpRouter.layer
      ),
      memoMap,
      scope
    ).pipe(Effect.orDie);

    const router = Context.get(context, HttpRouter.HttpRouter);

    const handler: WebHandler = HttpEffect.toWebHandler(
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- HttpRouter declares asHttpEffect's error as unknown upstream; toWebHandler renders every failure as an HTTP response.
      router.asHttpEffect()
    );

    return (request: Request) =>
      Effect.promise(handler.bind(undefined, request));
  });
