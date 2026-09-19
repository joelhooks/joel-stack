// The `serve` routes on an in-process Node test server: the OpenAPI document,
// the Scalar page, and one capability call through the generated client.
import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { FileInspector } from "@rat-stack/core";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { HttpClient, HttpRouter } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

import { http, routes } from "../src/surfaces.js";

const decodeOpenApi = Schema.decodeUnknownSync(
  Schema.Struct({ paths: Schema.Record(Schema.String, Schema.Unknown) })
);

const AppLayer = HttpRouter.serve(routes, {
  disableListenLog: true,
  disableLogger: true,
}).pipe(
  Layer.provideMerge(NodeHttpServer.layerTest),
  Layer.provide(FileInspector.layer.pipe(Layer.provide(NodeServices.layer)))
);

describe("serve routes", () => {
  it.effect("publishes the OpenAPI document and the docs page", () =>
    Effect.gen(function* publishesDocs() {
      const openapi = yield* HttpClient.get("/openapi.json");
      expect(openapi.status).toBe(200);
      const document = decodeOpenApi(yield* openapi.json);
      expect(Object.keys(document.paths)).toEqual(["/inspectFile"]);

      const docs = yield* HttpClient.get("/docs");
      expect(docs.status).toBe(200);
      expect(docs.headers["content-type"]).toContain("text/html");
    }).pipe(Effect.provide(AppLayer))
  );

  it.effect("runs a capability through the generated client", () =>
    Effect.gen(function* runsCapability() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const file = path.join(directory, "notes.txt");
      yield* fileSystem.writeFileString(file, "one two\nthree\n");

      const client = yield* HttpApiClient.make(http.api);
      const stats = yield* client.capabilities.inspectFile({
        payload: { path: file },
      });
      const error = yield* client.capabilities
        .inspectFile({ payload: { path: `${directory}/missing.txt` } })
        .pipe(Effect.flip);

      expect(stats).toMatchObject({ lines: 2, path: file, words: 3 });
      expect(error._tag).toBe("FileStatsError");
    }).pipe(Effect.provide(AppLayer))
  );
});
