// @effect-diagnostics nodeBuiltinImport:off -- These tests build the app with the real Vite binary and read the emitted source maps from disk.
import { spawnSync } from "node:child_process";
import { globSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const webRoot = path.resolve(import.meta.dirname, "..");

const vite = path.join(webRoot, "node_modules/.bin/vite");

const decodeSourceMap = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ sources: Schema.Array(Schema.String) }))
);

const bundledSources = (nodeEnv: "development" | "production") => {
  const outDir = mkdtempSync(path.join(tmpdir(), "rat-web-bundle-"));

  try {
    const result = spawnSync(
      vite,
      ["build", "--sourcemap", "--outDir", outDir, "--logLevel", "error"],
      {
        cwd: webRoot,
        encoding: "utf-8",
        env: { ...process.env, NODE_ENV: nodeEnv },
      }
    );

    expect(result.status, result.stderr).toBe(0);

    const sources = globSync("**/*.map", { cwd: outDir }).flatMap(
      (file) =>
        decodeSourceMap(readFileSync(path.join(outDir, file), "utf-8")).sources
    );

    return new Set(
      sources.map((source) =>
        path
          .relative(webRoot, path.resolve(outDir, "server/assets", source))
          .split(path.sep)
          .join("/")
          .replace(/\?.*$/u, "")
      )
    );
  } finally {
    rmSync(outDir, { force: true, recursive: true });
  }
};

describe("production bundle", () => {
  it("contains no module from src/dev", () => {
    const sources = bundledSources("production");

    expect(sources.has("src/server/backend.ts")).toBe(true);
    expect(
      [...sources].filter((source) => source.startsWith("src/dev/"))
    ).toEqual([]);
  });

  it("would contain the dev backend in a development build, so the check can fail", () => {
    const sources = bundledSources("development");

    expect(sources.has("src/dev/backend.ts")).toBe(true);
  });
});
