// @effect-diagnostics nodeBuiltinImport:off -- These tests run the real oxlint binary against fixture files, so they use Node's file system and child process modules directly.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const oxlint = path.join(repoRoot, "node_modules/.bin/oxlint");

const plugin = path.join(repoRoot, "scripts/oxlint-plugin-no-comments.ts");

const lintFixed = (name: string, source: string) => {
  const directory = mkdtempSync(path.join(tmpdir(), "no-comments-"));
  const file = path.join(directory, name);
  const config = path.join(directory, ".oxlintrc.json");

  writeFileSync(file, source);
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [plugin],
      rules: { "no-comments/no-comments": "error" },
    })
  );

  const fix = spawnSync(oxlint, ["-c", config, "--fix", file], {
    encoding: "utf-8",
  });

  const recheck = spawnSync(oxlint, ["-c", config, file], {
    encoding: "utf-8",
  });

  return {
    fixed: readFileSync(file, "utf-8"),
    remaining: recheck.status,
    status: fix.status,
  };
};

describe("no-comments rule", () => {
  it("removes prose and folds a reason into the directive it explains", () => {
    const { fixed, remaining } = lintFixed(
      "sample.ts",
      [
        "// A module header that goes away.",
        "export const answer = 42;",
        "",
        "export const run = (value: string) => {",
        "  // The platform owns this boundary.",
        "  // oxlint-disable-next-line no-debugger",
        "  debugger;",
        "  return value; // a trailing note",
        "};",
        "",
      ].join("\n")
    );

    expect(fixed).toBe(
      [
        "export const answer = 42;",
        "",
        "export const run = (value: string) => {",
        "  // oxlint-disable-next-line no-debugger -- The platform owns this boundary.",
        "  debugger;",
        "  return value;",
        "};",
        "",
      ].join("\n")
    );
    expect(remaining).toBe(0);
  });

  it("keeps a SAFETY invariant on one line", () => {
    const { fixed, remaining } = lintFixed(
      "safety.ts",
      [
        "const wide: string | number = 1;",
        "// SAFETY: the value above is a number",
        "// literal, so the assertion cannot lie.",
        "export const narrow = wide as number;",
        "",
      ].join("\n")
    );

    expect(fixed).toContain(
      "// SAFETY: the value above is a number literal, so the assertion cannot lie.\nexport const narrow"
    );
    expect(remaining).toBe(0);
  });

  it("leaves triple-slash references and JS type tags alone", () => {
    const source = [
      '/// <reference path="./globals.d.ts" />',
      "",
      "/**",
      " * @param {string} command",
      " * @returns {string}",
      " */",
      "export const same = (command) => command;",
      "",
    ].join("\n");

    const { fixed, remaining } = lintFixed("policy.js", source);

    expect(fixed).toBe(source);
    expect(remaining).toBe(0);
  });
});
