import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { McpServer } from "effect/unstable/ai";

import { Approval } from "../src/index.js";
import { layerSubprocess } from "../src/sandbox-subprocess.js";
import { toCodeMode } from "../src/to-code-mode.js";
import {
  Greeter,
  approved,
  checkedInput,
  echo,
  greet,
  noArgs,
} from "./fixtures.js";
import { makeMcpClient, serverLayer } from "./mcp-harness.js";

const projection = toCodeMode([echo, greet]);

const approvalProjection = toCodeMode([approved]);

const checkedInputProjection = toCodeMode([checkedInput]);

const noArgsProjection = toCodeMode([noArgs]);

const appLayer = McpServer.toolkit(projection.toolkit).pipe(
  Layer.provideMerge(projection.layer),
  Layer.provide(Greeter.layer),
  Layer.provide(
    Layer.provide(layerSubprocess({ timeout: "5 seconds" }), NodeServices.layer)
  ),
  Layer.provide(serverLayer)
);

const deniedApprovalApp = McpServer.toolkit(approvalProjection.toolkit).pipe(
  Layer.provideMerge(approvalProjection.layer),
  Layer.provide(Approval.denyAll),
  Layer.provide(
    Layer.provide(layerSubprocess({ timeout: "5 seconds" }), NodeServices.layer)
  ),
  Layer.provide(serverLayer)
);

const allowedApprovalApp = McpServer.toolkit(approvalProjection.toolkit).pipe(
  Layer.provideMerge(approvalProjection.layer),
  Layer.provide(Approval.allowAll),
  Layer.provide(
    Layer.provide(layerSubprocess({ timeout: "5 seconds" }), NodeServices.layer)
  ),
  Layer.provide(serverLayer)
);

describe("toCodeMode", () => {
  it("keeps empty and checked input schemas in the code-mode catalog", () => {
    const checkedInputSchema =
      checkedInputProjection.catalog.capabilities[0]?.input;

    const noArgsSchema = noArgsProjection.catalog.capabilities[0]?.input;

    expect(checkedInputSchema).toMatchObject({
      properties: {
        mode: { enum: ["fast", "slow"] },
        values: { maxItems: 3, minItems: 1 },
      },
      type: "object",
    });

    expect(checkedInputProjection.declarations).toContain(
      'readonly checkedInput: (input: { readonly mode: "fast" | "slow"; readonly values: ReadonlyArray<string> }) => Promise<string>;'
    );

    expect(noArgsSchema).toEqual({ properties: {}, type: "object" });
    expect(noArgsProjection.declarations).toContain(
      "readonly noArgs: (input: {}) => Promise<string>;"
    );
  });

  it.effect(
    "exposes exactly search and execute, with the types in execute",
    () =>
      Effect.gen(function* exposesTwoTools() {
        const client = yield* makeMcpClient(appLayer);
        const { tools } = yield* client["tools/list"]({});
        const names = tools.map((tool) => tool.name);

        expect(names).toHaveLength(2);
        expect(names).toContain("search");
        expect(names).toContain("execute");
        const execute = tools.find((tool) => tool.name === "execute");
        expect(execute?.description).toContain("declare const tools: {");
        expect(execute?.description).toContain("readonly greet:");
        expect(execute?.annotations?.readOnlyHint).toBe(false);
      })
  );

  it("leaves the declarations out of execute when search serves them", () => {
    const { declarations, toolkit } = toCodeMode([echo, greet], {
      declarations: "search",
    });

    const { description } = toolkit.tools.execute;

    expect(description).not.toContain("declare const tools");
    expect(description).toContain("Call `search` first");
    expect(declarations).toContain("readonly greet:");
  });

  it.effect("search returns ranked signatures", () =>
    Effect.gen(function* searches() {
      const client = yield* makeMcpClient(appLayer);

      const result = yield* client["tools/call"]({
        arguments: { query: "repeat text" },
        name: "search",
      });

      expect(result.isError).toBeFalsy();
      expect(result.structuredContent).toMatchObject({
        matches: [{ name: "echo" }],
        total: 2,
      });
    })
  );

  it.effect(
    "execute runs a program that calls capabilities through their schemas",
    () =>
      Effect.gen(function* executes() {
        const client = yield* makeMcpClient(appLayer);

        const result = yield* client["tools/call"]({
          arguments: {
            code: [
              "const hello = await tools.greet({ name: 'rat' });",
              "const twice = await tools.echo({ text: hello.greeting, times: 2 });",
              "let caught;",
              "try { await tools.greet({ name: 'nobody' }); } catch (error) { caught = error._tag; }",
              "let invalid;",
              "try { await tools.echo({ text: 42 }); } catch (error) { invalid = error._tag; }",
              "console.log('done');",
              "return { twice: twice.text, caught, invalid };",
            ].join("\n"),
          },
          name: "execute",
        });

        expect(result.isError).toBeFalsy();
        expect(result.structuredContent).toEqual({
          logs: ["log: done"],
          result: {
            caught: "NotFound",
            invalid: "InvalidInput",
            twice: "hello rathello rat",
          },
        });
      })
  );

  it.effect("execute surfaces a thrown program error as a tool error", () =>
    Effect.gen(function* surfacesThrow() {
      const client = yield* makeMcpClient(appLayer);

      const result = yield* client["tools/call"]({
        arguments: { code: "throw new Error('nope')" },
        name: "execute",
      });

      expect(result.isError).toBe(true);
      const [content] = result.content;
      expect(content?.type === "text" ? content.text : "").toContain("nope");
    })
  );

  it.effect("requires approval before code mode execution", () =>
    Effect.gen(function* gatesCodeMode() {
      const deniedClient = yield* makeMcpClient(deniedApprovalApp);

      const denied = yield* deniedClient["tools/call"]({
        arguments: { code: "return await tools.approved({ message: 'run' });" },
        name: "execute",
      });

      expect(denied.isError).toBe(true);
      const [content] = denied.content;
      expect(content?.type === "text" ? content.text : "").toContain(
        "Approval is required"
      );

      const allowedClient = yield* makeMcpClient(allowedApprovalApp);

      const allowed = yield* allowedClient["tools/call"]({
        arguments: { code: "return await tools.approved({ message: 'run' });" },
        name: "execute",
      });

      expect(allowed.structuredContent).toEqual({
        logs: [],
        result: { ok: true },
      });
    })
  );
});
