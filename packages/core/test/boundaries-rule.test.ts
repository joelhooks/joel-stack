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

const plugin = path.join(repoRoot, "scripts/oxlint-plugin-boundaries.ts");

interface LintResult {
  readonly output: string;
  readonly status: number;
}

const lintFixture = (area: string, source: string): LintResult => {
  const directory = mkdtempSync(path.join(tmpdir(), "rat-stack-boundaries-"));
  const fixtureDirectory = path.join(directory, area, "boundary-fixtures");
  const config = path.join(directory, "oxlint.json");
  const file = path.join(fixtureDirectory, "fixture.ts");

  mkdirSync(fixtureDirectory, { recursive: true });
  writeFileSync(
    config,
    JSON.stringify({
      jsPlugins: [{ name: "rat-stack-boundaries", specifier: plugin }],
      rules: {
        "rat-stack-boundaries/no-browser-globals-on-server": "error",
        "rat-stack-boundaries/no-browser-server-imports": "error",
        "rat-stack-boundaries/no-cross-layer-imports": "error",
        "rat-stack-boundaries/no-feature-transport": "error",
        "rat-stack-boundaries/no-hand-rolled-surface": "error",
      },
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

describe("architecture boundary rules", () => {
  it("wires browser boundary rules to the feature and client globs", () => {
    const configSource = readFileSync(
      path.join(repoRoot, "oxlint.config.ts"),
      "utf-8"
    );

    expect(configSource).toContain(
      'files: ["apps/*/src/features/**", "apps/*/src/client/**"]'
    );
    expect(configSource).toContain('files: ["apps/*/src/features/**"]');
    expect(configSource).toContain(
      '"rat-stack-boundaries/no-browser-server-imports": "error"'
    );
    expect(configSource).toContain(
      '"rat-stack-boundaries/no-feature-transport": "error"'
    );
  });

  it("blocks package imports from application code", () => {
    const result = lintFixture(
      "packages/core/test",
      'import * as application from "../../../../apps/cli/src/cli.ts";\n\nexport const source = application;\n'
    );

    expectRule(result, "Packages cannot import application code.");
  });

  it("blocks domain imports from the capability projection package", () => {
    const result = lintFixture(
      "packages/capability/test",
      'import * as domain from "../../../../packages/core/src/index.ts";\n\nexport const source = domain;\n'
    );

    expectRule(
      result,
      "packages/capability cannot import packages/core domain code."
    );
  });

  it("keeps Stack wiring inside apps/infra", () => {
    const result = lintFixture(
      "apps/cli/src",
      'import * as stack from "../../../infra/alchemy.run.ts";\n\nexport const applicationStack = stack;\n'
    );

    expectRule(
      result,
      "apps/infra owns its Stack wiring; import a capability or service contract instead."
    );
  });

  it.each([
    ["Node builtins", "node:fs"],
    ["Alchemy", "alchemy/AdoptPolicy"],
    ["Cloudflare Workers", "cloudflare:workers"],
    ["server-only packages", "server-only"],
    ["server-marked modules", "./database.server.js"],
    ["infra app modules", "@rat-stack/infra"],
  ])("blocks %s imports in feature modules", (_name, specifier) => {
    const result = lintFixture(
      "apps/cli/src/features",
      `import * as importedModule from ${JSON.stringify(specifier)};\n\nexport const value = importedModule;\n`
    );

    expectRule(
      result,
      "Feature and client modules cannot import Node, Alchemy, Worker, infra, or server-only modules."
    );
  });

  it("applies the server import boundary to client modules too", () => {
    const result = lintFixture(
      "apps/cli/src/client",
      'import "server-only";\n\nexport const client = true;\n'
    );

    expectRule(
      result,
      "Feature and client modules cannot import Node, Alchemy, Worker, infra, or server-only modules."
    );
  });

  it.each(["apps/cli/src/client", "apps/cli/src/features"])(
    "allows only browser-safe contract entry points in %s",
    (area) => {
      const result = lintFixture(
        area,
        'import * as contracts from "@rat-stack/core/contracts";\nimport { toRpcGroup } from "@rat-stack/capability/rpc-group";\n\nexport const browserContract = { contracts, toRpcGroup };\n'
      );

      expect(result.status).toBe(0);
    }
  );

  it("resolves renamed workspace scopes for browser-safe contracts", () => {
    const result = lintFixture(
      "apps/cli/src/client",
      'import * as contracts from "@sample/core/contracts";\nimport { toRpcGroup } from "@sample/capability/rpc-group";\n\nexport const browserContract = { contracts, toRpcGroup };\n'
    );

    expect(result.status).toBe(0);
  });

  it.each([
    ["the core implementation barrel", "@rat-stack/core"],
    ["a renamed core implementation barrel", "@sample/core"],
    [
      "the capability implementation entry point",
      "@rat-stack/capability/implement",
    ],
    [
      "a renamed capability implementation entry point",
      "@sample/capability/implement",
    ],
    [
      "an application capability handler",
      "../../../../mischief/src/capabilities/search.ts",
    ],
  ])("blocks %s from browser modules", (_name, specifier) => {
    const result = lintFixture(
      "apps/cli/src/client",
      `import * as implementation from ${JSON.stringify(specifier)};\n\nexport const source = implementation;\n`
    );

    expectRule(
      result,
      "Feature and client modules can import only browser-safe contract entry points; capability handlers and other domain implementation modules stay server-side."
    );
  });

  it("keeps fetch calls out of feature modules", () => {
    const result = lintFixture(
      "apps/cli/src/features",
      'export const send = () => fetch("/rpc");\n'
    );

    expectRule(
      result,
      "Features read atoms and call named commands from apps/web/src/client; do not use fetch or construct transport clients here."
    );
  });

  it("keeps RPC client construction out of feature modules", () => {
    const result = lintFixture(
      "apps/cli/src/features",
      'import { RpcClient } from "effect/unstable/rpc";\n\nexport const client = RpcClient.make();\n'
    );

    expectRule(
      result,
      "Features read atoms and call named commands from apps/web/src/client; do not use fetch or construct transport clients here."
    );
  });

  it("keeps AtomRpc access out of feature modules", () => {
    const result = lintFixture(
      "apps/cli/src/features",
      'import { AtomRpc } from "effect/unstable/reactivity/AtomRpc";\n\nexport const query = AtomRpc;\n'
    );

    expectRule(
      result,
      "Features read atoms and call named commands from apps/web/src/client; do not use fetch or construct transport clients here."
    );
  });

  it("keeps HTTP client construction out of feature modules", () => {
    const result = lintFixture(
      "apps/cli/src/features",
      "class HttpClient {}\n\nexport const client = new HttpClient();\n"
    );

    expectRule(
      result,
      "Features read atoms and call named commands from apps/web/src/client; do not use fetch or construct transport clients here."
    );
  });

  it("allows the client module to own transport", () => {
    const result = lintFixture(
      "apps/cli/src/client",
      'import { RpcClient } from "effect/unstable/rpc";\n\nexport const client = RpcClient.make();\n'
    );

    expect(result.status).toBe(0);
  });

  it("blocks hand-rolled RPC, HTTP, and MCP surfaces outside the capability package", () => {
    const rpc = lintFixture(
      "apps/web/src/server",
      'import { Rpc } from "effect/unstable/rpc";\n\nexport const athlete = Rpc.make("athlete");\n'
    );

    const endpoint = lintFixture(
      "packages/core/src",
      'import { HttpApiEndpoint } from "effect/unstable/httpapi";\n\nexport const route = HttpApiEndpoint.post("route", "/route");\n'
    );

    expectRule(rpc, "Rpc.make hand-rolls a surface.");
    expectRule(endpoint, "HttpApiEndpoint.post hand-rolls a surface.");
  });

  it("lets packages/capability build surfaces", () => {
    const result = lintFixture(
      "packages/capability/src",
      'import { Rpc } from "effect/unstable/rpc";\n\nexport const projected = Rpc.make("projected");\n'
    );

    expect(result.status).toBe(0);
  });

  it("keeps browser globals out of server and package code", () => {
    const route = lintFixture(
      "apps/web/src/routes",
      "export const here = () => window.location.href;\n"
    );

    const core = lintFixture(
      "packages/core/src",
      "export const title = () => document.title;\n"
    );

    expectRule(route, "window exists only in a browser.");
    expectRule(core, "document exists only in a browser.");
  });

  it("allows browser globals in client and feature modules", () => {
    const client = lintFixture(
      "apps/web/src/client",
      'export const saved = () => localStorage.getItem("rat");\n'
    );

    const guard = lintFixture(
      "apps/web/src/routes",
      'export const inBrowser = () => typeof window !== "undefined";\n'
    );

    expect(client.status).toBe(0);
    expect(guard.status).toBe(0);
  });
});
