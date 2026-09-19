import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeServices } from "@effect/platform-node";
import { createEffectActor, join } from "@xstate/effect";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { inspectFile, inspectMachine } from "../src/inspect-machine.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

const makeFile = async (name: string, content: string) => {
  const directory = await mkdtemp(path.join(tmpdir(), "joel-stack-"));
  temporaryDirectories.push(directory);
  const file = path.join(directory, name);
  await writeFile(file, content, "utf-8");
  return file;
};

describe("inspectMachine", () => {
  it("reaches the inspected final state with stats as output", async () => {
    const file = await makeFile("notes.txt", "one two\nthree\n");

    const { outcome, state } = await Effect.runPromise(
      Effect.gen(function* runInspectMachine() {
        const actor = yield* createEffectActor(inspectMachine, {
          input: { path: file },
        });
        const output = yield* join(actor);
        return { outcome: output, state: actor.getSnapshot().value };
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    expect(state).toBe("inspected");
    expect(outcome).toMatchObject({
      _tag: "Inspected",
      stats: { lines: 2, words: 3 },
    });
  });

  it("reaches the unreadable final state with the typed error", async () => {
    const { outcome, state } = await Effect.runPromise(
      Effect.gen(function* runInspectMachine() {
        const actor = yield* createEffectActor(inspectMachine, {
          input: { path: "/definitely-not-here/notes.txt" },
        });
        const output = yield* join(actor);
        return { outcome: output, state: actor.getSnapshot().value };
      }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
    );

    expect(state).toBe("unreadable");
    expect(outcome).toMatchObject({
      _tag: "Unreadable",
      error: { _tag: "FileStatsError" },
    });
  });
});

describe("inspectFile", () => {
  it("lifts the unreadable outcome back into the Effect error channel", async () => {
    const error = await Effect.runPromise(
      inspectFile("/definitely-not-here/notes.txt").pipe(
        Effect.flip,
        Effect.provide(NodeServices.layer)
      )
    );

    expect(error._tag).toBe("FileStatsError");
  });
});
