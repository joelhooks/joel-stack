import { expect, it } from "@effect/vitest";
import { ExecuteResult } from "@rat-stack/capability/code-mode";
import { Effect, Layer, Schema } from "effect";
import * as McpSchema from "effect/unstable/ai/McpSchema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { makeRoutes } from "../src/app.js";
import { ReadOutput, SearchOutput } from "../src/capabilities/schemas.js";
import {
  a2aAgentCard,
  agentSkillPath,
  ardManifest,
  authMarkdown,
  lawResources,
  linkHeader,
  llmsText,
  markdownDocument,
  mcpVersionText,
  publicPaths,
  robotsText,
  skills,
} from "../src/content.js";
import { makeRateLimits } from "../src/rate-limits.js";
import type {
  NativeRateLimitBinding,
  RateLimitBindings,
} from "../src/rate-limits.js";
import { TestSandbox } from "./test-sandbox.js";

type WebHandler = (request: Request) => Promise<Response>;

class FakeRateLimitBinding implements NativeRateLimitBinding {
  readonly keys: string[] = [];
  readonly #results: boolean[];

  constructor(results: readonly boolean[] = []) {
    this.#results = [...results];
  }

  // The fake deliberately matches Cloudflare's Promise-returning binding.
  // oxlint-disable-next-line typescript/promise-function-async
  limit(options: { readonly key: string }) {
    this.keys.push(options.key);
    return Promise.resolve({ success: this.#results.shift() ?? true });
  }
}

const fakeRateLimitBindings = (
  overrides: Partial<RateLimitBindings> = {}
): RateLimitBindings => ({
  API_PER_IP: overrides.API_PER_IP ?? new FakeRateLimitBinding(),
  EXECUTE_GLOBAL: overrides.EXECUTE_GLOBAL ?? new FakeRateLimitBinding(),
  EXECUTE_PER_IP: overrides.EXECUTE_PER_IP ?? new FakeRateLimitBinding(),
});

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
  use: (handler: WebHandler) => Effect.Effect<A, E, R>,
  rateLimits: RateLimitBindings = fakeRateLimitBindings()
) =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        makeRoutes({ rateLimits: makeRateLimits(rateLimits) }).pipe(
          Layer.provide(TestSandbox)
        ),
        { disableLogger: true }
      )
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
      Schema.Array(
        Schema.Struct({
          description: Schema.optional(Schema.String),
          name: Schema.String,
        })
      )
    ),
  }),
});

const ToolCallResponse = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    structuredContent: Schema.Unknown,
  }),
});

const ToolErrorResponse = Schema.Struct({
  result: Schema.Struct({
    content: Schema.Array(
      Schema.Struct({ text: Schema.String, type: Schema.Literal("text") })
    ),
    isError: Schema.Literal(true),
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

const A2aCard = Schema.Struct({
  name: Schema.String,
  skills: Schema.Array(
    Schema.Struct({
      description: Schema.String,
      id: Schema.String,
      name: Schema.String,
    })
  ),
  supportedInterfaces: Schema.Array(
    Schema.Struct({
      protocolBinding: Schema.String,
      protocolVersion: Schema.String,
      url: Schema.String,
    })
  ),
  version: Schema.String,
});

const A2aResponse = Schema.Struct({
  id: Schema.String,
  jsonrpc: Schema.Literal("2.0"),
  result: Schema.Struct({
    kind: Schema.Literal("message"),
    parts: Schema.Array(
      Schema.Struct({ kind: Schema.Literal("text"), text: Schema.String })
    ),
    role: Schema.Literal("agent"),
  }),
});

const ArdManifest = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      displayName: Schema.String,
      identifier: Schema.String,
      representativeQueries: Schema.Array(Schema.String),
      type: Schema.String,
      url: Schema.String,
    })
  ),
  host: Schema.Struct({
    displayName: Schema.String,
    identifier: Schema.String,
  }),
  specVersion: Schema.String,
});

