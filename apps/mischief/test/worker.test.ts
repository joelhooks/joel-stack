import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as McpSchema from "effect/unstable/ai/McpSchema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import {
  AGENT_LAW_URI,
  agentLaw,
  agentPage,
  llmsText,
  robotsText,
} from "../src/content.js";
import { routes } from "../src/worker.js";

type WebHandler = (request: Request) => Promise<Response>;

const metadata = {
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": {
    name: "MischiefTest",
    version: "0.1.0",
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

it.effect("serves the agent-first root as Markdown by default", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
    ({ handler }) =>
      Effect.gen(function* testMarkdownRoot() {
        const request = new Request("http://localhost/");
        const response = yield* Effect.promise(
          handler.bind(undefined, request, undefined)
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/markdown");
        expect(yield* Effect.promise(response.text.bind(response))).toBe(
          agentPage
        );
      }),
    ({ dispose }) => Effect.promise(dispose)
  )
);

it.effect("serves the same root text inside HTML", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
    ({ handler }) =>
      Effect.gen(function* testHtmlRoot() {
        const request = new Request("http://localhost/", {
          headers: { accept: "text/html" },
        });
        const response = yield* Effect.promise(
          handler.bind(undefined, request, undefined)
        );
        const body = yield* Effect.promise(response.text.bind(response));

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain("text/html");
        expect(body).toContain("<pre>");
        expect(body).toContain(agentPage);
        expect(body).toContain('property="og:image"');
      }),
    ({ dispose }) => Effect.promise(dispose)
  )
);

it.effect("serves llms.txt and robots.txt", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
    ({ handler }) =>
      Effect.gen(function* testAgentDocuments() {
        const llmsRequest = new Request("http://localhost/llms.txt");
        const robotsRequest = new Request("http://localhost/robots.txt");
        const llmsResponse = yield* Effect.promise(
          handler.bind(undefined, llmsRequest, undefined)
        );
        const robotsResponse = yield* Effect.promise(
          handler.bind(undefined, robotsRequest, undefined)
        );

        expect(llmsResponse.status).toBe(200);
        expect(llmsResponse.headers.get("content-type")).toContain(
          "text/markdown"
        );
        expect(
          yield* Effect.promise(llmsResponse.text.bind(llmsResponse))
        ).toBe(llmsText);
        expect(robotsResponse.status).toBe(200);
        expect(
          yield* Effect.promise(robotsResponse.text.bind(robotsResponse))
        ).toBe(robotsText);
      }),
    ({ dispose }) => Effect.promise(dispose)
  )
);

it.effect("uses modern MCP discovery and reads the project-law resource", () =>
  Effect.acquireUseRelease(
    Effect.sync(() => HttpRouter.toWebHandler(routes, { disableLogger: true })),
    ({ handler }) =>
      Effect.gen(function* testModernMcp() {
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

        expect(discovery.status).toBe(200);
        expect(discovered.result.supportedVersions).toEqual(["2026-07-28"]);

        const resource = yield* postMcp(
          handler,
          "read-law",
          "resources/read",
          { uri: AGENT_LAW_URI },
          AGENT_LAW_URI
        );
        const read = yield* Schema.decodeUnknownEffect(ReadResourceResponse)(
          yield* readJson(resource)
        );

        expect(resource.status).toBe(200);
        expect(read.result.contents).toEqual([
          { text: agentLaw, uri: AGENT_LAW_URI },
        ]);
      }),
    ({ dispose }) => Effect.promise(dispose)
  )
);
