import { expect, it } from "@effect/vitest";
import { ExecuteResult } from "@rat-stack/capability/code-mode";
import { Effect, Layer, Schema } from "effect";
import * as McpSchema from "effect/unstable/ai/McpSchema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { routes } from "../src/app.js";
import { ReadOutput, SearchOutput } from "../src/capabilities/schemas.js";
import {
  agentSkillPath,
  lawResources,
  linkHeader,
  llmsText,
  markdownDocument,
  publicPaths,
  robotsText,
  skills,
} from "../src/content.js";
import { TestSandbox } from "./test-sandbox.js";

type WebHandler = (request: Request) => Promise<Response>;

const testRoutes = routes.pipe(Layer.provide(TestSandbox));

const sha256 = (text: string) =>
  Effect.promise(
    // Web Crypto owns the Promise at this test boundary.
    // oxlint-disable-next-line typescript/promise-function-async
    () => crypto.subtle.digest("SHA-256", new TextEncoder().encode(text))
  ).pipe(
    Effect.map((bytes) =>
      Array.from(new Uint8Array(bytes), (byte) =>
        byte.toString(16).padStart(2, "0")
      ).join("")
    )
  );

const metadata = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "MischiefTest",
    version: "0.2.0",
  },
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
} as const;

const postMcp = Effect.fnUntraced(function* postMcpRequest(
  handler: WebHandler,
  id: string,
  method: string,
  params: Readonly<Record<string, unknown>> = {},
  name?: string
) {
  const request = new Request("http://localhost/mcp", {
    body: JSON.stringify({
      id,
      jsonrpc: "2.0",
      method,
      params: { ...params, _meta: metadata },
    }),
    headers: {
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(name === undefined ? {} : { "Mcp-Name": name }),
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
    },
    method: "POST",
  });
  return yield* Effect.promise(handler.bind(undefined, request));
});

const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);

const readJson = Effect.fnUntraced(function* readJsonResponse(
  response: Response
) {
  const body = yield* Effect.promise(response.text.bind(response));
  return yield* decodeJson(body);
});

const postJson = Effect.fnUntraced(function* postJsonRequest(
  handler: WebHandler,
  path: string,
  body: unknown
) {
  return yield* Effect.promise(
    handler.bind(
      undefined,
      new Request(`http://localhost${path}`, {
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    )
  );
});

const withHandler = <A, E, R>(
  use: (handler: WebHandler) => Effect.Effect<A, E, R>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(testRoutes, { disableLogger: true })
    ),
    ({ handler }) => use(handler),
    ({ dispose }) => Effect.promise(dispose)
  );

const ErrorResponse = Schema.Struct({
  error: Schema.Struct({
    code: Schema.Finite,
    message: Schema.String,
  }),
  id: Schema.String,
});

const DiscoverResponse = Schema.Struct({
  id: Schema.String,
  result: Schema.Struct({
    instructions: Schema.optional(Schema.String),
    supportedVersions: Schema.Array(Schema.String),
  }),
});

const NamedListResponse = Schema.Struct({
  result: Schema.Struct({
    prompts: Schema.optional(
      Schema.Array(Schema.Struct({ name: Schema.String }))
    ),
    resources: Schema.optional(
      Schema.Array(Schema.Struct({ name: Schema.String, uri: Schema.String }))
    ),
    tools: Schema.optional(
      Schema.Array(Schema.Struct({ name: Schema.String }))
    ),
  }),
});

const ToolCallResponse = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    structuredContent: Schema.Unknown,
  }),
});

const ReadResourceResponse = Schema.Struct({
  id: Schema.String,
  result: Schema.Struct({
    contents: Schema.Array(
      Schema.Struct({
        text: Schema.String,
        uri: Schema.String,
      })
    ),
  }),
});