const WebBotKeyDirectory = Schema.Struct({
  keys: Schema.Array(
    Schema.Struct({
      alg: Schema.String,
      crv: Schema.String,
      kid: Schema.String,
      kty: Schema.String,
      use: Schema.String,
      x: Schema.String,
    })
  ),
});

const makeTestPrivateJwk = Effect.promise(
  // Web Crypto owns the Promise at this test boundary.
  // oxlint-disable-next-line typescript/promise-function-async
  () => crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])
).pipe(
  Effect.flatMap((keyPair) => {
    if (!("privateKey" in keyPair)) {
      return Effect.die("Ed25519 key generation did not return a pair");
    }
    return Effect.promise(
      // Web Crypto owns the Promise at this test boundary.
      // oxlint-disable-next-line typescript/promise-function-async
      () => crypto.subtle.exportKey("jwk", keyPair.privateKey)
    );
  }),
  Effect.map(JSON.stringify)
);

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

      const llmsBody = yield* Effect.promise(llms.text.bind(llms));
      expect(llmsBody).toBe(llmsText("https://ratstack.sh"));
      expect(llmsBody).toContain("## MCP");
      expect(llmsBody).toContain("Protocol 2026-07-28 only");
      expect(llmsBody).toContain("6 per IP and 300 total per 60 seconds");
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

it.effect(
  "serves real A2A discovery and answers through search plus read",
  () =>
    withHandler((handler) =>
      Effect.gen(function* testA2a() {
        const canonicalCard = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/.well-known/agent-card.json")
          )
        );
        const legacyCard = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/.well-known/agent.json")
          )
        );
        const canonicalBody = yield* readJson(canonicalCard);
        const legacyBody = yield* readJson(legacyCard);
        const card = yield* Schema.decodeUnknownEffect(A2aCard)(canonicalBody);

        expect(canonicalCard.headers.get("content-type")).toContain(
          "application/a2a+json"
        );
        expect(canonicalBody).toEqual(a2aAgentCard("https://ratstack.sh"));
        expect(legacyBody).toEqual(canonicalBody);
        expect(card.supportedInterfaces).toEqual([
          {
            protocolBinding: "JSONRPC",
            protocolVersion: "1.0",
            url: "https://ratstack.sh/a2a",
          },
        ]);
        expect(card.skills.map((skill) => skill.id)).toEqual([
          "answer-rat-stack-question",
        ]);

        const response = yield* postJson(handler, "/a2a", {
          id: "question-1",
          jsonrpc: "2.0",
          method: "message/send",
          params: {
            message: {
              kind: "message",
              messageId: "message-1",
              parts: [{ kind: "text", text: "How do I add a capability?" }],
              role: "user",
            },
          },
        });
        const answered = yield* Schema.decodeUnknownEffect(A2aResponse)(
          yield* readJson(response)
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "application/a2a+json"
        );
        expect(answered.id).toBe("question-1");
        expect(answered.result.parts[0]?.text).toContain(
          "Source-grounded rat-stack matches"
        );
        expect(answered.result.parts[0]?.text).toContain(
          "Resource: ratstack://"
        );
        expect(answered.result.parts[0]?.text).toContain("Source:");
      })
    )
);

it.effect("serves the ARD manifest and honest anonymous auth.md", () =>
  withHandler((handler) =>
    Effect.gen(function* testArdAndAuth() {
      const ard = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/.well-known/ai-catalog.json")
        )
      );
      const auth = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/auth.md"))
      );
      const manifest = yield* Schema.decodeUnknownEffect(ArdManifest)(
        yield* readJson(ard)
      );
      const authBody = yield* Effect.promise(auth.text.bind(auth));

      expect(ard.status).toBe(200);
      expect(ard.headers.get("content-type")).toContain("application/json");
      expect(ard.headers.get("access-control-allow-origin")).toBe("*");
      expect(manifest).toEqual(ardManifest("https://ratstack.sh"));
      expect(manifest.entries).toHaveLength(2);
      expect(
        manifest.entries.every((entry) =>
          entry.identifier.startsWith("urn:air:ratstack.sh:")
        )
      ).toBe(true);

      expect(auth.status).toBe(200);
      expect(auth.headers.get("content-type")).toContain("text/markdown");
      expect(authBody).toBe(authMarkdown);
      expect(authBody.split("\n", 1)[0]?.toLowerCase()).toContain("auth.md");
      expect(authBody).toContain("There is no registration endpoint");
      expect(authBody).toContain("not an OAuth authorization server");
    })
  )
);

