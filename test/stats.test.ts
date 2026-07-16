import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { NodeServices } from "@effect/platform-node";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";

import { readFileStats, summarizeText } from "../src/stats.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    })
  );
});

describe("summarizeText", () => {
  it("counts UTF-8 bytes, Unicode characters, words, and lines", () => {
    expect(summarizeText("sample.txt", "hello 🌈\nsecond line\n")).toEqual({
      bytes: 23,
      characters: 20,
      lines: 2,
      path: "sample.txt",
      words: 4,
    });
  });

  it("treats an empty file as zero lines", () => {
    expect(summarizeText("empty.txt", "").lines).toBe(0);
  });
});

describe("readFileStats", () => {
  it("runs through the Effect Node filesystem layer", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ts-cli-template-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "notes.txt");
    await writeFile(file, "one two\nthree\n", "utf-8");

    const stats = await Effect.runPromise(
      readFileStats(file).pipe(Effect.provide(NodeServices.layer))
    );

    expect(stats).toMatchObject({ bytes: 14, lines: 2, words: 3 });
  });

  it("reports original bytes even when UTF-8 decoding replaces content", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "ts-cli-template-"));
    temporaryDirectories.push(directory);
    const file = path.join(directory, "invalid-utf8.txt");
    await writeFile(file, Uint8Array.of(0xff));

    const stats = await Effect.runPromise(
      readFileStats(file).pipe(Effect.provide(NodeServices.layer))
    );

    expect(stats).toMatchObject({ bytes: 1, characters: 1 });
  });

  it("keeps filesystem failures typed", async () => {
    const error = await Effect.runPromise(
      readFileStats("/definitely-not-here/notes.txt").pipe(
        Effect.flip,
        Effect.provide(NodeServices.layer)
      )
    );

    expect(error._tag).toBe("FileStatsError");
  });
});