it.effect(
  "serves the catalogue as Markdown by default and HTML on request",
  () =>
    withHandler((handler) =>
      Effect.gen(function* testCatalogue() {
        const markdownResponse = yield* Effect.promise(
          handler.bind(undefined, new Request("http://localhost/"))
        );
        const htmlResponse = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/", {
              headers: { accept: "text/html" },
            })
          )
        );
        const markdown = yield* Effect.promise(
          markdownResponse.text.bind(markdownResponse)
        );
        const html = yield* Effect.promise(
          htmlResponse.text.bind(htmlResponse)
        );

        expect(markdownResponse.status).toBe(200);
        expect(markdownResponse.headers.get("content-type")).toContain(
          "text/markdown"
        );
        expect(markdownResponse.headers.get("link")).toBe(linkHeader);
        expect(markdown).toBe(markdownDocument("https://ratstack.sh"));
        expect(markdown).toContain("npx skills add joelhooks/rat-stack");
        expect(markdown).toContain("## Law");
        expect(markdown).toContain("## MCP");
        expect(htmlResponse.headers.get("content-type")).toContain("text/html");
        expect(html).toContain("<pre>");
        expect(html).toContain('property="og:image"');
      })
    )
);

it.effect("serves every public GET route and exact skill discovery bytes", () =>
  withHandler((handler) =>
    Effect.gen(function* testPublicRoutes() {
      for (const path of publicPaths) {
        const response = yield* Effect.promise(
          handler.bind(undefined, new Request(`http://localhost${path}`))
        );
        expect(response.status, path).toBe(200);
      }

      for (const skill of skills) {
        const friendly = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request(`http://localhost${skill.routePath}`)
          )
        );
        const discovery = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request(`http://localhost${agentSkillPath(skill.name)}`)
          )
        );
        const friendlyText = yield* Effect.promise(
          friendly.text.bind(friendly)
        );
        const discoveryText = yield* Effect.promise(
          discovery.text.bind(discovery)
        );
        const digest = yield* sha256(discoveryText);

        expect(friendlyText).toBe(skill.text);
        expect(discoveryText).toBe(skill.text);
        expect(`sha256:${digest}`).toBe(`sha256:${skill.digest}`);
      }
    })
  )
);

it.effect("serves agent indexes, cards, sitemap, and robots policy", () =>
  withHandler((handler) =>
    Effect.gen(function* testDiscoveryDocuments() {
      const llms = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/llms.txt"))
      );
      const robots = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/robots.txt"))
      );
      const index = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/.well-known/agent-skills/index.json")
        )
      );
      const apiCatalog = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/.well-known/api-catalog")
        )
      );
      const openapi = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/openapi.json"))
      );

      expect(yield* Effect.promise(llms.text.bind(llms))).toBe(
        llmsText("https://ratstack.sh")
      );
      expect(yield* Effect.promise(robots.text.bind(robots))).toBe(robotsText);
      expect(robotsText).toContain(
        "Content-Signal: ai-train=no, search=yes, ai-input=yes"
      );
      expect(index.headers.get("access-control-allow-origin")).toBe("*");
      expect(index.headers.get("content-type")).toContain("application/json");
      expect(apiCatalog.headers.get("content-type")).toContain(
        "application/linkset+json"
      );

      const openapiBody = yield* readJson(openapi);
      const OpenApiPaths = Schema.Struct({
        paths: Schema.Record(Schema.String, Schema.Unknown),
      });
      const document =
        yield* Schema.decodeUnknownEffect(OpenApiPaths)(openapiBody);
      expect(Object.keys(document.paths).toSorted()).toEqual([
        "/api/execute",
        "/api/read",
        "/api/search",
      ]);
    })
  )
);

it.effect("projects search, read, and execute through HTTP", () =>
  withHandler((handler) =>
    Effect.gen(function* testHttpCapabilities() {
      const searched = yield* postJson(handler, "/api/search", {
        limit: 1,
        query: "capability",
      });
      const searchResult = yield* Schema.decodeUnknownEffect(SearchOutput)(
        yield* readJson(searched)
      );
      const id = searchResult.matches[0]?.id;
      expect(searched.status).toBe(200);
      expect(id).toBeDefined();

      const read = yield* postJson(handler, "/api/read", { id });
      const readResult = yield* Schema.decodeUnknownEffect(ReadOutput)(
        yield* readJson(read)
      );
      expect(readResult.text).toContain("capability");

      const executed = yield* postJson(handler, "/api/execute", {
        code: [
          "const found = await tools.search({ query: 'capability', limit: 1 });",
          "return await tools.read({ id: found.matches[0].id });",
        ].join("\n"),
      });
      const executeResult = yield* Schema.decodeUnknownEffect(ExecuteResult)(
        yield* readJson(executed)
      );
      expect(executeResult.logs).toEqual(["test: search then read"]);
      expect(executeResult.result).toMatchObject({ id });
    })
  )
);

