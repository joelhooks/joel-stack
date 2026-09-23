import type { Sandbox } from "@rat-stack/capability/sandbox";
import { Context, Effect, Layer } from "effect";
import * as HttpEffect from "effect/unstable/http/HttpEffect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { legacyMcpProtocols, mcpLayer } from "../app.js";

type WebHandler = (request: Request) => Promise<Response>;

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
