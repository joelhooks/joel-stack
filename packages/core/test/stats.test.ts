import { describe, expect, it } from "@effect/vitest";

import { summarizeText } from "../src/index.js";

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
