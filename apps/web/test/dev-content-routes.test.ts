import { expect, it } from "@effect/vitest";
import {
  contentCapabilities,
  contentLayer,
} from "@rat-stack/mischief/capabilities";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";

import { contentRoutes } from "../src/dev/content-routes.js";
import { rpcRouteHandler } from "../src/server/rpc.js";

const RpcExit = Schema.fromJsonString(
  Schema.Tuple([
    Schema.Struct({
      exit: Schema.TaggedStruct("Success", {
        value: Schema.Struct({ total: Schema.Int }),
      }),
    }),
  ])
);

it.effect("serves search over /rpc with no devtools involved", () =>
  Effect.gen(function* servesContent() {
    const { dispose, handler } = HttpRouter.toWebHandler(
      contentRoutes(contentCapabilities).pipe(Layer.provide(contentLayer)),
      { disableLogger: true }
    );

    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const request = {
      // oxlint-disable-next-line anti-slop-effect/no-manual-tagged-construction -- This is the Effect RPC wire message the browser sends; the test writes it by hand on purpose.
      _tag: "Request",
      headers: [],
      id: "1",
      payload: { limit: 1, query: "capability" },
      tag: "search",
    };

    const response = yield* Effect.promise(
      rpcRouteHandler(handler).bind(undefined, {
        request: new Request("http://dev.test/rpc", {
          body: JSON.stringify(request),
          headers: { "content-type": "application/json" },
          method: "POST",
        }),
      })
    );

    const body = yield* Effect.promise(response.text.bind(response));
    const [message] = yield* Schema.decodeUnknownEffect(RpcExit)(body);

    expect(response.status).toBe(200);
    expect(message.exit.value.total).toBe(1);
  })
);
