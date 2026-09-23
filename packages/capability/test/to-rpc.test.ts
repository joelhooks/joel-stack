import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer, RpcTest } from "effect/unstable/rpc";
import type * as Rpc from "effect/unstable/rpc/Rpc";

import {
  Approval,
  ApprovalDenied,
  defineContract,
  implement,
  toRpc,
  toRpcGroup,
} from "../src/index.js";
import type {
  AnyCapability,
  ContractsOf,
  RpcProjection,
  RpcsOf,
} from "../src/index.js";
import { Greeter, approved, echo, greet } from "./fixtures.js";
import { NotFound } from "./not-found.js";

type Assert<Condition extends true> = Condition;

type ApprovedHandler = Parameters<
  typeof implement<typeof approved.contract, never>
>[1];

type ForgedApprovalHandler = () => Effect.Effect<never, ApprovalDenied>;

export type ApprovalDeniedIsReservedForTheGate = Assert<
  ForgedApprovalHandler extends ApprovedHandler ? false : true
>;

const InvalidStrictRpcRequest = Schema.TaggedStruct("Request", {
  headers: Schema.Array(Schema.Tuple([Schema.String, Schema.String])),
  id: Schema.String,
  payload: Schema.Struct({ name: Schema.Finite }),
  tag: Schema.String,
});

const makeInMemoryRpc = <Caps extends readonly AnyCapability[]>(
  projection: RpcProjection<Caps>,
  handlers: Layer.Layer<Rpc.ToHandler<RpcsOf<ContractsOf<Caps>>[number]>>
) => RpcTest.makeClient(projection.group).pipe(Effect.provide(handlers));

const projection = toRpc([echo, greet]);

const clientGroup = toRpcGroup([echo.contract, greet.contract]);

const greeterLayer = projection.layer.pipe(Layer.provide(Greeter.layer));

const approvalProjection = toRpc([approved]);

const deniedApprovalLayer = approvalProjection.layer.pipe(
  Layer.provide(Approval.denyAll)
);

const allowedApprovalLayer = approvalProjection.layer.pipe(
  Layer.provide(Approval.allowAll)
);

describe("toRpc", () => {
  it("builds a client group from contracts without implementations", () => {
    expect([...clientGroup.group.requests.keys()]).toEqual(["echo", "greet"]);
    expect(clientGroup.group.requests.get("echo")?.payloadSchema).toBe(
      echo.contract.input
    );
    expect([...projection.group.requests.keys()]).toEqual([
      ...clientGroup.group.requests.keys(),
    ]);
    expect(projection.group.requests.get("echo")?.payloadSchema).toBe(
      clientGroup.group.requests.get("echo")?.payloadSchema
    );
    expect(projection.group.requests.get("echo")?.successSchema).toBe(
      clientGroup.group.requests.get("echo")?.successSchema
    );
    expect(projection.group.requests.get("echo")?.errorSchema).toBe(
      clientGroup.group.requests.get("echo")?.errorSchema
    );
  });

  it.effect("returns a decoded capability output from an in-memory RPC", () =>
    Effect.gen(function* success() {
      const client = yield* makeInMemoryRpc(projection, greeterLayer);
      const echoed = yield* client.echo({ text: "ab", times: 2 });
      const greeting = yield* client.greet({ name: "rat" });

      expect(echoed).toEqual({ text: "abab" });
      expect(greeting).toEqual({ greeting: "hello rat" });
    })
  );

  it.effect("decodes declared failures as their tagged error class", () =>
    Effect.gen(function* declaredFailure() {
      const client = yield* makeInMemoryRpc(projection, greeterLayer);
      const error = yield* client.greet({ name: "nobody" }).pipe(Effect.flip);

      expect(Schema.is(NotFound)(error)).toBe(true);
    })
  );

  it.effect("propagates approval requirements to handlers", () =>
    Effect.gen(function* approval() {
      const deniedClient = yield* makeInMemoryRpc(
        approvalProjection,
        deniedApprovalLayer
      );

      const deniedError = yield* deniedClient
        .approved({ message: "run" })
        .pipe(Effect.flip);

      expect(Schema.is(ApprovalDenied)(deniedError)).toBe(true);

      const allowedClient = yield* makeInMemoryRpc(
        approvalProjection,
        allowedApprovalLayer
      );

      const output = yield* allowedClient.approved({ message: "run" });

      expect(output).toEqual({ ok: true });
    })
  );

  it.effect("rejects invalid payloads before running the handler", () =>
    Effect.gen(function* invalidPayload() {
      let handlerRuns = 0;

      const strictContract = defineContract("strict", {
        description: "Accept a string name",
        failure: Schema.Never,
        input: Schema.Struct({ name: Schema.String }),
        output: Schema.Struct({ name: Schema.String }),
      });

      const strict = implement(strictContract, ({ name }) =>
        Effect.sync(() => {
          handlerRuns += 1;

          return { name };
        })
      );

      const strictProjection = toRpc([strict]);

      const serverLayer = RpcServer.layerHttp({
        group: strictProjection.group,
        path: "/rpc",
        protocol: "http",
      }).pipe(
        Layer.provideMerge(strictProjection.layer),
        Layer.provide(RpcSerialization.layerJson)
      );

      const { dispose, handler } = HttpRouter.toWebHandler(serverLayer, {
        disableLogger: true,
      });

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      // oxlint-disable-next-line typescript/promise-function-async -- HttpRouter exposes a Promise API for this in-memory RPC transport test.
      const response = yield* Effect.promise(() =>
        handler(
          new Request("http://localhost/rpc", {
            body: JSON.stringify(
              InvalidStrictRpcRequest.make({
                headers: [],
                id: "invalid-payload",
                payload: { name: 42 },
                tag: "strict",
              })
            ),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        )
      );

      // oxlint-disable-next-line typescript/promise-function-async -- Web Response.text returns a Promise at this in-memory transport boundary.
      const responseText = yield* Effect.promise(() => response.text());

      expect(handlerRuns).toBe(0);
      expect(responseText).toContain('"_tag":"Exit"');
      expect(responseText).toContain('"_tag":"Failure"');
    })
  );
});