it.effect(
  "exposes all tools, law resources, and skill prompts over modern MCP",
  () =>
    withHandler((handler) =>
      Effect.gen(function* testMcpSurfaces() {
        const legacyInitialize = yield* postMcp(
          handler,
          "legacy-initialize",
          "initialize"
        );
        const initializeError = yield* Schema.decodeUnknownEffect(
          ErrorResponse
        )(yield* readJson(legacyInitialize));
        expect(legacyInitialize.status).toBe(404);
        expect(initializeError.error.code).toBe(
          McpSchema.METHOD_NOT_FOUND_ERROR_CODE
        );

        const discovery = yield* postMcp(
          handler,
          "discover",
          "server/discover"
        );
        const discovered = yield* Schema.decodeUnknownEffect(DiscoverResponse)(
          yield* readJson(discovery)
        );
        expect(discovered.result.supportedVersions).toEqual(["2026-07-28"]);

        const toolsList = yield* postMcp(handler, "tools", "tools/list");
        const resourcesList = yield* postMcp(
          handler,
          "resources",
          "resources/list"
        );
        const promptsList = yield* postMcp(handler, "prompts", "prompts/list");
        const toolNames = (yield* Schema.decodeUnknownEffect(NamedListResponse)(
          yield* readJson(toolsList)
        )).result.tools?.map((tool) => tool.name);
        const resourceNames = (yield* Schema.decodeUnknownEffect(
          NamedListResponse
        )(yield* readJson(resourcesList))).result.resources?.map(
          (resource) => resource.name
        );
        const promptNames = (yield* Schema.decodeUnknownEffect(
          NamedListResponse
        )(yield* readJson(promptsList))).result.prompts?.map(
          (prompt) => prompt.name
        );

        expect(toolNames?.toSorted()).toEqual(["execute", "read", "search"]);
        expect(resourceNames?.toSorted()).toEqual(
          lawResources.map((resource) => resource.name).toSorted()
        );
        expect(promptNames?.toSorted()).toEqual(
          skills.map((skill) => skill.name).toSorted()
        );
      })
    )
);

it.effect(
  "calls search, read, and a search-then-read execute program over MCP",
  () =>
    withHandler((handler) =>
      Effect.gen(function* testMcpTools() {
        const searchResponse = yield* postMcp(
          handler,
          "search",
          "tools/call",
          { arguments: { limit: 1, query: "capability" }, name: "search" },
          "search"
        );
        const searched = yield* Schema.decodeUnknownEffect(ToolCallResponse)(
          yield* readJson(searchResponse)
        );
        const searchResult = yield* Schema.decodeUnknownEffect(SearchOutput)(
          searched.result.structuredContent
        );
        const id = searchResult.matches[0]?.id;
        expect(id).toBeDefined();

        const readResponse = yield* postMcp(
          handler,
          "read",
          "tools/call",
          { arguments: { id }, name: "read" },
          "read"
        );
        const read = yield* Schema.decodeUnknownEffect(ToolCallResponse)(
          yield* readJson(readResponse)
        );
        const readResult = yield* Schema.decodeUnknownEffect(ReadOutput)(
          read.result.structuredContent
        );
        expect(readResult.id).toBe(id);

        const executeResponse = yield* postMcp(
          handler,
          "execute",
          "tools/call",
          {
            arguments: {
              code: [
                "const found = await tools.search({ query: 'capability', limit: 1 });",
                "return await tools.read({ id: found.matches[0].id });",
              ].join("\n"),
            },
            name: "execute",
          },
          "execute"
        );
        const executed = yield* Schema.decodeUnknownEffect(ToolCallResponse)(
          yield* readJson(executeResponse)
        );
        const executeResult = yield* Schema.decodeUnknownEffect(ExecuteResult)(
          executed.result.structuredContent
        );
        expect(executeResult.result).toMatchObject({ id });

        const [law] = lawResources;
        expect(law).toBeDefined();
        if (law === undefined) {
          return;
        }
        const resourceResponse = yield* postMcp(
          handler,
          "read-law",
          "resources/read",
          { uri: law.id },
          law.id
        );
        const resource = yield* Schema.decodeUnknownEffect(
          ReadResourceResponse
        )(yield* readJson(resourceResponse));
        expect(resource.result.contents).toEqual([
          { text: law.text, uri: law.id },
        ]);
      })
    )
);
