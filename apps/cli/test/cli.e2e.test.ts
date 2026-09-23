// @effect-diagnostics nodeBuiltinImport:off asyncFunction:off newPromise:off globalTimers:off
// Black-box tests of the built binary: they spawn dist/cli.js as a child
// process and assert on stdout, stderr, and exit codes. Node built-ins and a
// Promise-based stdio conversation are the right tools at that boundary, so
// the Effect-native diagnostics are off here.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

const cliDir = path.resolve(import.meta.dirname, "..");

const repoRoot = path.resolve(cliDir, "../..");

const cliPath = path.join(cliDir, "dist", "cli.js");

const readmePath = path.join(repoRoot, "README.md");

const decodeOpenApi = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({
      paths: Schema.Record(
        Schema.String,
        Schema.Record(Schema.String, Schema.Unknown)
      ),
    })
  )
);

const JsonRpcResponse = Schema.Struct({
  error: Schema.optional(Schema.Unknown),
  id: Schema.optional(Schema.Number),
  result: Schema.optional(Schema.Unknown),
});

const decodeJsonRpcResponse = Schema.decodeUnknownSync(
  Schema.fromJsonString(JsonRpcResponse)
);

const decodeToolsList = Schema.decodeUnknownSync(
  Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        annotations: Schema.optional(
          Schema.Struct({ readOnlyHint: Schema.optional(Schema.Boolean) })
        ),
        name: Schema.String,
      })
    ),
  })
);

const runCli = (arguments_: readonly string[]) =>
  spawnSync(process.execPath, [cliPath, ...arguments_], {
    cwd: repoRoot,
    encoding: "utf-8",
  });

/** Runs `rat-stack mcp [flags]` and speaks newline-delimited JSON-RPC to it. */
const mcpConversation = async (
  messages: readonly object[],
  flags: readonly string[] = []
): Promise<(typeof JsonRpcResponse.Type)[]> =>
  // A child process conversation has no library Promise to return.
  // oxlint-disable-next-line promise/avoid-new
  await new Promise<(typeof JsonRpcResponse.Type)[]>((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, "mcp", ...flags], {
      cwd: repoRoot,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const responses: (typeof JsonRpcResponse.Type)[] = [];
    const wanted = messages.filter((message) => "id" in message).length;
    let buffer = "";

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`mcp timed out with stdout: ${buffer}`));
    }, 15_000);

    child.stdout.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (line.trim() === "") {
          continue;
        }

        const message = decodeJsonRpcResponse(line);

        if (message.id !== undefined) {
          responses.push(message);
        }
      }

      if (responses.length >= wanted) {
        clearTimeout(timer);
        child.kill();
        resolve(responses);
      }
    });
    child.on("error", reject);

    for (const message of messages) {
      child.stdin.write(`${JSON.stringify(message)}\n`);
    }
  });

describe("built CLI", () => {
  it("prints help and exits cleanly", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("USAGE");

    for (const name of ["stats", "catalog", "openapi", "serve", "mcp"]) {
      expect(result.stdout).toContain(name);
    }
  });

  it("prints human-readable stats without --json", () => {
    const result = runCli(["stats", readmePath]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(readmePath);
    expect(result.stdout).toMatch(/words:\s+\d+/u);
  });

  it("prints JSON stats and exits cleanly", () => {
    const result = runCli(["stats", readmePath, "--json"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`"path": "${readmePath}"`);
    expect(result.stdout).toMatch(/"words": \d+/u);
  });

  it("reports the typed failure and exits one for a missing file", () => {
    const result = runCli(["stats", "this-file-does-not-exist.txt"]);

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "Could not read this-file-does-not-exist.txt"
    );
  });

  it("prints the catalog as TypeScript declarations", () => {
    const result = runCli(["catalog", "--types"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("declare const tools: {");
    expect(result.stdout).toContain("readonly inspectFile: (input:");
  });

  it("prints an OpenAPI document with one path per capability", () => {
    const result = runCli(["openapi"]);

    expect(result.status).toBe(0);
    const document = decodeOpenApi(result.stdout);
    expect(document.paths["/inspectFile"]?.post).toBeDefined();
  });
});

const initialize = [
  {
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "e2e", version: "0.0.0" },
      protocolVersion: "2025-06-18",
    },
  },
  { jsonrpc: "2.0", method: "notifications/initialized" },
] as const;

describe("built MCP server", () => {
  it("runs a program against the capabilities in code mode", async () => {
    const responses = await mcpConversation(
      [
        ...initialize,
        {
          id: 2,
          jsonrpc: "2.0",
          method: "tools/call",
          params: {
            arguments: {
              code: `const stats = await tools.inspectFile({ path: ${JSON.stringify(readmePath)} }); return stats.lines > 10;`,
            },
            name: "execute",
          },
        },
      ],
      ["--code-mode"]
    );

    const call = responses.find((response) => response.id === 2);
    expect(call?.error).toBeUndefined();
    expect(call?.result).toMatchObject({
      structuredContent: { logs: [], result: true },
    });
  });

  it("lists the capabilities as tools over stdio", async () => {
    const responses = await mcpConversation([
      {
        id: 1,
        jsonrpc: "2.0",
        method: "initialize",
        params: {
          capabilities: {},
          clientInfo: { name: "e2e", version: "0.0.0" },
          protocolVersion: "2025-06-18",
        },
      },
      { jsonrpc: "2.0", method: "notifications/initialized" },
      { id: 2, jsonrpc: "2.0", method: "tools/list", params: {} },
    ]);

    const listing = responses.find((response) => response.id === 2);
    expect(listing?.error).toBeUndefined();
    const result = decodeToolsList(listing?.result);

    const tool = result.tools.find(
      (candidate) => candidate.name === "inspectFile"
    );

    expect(tool).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(true);
  });
});
