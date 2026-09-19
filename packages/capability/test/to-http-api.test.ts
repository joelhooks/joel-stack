import { describe, expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { Etag, HttpPlatform } from "effect/unstable/http";
import { HttpApiTest } from "effect/unstable/httpapi";

import { toHttpApi } from "../src/index.js";
import { Greeter, echo, greet } from "./fixtures.js";

const TestServices = Layer.mergeAll(
  Path.layer,
  Etag.layerWeak,
  HttpPlatform.layer
).pipe(Layer.provideMerge(FileSystem.layerNoop({})));

const projection = toHttpApi("TestApi", [echo, greet]);
const HandlersLayer = projection.layer.pipe(Layer.provide(Greeter.layer));

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
      })
    );
  });

  it("derives an OpenAPI document with one POST per capability", () => {
    const document = projection.openApi();

    const paths = Object.keys(document.paths);
    expect(paths).toHaveLength(2);
    expect(paths).toContain("/echo");
    expect(paths).toContain("/greet");
    expect(document.paths["/greet"]?.post?.description).toBeUndefined();
    expect(document.paths["/greet"]?.post?.requestBody).toBeDefined();
  });
});
