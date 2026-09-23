import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { rpcRouteHandler } from "../src/server/rpc.js";

const stubFetch =
  (received: Request[], response: Response) =>
  // @effect-diagnostics-next-line asyncFunction:off -- The service-binding test stub mirrors its Promise-only boundary.
  async (forwarded: Request) => {
    received.push(forwarded);

    const resolvedResponse = await Promise.resolve(response);

    return resolvedResponse;
  };

it.effect("forwards the /rpc request to the backend binding", () =>
  Effect.gen(function* testRpcForwarding() {
    const request = new Request("https://rat-stack.test/rpc", {
      body: "rpc-message",
      method: "POST",
    });

    const response = new Response("accepted", { status: 200 });

    const received: Request[] = [];

    const handler = rpcRouteHandler(stubFetch(received, response));

    const actual = yield* Effect.promise(handler.bind(undefined, { request }));

    expect(received).toEqual([request]);
    expect(actual).toBe(response);
  })
);
