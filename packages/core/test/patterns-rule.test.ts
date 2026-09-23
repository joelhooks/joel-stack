// @effect-diagnostics nodeBuiltinImport:off -- These tests create temporary source fixtures and run the real oxlint binary against them.
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

const oxlint = path.join(repoRoot, "node_modules/.bin/oxlint");

const plugin = path.join(repoRoot, "scripts/oxlint-plugin-patterns.ts");

const rules = [
  "rat-stack-patterns/acquire-release-constructs-in-acquire-body",
  "rat-stack-patterns/contract-binding-matches-name",
  "rat-stack-patterns/no-empty-contract-input",
  "rat-stack-patterns/no-module-level-mutable-state",
  "rat-stack-patterns/watch-effect-actors",
];

interface LintResult {
  readonly output: string;
  readonly status: number;
}

const lintFixture = (area: string, source: string): LintResult => {
  const directory = mkdtempSync(path.join(tmpdir(), "rat-stack-patterns-"));
  const fixtureDirectory = path.join(directory, area, "pattern-fixtures");
  const config = path.join(directory, "oxlint.json");
  const file = path.join(fixtureDirectory, "fixture.ts");

  mkdirSync(fixtureDirectory, { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "rat-stack-patterns", specifier: plugin }],
      rules: Object.fromEntries(rules.map((rule) => [rule, "error"])),
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

const expectRule = (result: LintResult, message: string) => {
  expect(result.status).not.toBe(0);
  expect(result.output).toContain(message);
};

const eagerAcquire = "Build the resource inside acquire";

const moduleState = "Module-level let and var are shared by every request";

describe("rat-stack pattern rules", () => {
  it("turns every pattern rule on in the repo config", () => {
    const configSource = readFileSync(
      path.join(repoRoot, "oxlint.config.ts"),
      "utf-8"
    );

    for (const rule of rules) {
      expect(configSource).toContain(`"${rule}": "error"`);
    }
  });

  it("flags an acquire that succeeds with an eager or captured handle", () => {
    const eager = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nexport const pool = Effect.acquireRelease(Effect.succeed(new Pool()), (opened) => Effect.sync(() => opened.close()));\n'
    );

    const captured = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nconst shared = new Pool();\n\nexport const pool = Effect.acquireRelease(Effect.sync(() => shared), (opened) => Effect.sync(() => opened.close()));\n'
    );

    expectRule(eager, eagerAcquire);
    expectRule(captured, eagerAcquire);
  });

  it("allows an acquire that constructs the resource", () => {
    const result = lintFixture(
      "packages/database/src",
      'import { Effect } from "effect";\n\nclass Pool { close() {} }\n\nexport const pool = Effect.acquireRelease(Effect.sync(() => new Pool()), (opened) => Effect.sync(() => opened.close()));\n'
    );

    expect(result.status).toBe(0);
  });

  it("flags module-level let and var in runtime source", () => {
    const counter = lintFixture(
      "apps/web/src",
      "let count = 0;\n\nexport const next = () => ++count;\n"
    );

    const exported = lintFixture(
      "packages/core/src",
      "export var cache = new Map();\n"
    );

    expectRule(counter, moduleState);
    expectRule(exported, moduleState);
  });

  it("allows const at module level, let inside functions, and tests", () => {
    const constant = lintFixture(
      "packages/core/src",
      "export const limit = 10;\n"
    );

    const local = lintFixture(
      "packages/core/src",
      "export const sum = (values: readonly number[]) => {\n  let total = 0;\n\n  for (const value of values) {\n    total += value;\n  }\n\n  return total;\n};\n"
    );

    const test = lintFixture(
      "packages/core/test",
      "let calls = 0;\n\nexport const call = () => ++calls;\n"
    );

    expect(constant.status).toBe(0);
    expect(local.status).toBe(0);
    expect(test.status).toBe(0);
  });

  it("flags a contract binding that does not match its name", () => {
    const result = lintFixture(
      "packages/core/src",
      'import { defineContract } from "@rat-stack/capability/contract";\n\nexport const contract = defineContract("execute", {});\n'
    );

    expectRule(
      result,
      'Name this binding executeContract or execute, to match the contract name "execute".'
    );
  });

  it("accepts the name, the name plus Contract, and camelCase for snake_case names", () => {
    const result = lintFixture(
      "packages/core/src",
      'import { defineContract } from "@rat-stack/capability/contract";\n\nexport const inspectFileContract = defineContract("inspectFile", {});\nexport const search = defineContract("search", {});\nexport const ratListCalls = defineContract("rat_list_calls", {});\n'
    );

    expect(result.status).toBe(0);
  });

  it("flags an Effect-backed actor that is never watched", () => {
    const result = lintFixture(
      "packages/core/src",
      'import { createEffectActor } from "@xstate/effect";\n\nexport const start = (machine: never) => createEffectActor(machine);\n'
    );

    expectRule(result, 'Call watchActor("<machine>", actor)');
  });

  it("accepts an actor handed to watchActor, and tests that start actors", () => {
    const watched = lintFixture(
      "packages/core/src",
      'import { watchActor } from "@rat-stack/capability/actor-watch";\nimport { createEffectActor } from "@xstate/effect";\nimport { Effect } from "effect";\n\nexport const start = (machine: never) =>\n  Effect.gen(function* startMachine() {\n    const actor = yield* createEffectActor(machine);\n\n    yield* watchActor("machine", actor);\n  });\n'
    );

    const test = lintFixture(
      "packages/core/test",
      'import { createEffectActor } from "@xstate/effect";\n\nexport const start = (machine: never) => createEffectActor(machine);\n'
    );

    expect(watched.status).toBe(0);
    expect(test.status).toBe(0);
  });

  it("flags a contract whose input has no fields", () => {
    const result = lintFixture(
      "packages/core/src",
      'import { defineContract } from "@rat-stack/capability/contract";\nimport { Schema } from "effect";\n\nexport const pingContract = defineContract("ping", { input: Schema.Struct({}) });\n'
    );

    expectRule(result, "MCP rejects because a tool input must have");
  });

  it("accepts an input with one optional field, and empty inputs in tests", () => {
    const optional = lintFixture(
      "packages/core/src",
      'import { defineContract } from "@rat-stack/capability/contract";\nimport { Schema } from "effect";\n\nexport const pingContract = defineContract("ping", { input: Schema.Struct({ note: Schema.optional(Schema.String) }) });\n'
    );

    const test = lintFixture(
      "packages/core/test",
      'import { defineContract } from "@rat-stack/capability/contract";\nimport { Schema } from "effect";\n\nexport const pingContract = defineContract("ping", { input: Schema.Struct({}) });\n'
    );

    expect(optional.status).toBe(0);
    expect(test.status).toBe(0);
  });
});
