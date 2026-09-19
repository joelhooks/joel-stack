import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { FileInspector } from "@rat-stack/core";
import { createEffectActor, join } from "@xstate/effect";
import { Effect, FileSystem, Layer, Path } from "effect";

import { inspectFile, inspectMachine } from "../src/inspect-machine.js";

// Same composition as the CLI entry: the machine's declared actor requires
// FileInspector, which requires FileSystem from NodeServices.
const TestLayer = Layer.provideMerge(FileInspector.layer, NodeServices.layer);

const runMachine = Effect.fn("runMachine")(function* runMachine(path: string) {
  const actor = yield* createEffectActor(inspectMachine, { input: { path } });
  // A machine's ErrorFrom is unknown (statelyai/xstate#5725); a machine-level
  // error here is a test failure, not a case under test.
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off
  const outcome = yield* join(actor).pipe(Effect.orDie);
  return { outcome, state: actor.getSnapshot().value };
});

it.layer(TestLayer)("inspectMachine", (test) => {
  test.effect("reaches the inspected final state with stats as output", () =>
    Effect.gen(function* reachesInspected() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const file = path.join(directory, "notes.txt");
      yield* fileSystem.writeFileString(file, "one two\nthree\n");

      const { outcome, state } = yield* runMachine(file);

      expect(state).toBe("inspected");
      expect(outcome).toMatchObject({
        _tag: "Inspected",
        stats: { lines: 2, words: 3 },
      });
    })
  );

  test.effect("reaches the unreadable final state with the typed error", () =>
    Effect.gen(function* reachesUnreadable() {
      const { outcome, state } = yield* runMachine(
        "/definitely-not-here/notes.txt"
      );

      expect(state).toBe("unreadable");
      expect(outcome).toMatchObject({
        _tag: "Unreadable",
        error: { _tag: "FileStatsError" },
      });
    })
  );

  test.effect(
    "inspectFile lifts the unreadable outcome into the error channel",
    () =>
      Effect.gen(function* liftsUnreadableIntoErrors() {
        const error = yield* Effect.flip(
          inspectFile("/definitely-not-here/notes.txt")
        );

        expect(error._tag).toBe("FileStatsError");
      })
  );
});
