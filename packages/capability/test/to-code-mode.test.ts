import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { McpServer } from "effect/unstable/ai";

import { layerSubprocess } from "../src/sandbox.js";
import { toCodeMode } from "../src/to-code-mode.js";
import { Greeter, echo, greet } from "./fixtures.js";
import { makeMcpClient, serverLayer } from "./mcp-harness.js";

const projection = toCodeMode([echo, greet]);

const appLayer = McpServer.toolkit(projection.toolkit).pipe(
  Layer.provideMerge(projection.layer),
  Layer.provide(Greeter.layer),
  Layer.provide(
    Layer.provide(layerSubprocess({ timeout: "5 seconds" }), NodeServices.layer)
  ),
  Layer.provide(serverLayer)
);

describe("toCodeMode", () => {
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
});