it.effect("keeps Web Bot Auth off unless a bound private key enables it", () =>
  withHandler((handler) =>
    Effect.gen(function* testWebBotAuthFlag() {
      const disabled = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request(
            "http://localhost/.well-known/http-message-signatures-directory"
          )
        )
      );
      expect(disabled.status).toBe(404);
    })
  ).pipe(
    Effect.andThen(
      Effect.gen(function* testEnabledWebBotAuth() {
        const privateJwk = yield* makeTestPrivateJwk;
        return yield* Effect.acquireUseRelease(
          Effect.sync(() =>
            HttpRouter.toWebHandler(
              makeRoutes({
                webBotAuth: { enabled: true, privateJwk },
              }).pipe(Layer.provide(TestSandbox)),
              { disableLogger: true }
            )
          ),
          ({ handler }) => {
            const webHandler: WebHandler = handler;
            return Effect.gen(function* testPublishedKey() {
              const response = yield* Effect.promise(
                webHandler.bind(
                  undefined,
                  new Request(
                    "http://localhost/.well-known/http-message-signatures-directory"
                  )
                )
              );
              const directory = yield* Schema.decodeUnknownEffect(
                WebBotKeyDirectory
              )(yield* readJson(response));
              const [key] = directory.keys;

              expect(response.status).toBe(200);
              expect(key).toMatchObject({
                alg: "EdDSA",
                crv: "Ed25519",
                kid: "ratstack-webbot-1",
                kty: "OKP",
                use: "sig",
              });
              expect(key?.x.length).toBeGreaterThan(10);
              expect(JSON.stringify(directory)).not.toContain('"d"');
            });
          },
          ({ dispose }) => Effect.promise(dispose)
        );
      })
    )
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

it.effect("returns 429 after API_PER_IP denies a client IP", () => {
  const apiPerIp = new FakeRateLimitBinding([true, false]);
  const bindings = fakeRateLimitBindings({ API_PER_IP: apiPerIp });

  return withHandler(
    (handler) =>
      Effect.gen(function* testApiPerIpLimit() {
        // Fetch owns this Promise-returning test boundary.
        // oxlint-disable-next-line typescript/promise-function-async
        const request = () =>
          handler(
            new Request("http://localhost/api/search", {
              body: JSON.stringify({ limit: 1, query: "capability" }),
              headers: {
                "cf-connecting-ip": "192.0.2.10",
                "content-type": "application/json",
              },
              method: "POST",
            })
          );
        const allowed = yield* Effect.promise(request);
        const denied = yield* Effect.promise(request);

        expect(allowed.status).toBe(200);
        expect(denied.status).toBe(429);
        expect(denied.headers.get("retry-after")).toBe("60");
        expect(yield* Effect.promise(denied.text.bind(denied))).toContain(
          "API_PER_IP rate limit exceeded; retry after 60 seconds"
        );
        expect(apiPerIp.keys).toEqual(["192.0.2.10", "192.0.2.10"]);
      }),
    bindings
  );
});

it.effect("returns 429 before a second execute worker is created", () => {
  const executePerIp = new FakeRateLimitBinding([true, false]);
  const executeGlobal = new FakeRateLimitBinding();
  const bindings = fakeRateLimitBindings({
    EXECUTE_GLOBAL: executeGlobal,
    EXECUTE_PER_IP: executePerIp,
  });

  return withHandler(
    (handler) =>
      Effect.gen(function* testExecutePerIpLimit() {
        // Fetch owns this Promise-returning test boundary.
        // oxlint-disable-next-line typescript/promise-function-async
        const request = () =>
          handler(
            new Request("http://localhost/api/execute", {
              body: JSON.stringify({
                code: [
                  "const found = await tools.search({ query: 'capability', limit: 1 });",
                  "return await tools.read({ id: found.matches[0].id });",
                ].join("\n"),
              }),
              headers: {
                "cf-connecting-ip": "192.0.2.20",
                "content-type": "application/json",
              },
              method: "POST",
            })
          );
        const allowed = yield* Effect.promise(request);
        const denied = yield* Effect.promise(request);

        expect(allowed.status).toBe(200);
        expect(denied.status).toBe(429);
        expect(yield* Effect.promise(denied.text.bind(denied))).toContain(
          "EXECUTE_PER_IP rate limit exceeded; retry after 60 seconds"
        );
        expect(executePerIp.keys).toEqual(["192.0.2.20", "192.0.2.20"]);
        expect(executeGlobal.keys).toEqual(["global"]);
      }),
    bindings
  );
});

it.effect("returns an MCP tool error when EXECUTE_GLOBAL denies", () => {
  const executeGlobal = new FakeRateLimitBinding([true, false]);
  const bindings = fakeRateLimitBindings({ EXECUTE_GLOBAL: executeGlobal });

  return withHandler(
    (handler) =>
      Effect.gen(function* testExecuteGlobalLimit() {
        const code = [
          "const found = await tools.search({ query: 'capability', limit: 1 });",
          "return await tools.read({ id: found.matches[0].id });",
        ].join("\n");
        const allowed = yield* postMcp(
          handler,
          "allowed-execute",
          "tools/call",
          {
            arguments: { code },
            name: "execute",
          },
          "execute"
        );
        const denied = yield* postMcp(
          handler,
          "denied-execute",
          "tools/call",
          {
            arguments: { code },
            name: "execute",
          },
          "execute"
        );
        const allowedResult = yield* Schema.decodeUnknownEffect(
          ToolCallResponse
        )(yield* readJson(allowed));
        const error = yield* Schema.decodeUnknownEffect(ToolErrorResponse)(
          yield* readJson(denied)
        );

        expect(allowed.status).toBe(200);
        expect(allowedResult.result.isError).not.toBe(true);
        expect(denied.status).toBe(200);
        expect(denied.headers.get("retry-after")).toBe("60");
        expect(error.result.isError).toBe(true);
        expect(error.result.content[0]?.text).toContain(
          "EXECUTE_GLOBAL rate limit exceeded; retry after 60 seconds"
        );
        expect(executeGlobal.keys).toEqual(["global", "global"]);
      }),
    bindings
  );
});

it.effect("explains the required MCP version in plain text", () =>
  withHandler((handler) =>
    Effect.gen(function* testMcpVersionHelp() {
      const getResponse = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/mcp"))
      );
      const legacyResponse = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/mcp", {
            body: JSON.stringify({
              id: "legacy",
              jsonrpc: "2.0",
              method: "initialize",
              params: {},
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        )
      );
      const expected = mcpVersionText("https://ratstack.sh");

      expect(getResponse.status).toBe(200);
      expect(getResponse.headers.get("content-type")).toContain("text/plain");
      expect(yield* Effect.promise(getResponse.text.bind(getResponse))).toBe(
        expected
      );
      expect(legacyResponse.status).toBe(400);
      expect(legacyResponse.headers.get("content-type")).toContain(
        "text/plain"
      );
      expect(
        yield* Effect.promise(legacyResponse.text.bind(legacyResponse))
      ).toBe(expected);
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
        const { tools } = (yield* Schema.decodeUnknownEffect(NamedListResponse)(
          yield* readJson(toolsList)
        )).result;
        const toolNames = tools?.map((tool) => tool.name);
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
        const executeDescription = tools?.find(
          (tool) => tool.name === "execute"
        )?.description;
        expect(executeDescription).toContain("`code` argument");
        expect(executeDescription).toContain(
          'const found = await tools.search({ query: "capability", limit: 1 });\nreturn await tools.read({ id: found.matches[0].id });'
        );
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
