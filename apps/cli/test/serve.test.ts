import { NodeHttpServer, NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { capabilities, FileInspector } from "@rat-stack/core";
import {
  ActorLog,
  CallLog,
  OutcomeSchema,
  devtoolsLayer,
} from "@rat-stack/devtools";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";
import { HttpClient, HttpRouter, HttpServer } from "effect/unstable/http";
import { HttpApiClient } from "effect/unstable/httpapi";

import { devtoolsRoutes, http, routes, serverLayer } from "../src/surfaces.js";

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
  it.effect("binds serve to the loopback interface only", () =>
    Effect.gen(function* bindsLoopback() {
      const server = yield* HttpServer.HttpServer;

      expect(HttpServer.formatAddress(server.address)).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+$/u
      );
    }).pipe(Effect.provide(serverLayer(0)))
  );

  it.effect("publishes the OpenAPI document and the docs page", () =>
    Effect.gen(function* publishesDocs() {
      const openapi = yield* HttpClient.get("/openapi.json");
      expect(openapi.status).toBe(200);
      const document = decodeOpenApi(yield* openapi.json);
      expect(Object.keys(document.paths)).toEqual(
        capabilities.map((capability) => `/${capability.contract.name}`)
      );

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

  it.effect("records REST calls when served with devtools", () =>
    Effect.gen(function* recordsRestCalls() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const file = path.join(directory, "notes.txt");
      yield* fileSystem.writeFileString(file, "one two\nthree\n");

      const client = yield* HttpApiClient.make(http.api);
      yield* client.capabilities.inspectFile({ payload: { path: file } });

      const { entries } = yield* (yield* CallLog).snapshot;

      const [entry] = entries;

      expect(entries).toHaveLength(1);
      expect(entry).toMatchObject({
        capability: "inspectFile",
        input: { path: file },
      });
      expect(
        entry !== undefined && OutcomeSchema.guards.Succeeded(entry.outcome)
          ? entry.outcome.output
          : undefined
      ).toMatchObject({ lines: 2, words: 3 });

      const machine = yield* (yield* ActorLog).snapshot;

      const root = machine.entries.filter(
        (step) => step.machine === "inspectMachine"
      );

      expect(root.map((step) => step.state)).toEqual(["reading", "inspected"]);
      expect(root.at(-1)?.status).toBe("done");
      expect(
        machine.entries
          .filter((step) => step.machine !== "inspectMachine")
          .map((step) => step.machine)
      ).toEqual(["readStats", "readStats"]);
    }).pipe(
      Effect.provide(
        HttpRouter.serve(devtoolsRoutes, {
          disableListenLog: true,
          disableLogger: true,
        }).pipe(
          Layer.provideMerge(NodeHttpServer.layerTest),
          Layer.provideMerge(devtoolsLayer()),
          Layer.provide(
            FileInspector.layer.pipe(Layer.provide(NodeServices.layer))
          )
        )
      )
    )
  );
});
