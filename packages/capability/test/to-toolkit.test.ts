import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { McpServer } from "effect/unstable/ai";

import { Approval, toToolkit } from "../src/index.js";
import {
  Greeter,
  approved,
  checkedInput,
  echo,
  greet,
  noArgs,
} from "./fixtures.js";
import { makeMcpClient, serverLayer } from "./mcp-harness.js";

const projection = toToolkit([echo, greet]);

const appLayer = McpServer.toolkit(projection.toolkit).pipe(
  Layer.provideMerge(projection.layer),
  Layer.provide(Greeter.layer),
  Layer.provide(serverLayer)
);

const noArgsProjection = toToolkit([noArgs]);

const noArgsAppLayer = McpServer.toolkit(noArgsProjection.toolkit).pipe(
  Layer.provideMerge(noArgsProjection.layer),
  Layer.provide(serverLayer)
);

const checkedInputProjection = toToolkit([checkedInput]);

const checkedInputAppLayer = McpServer.toolkit(
  checkedInputProjection.toolkit
).pipe(
  Layer.provideMerge(checkedInputProjection.layer),
  Layer.provide(serverLayer)
);

const approvalProjection = toToolkit([approved]);

const deniedApprovalApp = McpServer.toolkit(approvalProjection.toolkit).pipe(
  Layer.provideMerge(approvalProjection.layer),
  Layer.provide(Approval.denyAll),
  Layer.provide(serverLayer)
);

const allowedApprovalApp = McpServer.toolkit(approvalProjection.toolkit).pipe(
  Layer.provideMerge(approvalProjection.layer),
  Layer.provide(Approval.allowAll),
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

  it.effect("registers and calls a contract with no input fields", () =>
    Effect.gen(function* registersAndCallsNoArgs() {
      const client = yield* makeMcpClient(noArgsAppLayer);
      const { tools } = yield* client["tools/list"]({});
      const tool = tools.find((item) => item.name === "noArgs");

      expect(tool?.inputSchema).toEqual({
        additionalProperties: false,
        type: "object",
      });

      const result = yield* client["tools/call"]({
        arguments: {},
        name: "noArgs",
      });

      expect(result.isError).toBeFalsy();
      const [content] = result.content;
      expect(content?.type === "text" ? content.text : "").toContain("ready");
    })
  );

  it.effect(
    "advertises Effect-checked constraints and rejects invalid input",
    () =>
      Effect.gen(function* validatesCheckedInput() {
        const client = yield* makeMcpClient(checkedInputAppLayer);
        const { tools } = yield* client["tools/list"]({});
        const tool = tools.find((item) => item.name === "checkedInput");

        expect(tool?.inputSchema).toMatchObject({
          properties: {
            mode: { enum: ["fast", "slow"] },
            values: { maxItems: 3, minItems: 1 },
          },
          type: "object",
        });

        const invalidInputs = [
          { mode: "turbo", values: ["one"] },
          { mode: "fast", values: [] },
          { mode: "slow", values: ["one", "two", "three", "four"] },
        ];

        for (const input of invalidInputs) {
          const result = yield* client["tools/call"]({
            arguments: input,
            name: "checkedInput",
          }).pipe(Effect.exit);

          expect(result._tag).toBe("Failure");
        }
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

  it.effect("turns approval denial into a typed tool error", () =>
    Effect.gen(function* deniesApprovedTool() {
      const deniedClient = yield* makeMcpClient(deniedApprovalApp);

      const denied = yield* deniedClient["tools/call"]({
        arguments: { message: "run" },
        name: "approved",
      });

      expect(denied.isError).toBe(true);
      const [content] = denied.content;
      expect(content?.type === "text" ? content.text : "").toContain(
        "Approval is required"
      );

      const allowedClient = yield* makeMcpClient(allowedApprovalApp);

      const allowed = yield* allowedClient["tools/call"]({
        arguments: { message: "run" },
        name: "approved",
      });

      expect(allowed.structuredContent).toEqual({ ok: true });
    })
  );
});
