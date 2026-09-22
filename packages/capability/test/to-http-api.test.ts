import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";
import { HttpApiTest } from "effect/unstable/httpapi";

import { Approval, ApprovalDenied, toHttpApi } from "../src/index.js";
import { Greeter, approved, echo, greet } from "./fixtures.js";

const TestServices = Layer.mergeAll(
  Path.layer,
  Etag.layerWeak,
  HttpPlatform.layer
).pipe(Layer.provideMerge(FileSystem.layerNoop({})));

const projection = toHttpApi("TestApi", [echo, greet]);
const HandlersLayer = projection.layer.pipe(Layer.provide(Greeter.layer));
const approvalProjection = toHttpApi("ApprovalApi", [approved]);
const deniedApprovalLayer = approvalProjection.layer.pipe(
  Layer.provide(Approval.denyAll)
);
const allowedApprovalLayer = approvalProjection.layer.pipe(
  Layer.provide(Approval.allowAll)
);

describe("toHttpApi", () => {
  it.layer(TestServices)("over an in-process client", (test) => {
    test.effect("posts a capability's input and returns its output", () =>
      Effect.gen(function* postsInput() {
        const client = yield* HttpApiTest.groups(projection.api, [
          "capabilities",
        ]).pipe(Effect.provide(HandlersLayer));

        const greeting = yield* client.capabilities.greet({
          payload: { name: "rat" },
        });
        const echoed = yield* client.capabilities.echo({
          payload: { text: "ab", times: 2 },
        });

        expect(greeting).toEqual({ greeting: "hello rat" });
        expect(echoed).toEqual({ text: "abab" });
      })
    );

    test.effect("keeps a declared failure typed on the client", () =>
      Effect.gen(function* keepsFailure() {
        const client = yield* HttpApiTest.groups(projection.api, [
          "capabilities",
        ]).pipe(Effect.provide(HandlersLayer));

        const error = yield* client.capabilities
          .greet({ payload: { name: "nobody" } })
          .pipe(Effect.flip);

        expect(error._tag).toBe("NotFound");

        const response = yield* client.capabilities.greet({
          payload: { name: "nobody" },
          responseMode: "response-only",
        });
        expect(response.status).toBe(422);
      })
    );
  });

  it("derives an OpenAPI document with one POST per capability", () => {
    const document = projection.openApi();

    const paths = Object.keys(document.paths);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("/echo");
    expect(paths).toContain("/greet");
    expect(document.info.title).toBe("TestApi");
    expect(document.paths["/greet"]?.post?.requestBody).toBeDefined();
    expect(JSON.stringify(document)).not.toContain("ApprovalDenied");
    expect(JSON.stringify(document)).not.toContain('"429"');
  });

  it("documents host errors on every endpoint without touching failures", () => {
    const Throttled = Schema.String.annotate({
      description: "Slow down",
      httpApiStatus: 429,
    });
    const document = toHttpApi("HostErrors", [echo, greet], {
      errors: [Throttled],
    }).openApi();

    for (const path of ["/echo", "/greet"]) {
      const responses = document.paths[path]?.post?.responses ?? {};
      expect(Object.keys(responses)).toContain("429");
      expect(Object.keys(responses)).toContain("200");
    }
    expect(JSON.stringify(document.paths["/greet"])).toContain("422");
  });

  it.layer(TestServices)("enforces approval as a 403 HTTP failure", (test) => {
    test.effect("denies by default and runs with an explicit allow layer", () =>
      Effect.gen(function* approval() {
        const deniedClient = yield* HttpApiTest.groups(approvalProjection.api, [
          "capabilities",
        ]).pipe(Effect.provide(deniedApprovalLayer));
        const denied = yield* deniedClient.capabilities
          .approved({ payload: { message: "run" } })
          .pipe(Effect.flip);
        expect(denied).toBeInstanceOf(ApprovalDenied);

        const response = yield* deniedClient.capabilities.approved({
          payload: { message: "run" },
          responseMode: "response-only",
        });
        expect(response.status).toBe(403);

        const allowedClient = yield* HttpApiTest.groups(
          approvalProjection.api,
          ["capabilities"]
        ).pipe(Effect.provide(allowedApprovalLayer));
        const output = yield* allowedClient.capabilities.approved({
          payload: { message: "run" },
        });
        expect(output).toEqual({ ok: true });
      })
    );

    test.effect("publishes the approval response separately", () =>
      Effect.sync(() => {
        const document = approvalProjection.openApi();
        expect(JSON.stringify(document.paths["/approved"])).toContain("403");
      })
    );
  });
});
