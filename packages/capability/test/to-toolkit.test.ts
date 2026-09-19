import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { McpServer } from "effect/unstable/ai";

import { toToolkit } from "../src/index.js";
import { Greeter, echo, greet } from "./fixtures.js";
import { makeMcpClient, serverLayer } from "./mcp-harness.js";

const projection = toToolkit([echo, greet]);

const appLayer = McpServer.toolkit(projection.toolkit).pipe(
  Layer.provideMerge(projection.layer),
  Layer.provide(Greeter.layer),
  Layer.provide(serverLayer)
);

describe("toToolkit", () => {
  it.effect("lists every capability as a tool with its annotations", () =>
    Effect.gen(function* listsTools() {
      const client = yield* makeMcpClient(appLayer);
      const { tools } = yield* client["tools/list"]({});

      const names = tools.map((tool) => tool.name);
      expect(names).toHaveLength(2);
      expect(names).toContain("echo");
      expect(names).toContain("greet");
      const echoTool = tools.find((tool) => tool.name === "echo");
      expect(echoTool?.description).toBe("Repeat text a number of times");
      expect(echoTool?.annotations?.readOnlyHint).toBe(true);
      expect(echoTool?.annotations?.idempotentHint).toBe(true);
      expect(echoTool?.inputSchema).toMatchObject({
        properties: { text: { description: "Text to repeat", type: "string" } },
        required: ["text"],
      });
    })
  );

  it.effect("calls a capability through its requirements", () =>
    Effect.gen(function* callsTool() {
      const client = yield* makeMcpClient(appLayer);
      const result = yield* client["tools/call"]({
        arguments: { name: "rat" },
        name: "greet",
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toEqual({ greeting: "hello rat" });
    })
  );

  it.effect("returns a declared failure as a tool error, not a crash", () =>
    Effect.gen(function* failsTool() {
      const client = yield* makeMcpClient(appLayer);
      const result = yield* client["tools/call"]({
        arguments: { name: "nobody" },
        name: "greet",
      });

      expect(result.isError).toBe(true);
      const [content] = result.content;
      expect(content?.type === "text" ? content.text : "").toContain(
        "No one called nobody"
      );
    })
  );
});
