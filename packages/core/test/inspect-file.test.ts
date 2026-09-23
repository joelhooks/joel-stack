import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

import { FileInspector } from "../src/file-inspector.js";
import { inspectFile } from "../src/inspect-file.js";

const TestLayer = Layer.provideMerge(FileInspector.layer, NodeServices.layer);

it.layer(TestLayer)("inspectFile capability", (test) => {
  test.effect("returns stats that round-trip through the output schema", () =>
    Effect.gen(function* roundTrips() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const file = path.join(directory, "notes.txt");
      yield* fileSystem.writeFileString(file, "one two\nthree\n");

      const stats = yield* inspectFile.handler({ path: file });

      const encoded = yield* Schema.encodeEffect(inspectFile.contract.output)(
        stats
      );

      expect(encoded).toEqual({
        bytes: 14,
        characters: 14,
        lines: 2,
        path: file,
        words: 3,
      });
    })
  );

  test.effect("declares itself read-only and idempotent", () =>
    Effect.sync(() => {
      expect(inspectFile.contract.annotations).toMatchObject({
        destructive: false,
        idempotent: true,
        readOnly: true,
      });
    })
  );
});
