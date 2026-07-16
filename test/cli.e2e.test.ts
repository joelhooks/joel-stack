import { spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const cliPath = path.join(process.cwd(), "dist", "cli.js");

const runCli = (arguments_: readonly string[]) =>
  spawnSync(process.execPath, [cliPath, ...arguments_], {
    encoding: "utf-8",
  });

describe("built CLI", () => {
  it("prints help and exits cleanly", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("USAGE");
    expect(result.stdout).toContain("stats");
  });

  it("prints JSON stats and exits cleanly", () => {
    const result = runCli(["stats", "README.md", "--json"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      `"path": "${path.join(process.cwd(), "README.md")}"`
    );
    expect(result.stdout).toMatch(/"words": \d+/u);
  });

  it("prints command help and exits one for invalid input", () => {
    const result = runCli(["stats", "this-file-does-not-exist.txt"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain("Path does not exist");
  });
});
