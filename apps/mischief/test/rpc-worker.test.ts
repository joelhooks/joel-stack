import { expect, it } from "@effect/vitest";
import { ResourceNotFound } from "@rat-stack/core/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientRequest from "effect/unstable/http/HttpClientRequest";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import { RpcClient, RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { rpcProjection } from "../src/rpc-worker.js";

const rpcServer = RpcServer.layerHttp({
  group: rpcProjection.group,
  path: "/rpc",
  protocol: "http",
}).pipe(
  Layer.provide(rpcProjection.layer),
  Layer.provide(RpcSerialization.layerJson)
);

it.effect("searches and reads through the in-memory RPC transport", () =>
  Effect.gen(function* runRpcRoundTrip() {
    const { dispose, handler } = HttpRouter.toWebHandler(rpcServer);
    yield* Effect.addFinalizer(() => Effect.promise(dispose));

    const httpClient = HttpClient.make((request) =>
      HttpClientRequest.toWeb(request).pipe(
        Effect.orDie,
        Effect.flatMap((webRequest) =>
          Effect.promise(
            // @effect-diagnostics-next-line asyncFunction:off -- The in-memory HTTP handler exposes a Promise boundary.
            async () => await handler(webRequest)
          )
        ),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response))
      )
    );

    const client = yield* RpcClient.make(rpcProjection.group).pipe(
      Effect.provide(
        RpcClient.layerProtocolHttp({ url: "http://rat-stack.test/rpc" }).pipe(
          Layer.provide(RpcSerialization.layerJson),
          Layer.provide(Layer.succeed(HttpClient.HttpClient)(httpClient))
        )
      )
    );

    const results = yield* client.search({ limit: 5, query: "capability" });
    expect(results.matches.length).toBeGreaterThan(0);

    const match = results.matches.at(0);
    expect(match).toBeDefined();

    if (match === undefined) {
      return;
    }

    const document = yield* client.read({ id: match.id });
    expect(document.id).toBe(match.id);
    expect(document.text.length).toBeGreaterThan(0);

    const failure = yield* client
      .read({ id: "ratstack://repo/missing-resource.md" })
      .pipe(Effect.flip);

    expect(failure).toBeInstanceOf(ResourceNotFound);
  })
);
