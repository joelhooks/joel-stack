import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";

import { FileInspector } from "../src/index.js";

// The test layer is the service under test wired to real Node services. Each
// it.effect runs in its own Scope, so scoped temp directories clean themselves.
const TestLayer = Layer.provideMerge(FileInspector.layer, NodeServices.layer);

const writeTempFile = Effect.fn("writeTempFile")(function* writeTempFile(
  name: string,
  content: string | Uint8Array
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = yield* fileSystem.makeTempDirectoryScoped();
  const file = path.join(directory, name);
  yield* content instanceof Uint8Array
    ? fileSystem.writeFile(file, content)
    : fileSystem.writeFileString(file, content);

  return file;
});

it.layer(TestLayer)("FileInspector", (test) => {
  test.effect("reads a file through the Effect filesystem", () =>
    Effect.gen(function* readsThroughFileSystem() {
      const file = yield* writeTempFile("notes.txt", "one two\nthree\n");
      const inspector = yield* FileInspector;

      const stats = yield* inspector.inspect(file);

      expect(stats).toMatchObject({ bytes: 14, lines: 2, words: 3 });
    })
  );

  test.effect(
    "reports original bytes even when UTF-8 decoding replaces content",
    () =>
      Effect.gen(function* reportsOriginalBytes() {
        const file = yield* writeTempFile(
          "invalid-utf8.txt",
          Uint8Array.of(0xff)
        );

        const inspector = yield* FileInspector;

        const stats = yield* inspector.inspect(file);

        expect(stats).toMatchObject({ bytes: 1, characters: 1 });
      })
  );

  test.effect("keeps filesystem failures typed", () =>
    Effect.gen(function* keepsFailuresTyped() {
      const inspector = yield* FileInspector;

      const error = yield* Effect.flip(
        inspector.inspect("/definitely-not-here/notes.txt")
      );

      expect(error._tag).toBe("FileStatsError");
    })
  );
});
