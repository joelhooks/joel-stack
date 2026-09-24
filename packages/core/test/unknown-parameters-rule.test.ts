// @effect-diagnostics nodeBuiltinImport:off -- These tests write temporary source fixtures and run the real oxlint binary against them.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const oxlint = path.join(repoRoot, "node_modules/.bin/oxlint");

const plugin = path.join(repoRoot, "tools/oxlint/anti-slop/index.ts");

const lint = (source: string) => {
  const directory = mkdtempSync(path.join(tmpdir(), "rat-stack-unknown-"));
  const config = path.join(directory, "oxlint.json");
  const file = path.join(directory, "fixture.ts");

  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "anti-slop", specifier: plugin }],
      rules: { "anti-slop/no-unknown-parameters": "error" },
    })
  );
  writeFileSync(file, source);

  try {
    const result = spawnSync(oxlint, ["-c", config, "--no-ignore", file], {
      cwd: repoRoot,
      encoding: "utf-8",
    });

    return {
      output: `${result.stdout}${result.stderr}`,
      status: result.status ?? -1,
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

describe("anti-slop/no-unknown-parameters", () => {
  it("allows the reason a promise rejection handler receives", () => {
    const result = lint(
      [
        "export const a = (p: Promise<number>) => p.then(() => null, (error: unknown) => error);",
        "export const b = (p: Promise<number>) => p.catch((error: unknown) => error);",
        "export const c = (p: Promise<number>) => p.catch(function reject(error: unknown) { return error; });",
        "",
      ].join("\n")
    );

    expect(result.output).not.toContain("no-unknown-parameters");
    expect(result.status).toBe(0);
  });

  it("still rejects unknown parameters outside rejection position", () => {
    const result = lint(
      [
        "export const fulfilled = (p: Promise<unknown>) => p.then((value: unknown) => value);",
        "export const second = (p: Promise<number>) => p.then(() => null, (error: unknown, extra: unknown) => [error, extra]);",
        "export const plain = (input: unknown) => input;",
        "",
      ].join("\n")
    );

    expect(result.output).toContain("Parameter `value` leaves input unparsed");
    expect(result.output).toContain("Parameter `extra` leaves input unparsed");
    expect(result.output).toContain("Parameter `input` leaves input unparsed");
    expect(result.output).not.toContain(
      "Parameter `error` leaves input unparsed"
    );
  });
});
