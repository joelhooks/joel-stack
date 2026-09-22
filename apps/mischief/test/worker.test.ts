import { expect, it } from "@effect/vitest";
import { ExecuteResult } from "@rat-stack/capability/code-mode";
import { Effect, Layer, Schema } from "effect";
import * as McpSchema from "effect/unstable/ai/McpSchema";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { makeRoutes } from "../src/app.js";
import type { StaticResponseCache } from "../src/app.js";
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

interface FakeStaticResponseCache extends StaticResponseCache {
  readonly matchKeys: string[];
  readonly putKeys: string[];
}

const makeFakeStaticResponseCache = (): FakeStaticResponseCache => {
  const matchKeys: string[] = [];
  const putKeys: string[] = [];
  const responses = new Map<string, Response>();
  return {
    // This fake deliberately matches Cloudflare's Promise-returning Cache API.
    // oxlint-disable-next-line typescript/promise-function-async
    match(request) {
      const key = request.url;
      matchKeys.push(key);
      return Promise.resolve(responses.get(key)?.clone());
    },
    matchKeys,
    // This fake deliberately matches Cloudflare's Promise-returning Cache API.
    // oxlint-disable-next-line typescript/promise-function-async
    put(request, response) {
      const key = request.url;
      putKeys.push(key);
      responses.set(key, response.clone());
      return Promise.resolve();
    },
    putKeys,
  };
};

const htmlHomeRequest = () =>
  new Request("http://localhost/", {
    headers: { accept: "text/html" },
  });

const expectedSecurityHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;
const expectedContentSecurityPolicy =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src https://static.cloudflareinsights.com; connect-src https://cloudflareinsights.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const expectSecurityHeaders = (response: Response, html: boolean) => {
  for (const [name, value] of Object.entries(expectedSecurityHeaders)) {
    expect(response.headers.get(name), name).toBe(value);
  }
  expect(response.headers.get("content-security-policy")).toBe(
    html ? expectedContentSecurityPolicy : null
  );
};

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
  rateLimits: RateLimitBindings = fakeRateLimitBindings(),
  staticCache?: StaticResponseCache
) =>
  Effect.acquireUseRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        makeRoutes({
          rateLimits: makeRateLimits(rateLimits),
          ...(staticCache === undefined ? {} : { staticCache }),
        }).pipe(Layer.provide(TestSandbox)),
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
        const skillsHtmlResponse = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/skills", {
              headers: { accept: "text/html" },
            })
          )
        );
        const skillHtmlResponse = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/skills/learn-rat-stack", {
              headers: { accept: "text/html" },
            })
          )
        );
        const resource = lawResources.find(
          (candidate) =>
            candidate.routePath === "/resources/effect-4-reference-projects.svx"
        );
        if (resource === undefined) {
          throw new Error("Missing Effect 4 reference resource");
        }
        const resourceMarkdownResponse = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request(`http://localhost${resource.routePath}`)
          )
        );
        const resourceHtmlResponse = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request(`http://localhost${resource.routePath}`, {
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
        const skillsHtml = yield* Effect.promise(
          skillsHtmlResponse.text.bind(skillsHtmlResponse)
        );
        const skillHtml = yield* Effect.promise(
          skillHtmlResponse.text.bind(skillHtmlResponse)
        );
        const resourceMarkdown = yield* Effect.promise(
          resourceMarkdownResponse.text.bind(resourceMarkdownResponse)
        );
        const resourceHtml = yield* Effect.promise(
          resourceHtmlResponse.text.bind(resourceHtmlResponse)
        );
        const agentsHtmlResponse = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/AGENTS.md", {
              headers: { accept: "text/html" },
            })
          )
        );
        const agentsHtml = yield* Effect.promise(
          agentsHtmlResponse.text.bind(agentsHtmlResponse)
        );
        const logResponse = yield* Effect.promise(
          handler.bind(undefined, new Request("http://localhost/log.md"))
        );
        const logMarkdown = yield* Effect.promise(
          logResponse.text.bind(logResponse)
        );

        expect(markdownResponse.status).toBe(200);
        expect(markdownResponse.headers.get("content-type")).toContain(
          "text/markdown"
        );
        expect(markdownResponse.headers.get("link")).toBe(linkHeader);
        expect(markdown).toBe(markdownDocument("https://ratstack.sh"));
        expect(markdown).toContain("an app and its cloud as one typed program");
        expect(markdown).toContain("## Four ideas");
        expect(markdown).toContain("every bin: labeled · push in · pull out");
        expect(markdown).toContain("│  defineCapability");
        expect(markdown).toContain("What to notice:");
        expect(markdown).toContain("npx skills add joelhooks/rat-stack");
        expect(markdown).toContain("## Source files");
        expect(markdown).toContain("[AGENTS.md](/AGENTS.md)");
        expect(markdown).toContain("[VISION.md](/VISION.md)");
        expect(markdown).toContain("## Connect an agent");
        expect(htmlResponse.headers.get("content-type")).toContain("text/html");
        expect(html).toContain(
          "<title>Rat Stack: an app and its cloud as one typed program</title>"
        );
        expect(html).toContain('<h1 id="rat-stack">🐀 Rat Stack</h1>');
        expect(html.match(/<h1\b/gu)).toHaveLength(1);
        expect(html).not.toContain("<strong>🐀 Rat Stack</strong>");
        expect(skillHtml).toContain("<strong>🐀 Rat Stack</strong>");
        expect(skillHtml.match(/<h1\b/gu)).toHaveLength(1);
        // Diagrams stay plain; code gets Shiki with the Catppuccin Latte
        // theme, inline styles only, no runtime CSS classes to resolve.
        expect(html).toContain("<pre><code>");
        expect(skillHtml).toContain('<pre class="shiki catppuccin-latte"');
        expect(skillHtml).not.toContain('<link rel="stylesheet"');
        expect(html).toContain("│  defineCapability");
        expect(html).not.toContain("<svg");
        expect(html).not.toContain("prefers-color-scheme");
        // Light only: no page background. Code boxes carry the Catppuccin
        // Latte box colour inline, which is allowed.
        expect(html).not.toMatch(/(?:html|body)\s*\{[^}]*background/u);
        expect(html).toContain('href="/favicon.svg"');
        expect(html).toMatch(/<style(?: id="[^"]+")?>/u);
        expect(html).toContain("max-width:80ch");
        expect(html).toContain("ui-monospace");
        expect(html).toMatch(/pre \{[^}]*overflow-x:auto;[^}]*\}/u);
        expect(html).toMatch(
          /table \{[^}]*display:block;[^}]*overflow-x:auto;[^}]*\}/u
        );
        expect(html).not.toContain('rel="stylesheet"');
        expect(html).not.toContain("<img");
        expect(html).toMatch(
          /<meta property="og:image" content="https:\/\/ratstack\.sh\/og\/[\w./-]+\.png\?v=[0-9a-f]+"/u
        );
        expect(html).toContain(
          '<meta property="og:site_name" content="ratstack.sh"'
        );
        expect(html).toContain(
          '<meta name="twitter:card" content="summary_large_image"'
        );
        expect(html).not.toContain("<script");
        expect(skillsHtmlResponse.headers.get("content-type")).toContain(
          "text/html"
        );
        expect(skillsHtml).toContain('<h1 id="learn-the-stack">');
        expect(skillsHtml).toContain(
          "working app to teach the pieces inside it"
        );
        expect(skillHtmlResponse.headers.get("content-type")).toContain(
          "text/html"
        );
        expect(skillHtml).toContain('<nav aria-label="Breadcrumb"');
        expect(skillHtml).toContain('<h1 id="learn-the-stack">');
        expect(skillHtml).toContain("Trace one action");
        expect(skillHtml).not.toContain("description:");
        // llmwiki cross-references: real repo paths link to GitHub, served
        // pages and skills link inside the site, placeholders stay plain.
        expect(skillHtml).toContain(
          '<a href="https://github.com/joelhooks/rat-stack/blob/main/packages/core/src/inspect-file.ts"><code>packages/core/src/inspect-file.ts</code></a>'
        );
        expect(skillHtml).toContain(
          '<a href="https://github.com/joelhooks/rat-stack/tree/main/packages/capability/src"><code>packages/capability/src</code></a>'
        );
        expect(skillHtml).toContain(
          '<a href="/AGENTS.md"><code>AGENTS.md</code></a>'
        );
        expect(skillHtml).toContain(
          '<a href="/skills/add-a-capability"><code>add-a-capability</code></a>'
        );
        expect(skillHtml).toContain(
          "<code>node_modules/effect/AGENTS.md</code>"
        );
        expect(skillHtml).not.toContain(
          'href="https://github.com/joelhooks/rat-stack/blob/main/node_modules'
        );
        // Stack pieces are entities: first plain mention links out, once per
        // page, never inside headings or code.
        expect(skillHtml).toContain(
          '<a href="https://effect.website">Effect</a>'
        );
        expect(skillHtml).toContain(
          '<a href="https://stately.ai/docs/xstate">XState</a>'
        );
        expect(skillHtml).toContain(
          '<a href="https://github.com/microsoft/typescript-go">TypeScript 7</a>'
        );
        expect(skillHtml).toContain(
          '<a href="https://alchemy.run">Alchemy</a>'
        );
        expect(skillHtml).toContain(
          '<a href="https://lefthook.dev">lefthook</a>'
        );
        expect(skillHtml.split('href="https://effect.website"')).toHaveLength(
          2
        );
        expect(skillHtml).not.toMatch(
          /<h[1-6][^>]*>[^<]*<a href="https:\/\/(?:effect\.website|stately\.ai)/u
        );
        expect(skillHtml).not.toMatch(
          /<code>[^<]*<a href="https:\/\/effect\.website"/u
        );
        expect(agentsHtml).toContain("Linked from: ");
        expect(agentsHtml).toContain(
          '<a href="https://github.com/joelhooks/rat-stack/blob/main/AGENTS.md">Source on GitHub</a>'
        );
        expect(agentsHtml).toMatch(
          /Last changed \d{4}-\d{2}-\d{2} in <a href="https:\/\/github\.com\/joelhooks\/rat-stack\/commit\/[0-9a-f]{40}">[0-9a-f]{7,}<\/a>/u
        );
        expect(agentsHtml).toContain(
          '<a href="/skills/learn-rat-stack">learn-rat-stack</a>'
        );
        expect(agentsHtml).not.toContain(
          '<a href="/AGENTS.md"><code>AGENTS.md</code></a>'
        );
        expect(logResponse.status).toBe(200);
        expect(logResponse.headers.get("content-type")).toContain(
          "text/markdown"
        );
        expect(logMarkdown.startsWith("# Change log\n")).toBe(true);
        expect(resourceMarkdownResponse.headers.get("content-type")).toContain(
          "text/markdown"
        );
        expect(resourceMarkdown).toBe(resource.text);
        expect(resourceHtmlResponse.headers.get("content-type")).toContain(
          "text/html"
        );
        expect(resourceHtml).toContain(
          "<title>Effect 4 examples | rat-stack</title>"
        );
        expect(resourceHtml).toContain(
          '<h1 id="effect-4-reference-projects-studied-2026-09-18">'
        );
        expect(resourceHtml).toContain("<table>");
        expect(resourceHtml).not.toContain("<script");

        const favicon = yield* Effect.promise(
          handler.bind(undefined, new Request("http://localhost/favicon.svg"))
        );
        const faviconBody = yield* Effect.promise(favicon.text.bind(favicon));
        expect(favicon.status).toBe(200);
        expect(favicon.headers.get("content-type")).toContain("image/svg+xml");
        expect(faviconBody).toMatch(/^<svg /u);
        expect(faviconBody).not.toContain("<!--");

        // Every page has a preview image, served from the versioned edge
        // cache, 1200x630 PNG (magic bytes, then IHDR width and height).
        for (const route of [
          "/",
          "/skills",
          "/skills/learn-rat-stack",
          "/AGENTS.md",
          "/log.md",
        ]) {
          const imagePath = `/og${route === "/" ? "/home" : route}.png`;
          const image = yield* Effect.promise(
            handler.bind(undefined, new Request(`http://localhost${imagePath}`))
          );
          const bytes = new Uint8Array(
            yield* Effect.promise(image.arrayBuffer.bind(image))
          );
          expect(image.status).toBe(200);
          expect(image.headers.get("content-type")).toBe("image/png");
          expect(bytes.subarray(0, 8)).toEqual(
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
          );
          const view = new DataView(bytes.buffer);
          expect(view.getUint32(16)).toBe(1200);
          expect(view.getUint32(20)).toBe(630);
        }
      })
    )
);

it.effect("sets security headers on every response", () =>
  withHandler((handler) =>
    Effect.gen(function* testSecurityHeaders() {
      const htmlResponse = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/", {
            headers: { accept: "text/html" },
          })
        )
      );
      const markdownResponse = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/"))
      );
      const openapiResponse = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/openapi.json"))
      );
      const notFoundResponse = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/not-found"))
      );

      expectSecurityHeaders(htmlResponse, true);
      expectSecurityHeaders(markdownResponse, false);
      expectSecurityHeaders(openapiResponse, false);
      expectSecurityHeaders(notFoundResponse, false);
      expect(notFoundResponse.status).toBe(404);

      // The fail-closed rate limit is part of the public contract.
      const openapi: unknown = yield* Effect.promise(
        openapiResponse.json.bind(openapiResponse)
      );
      const executeResponses = (yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          paths: Schema.Record(
            Schema.String,
            Schema.Struct({
              post: Schema.Struct({
                responses: Schema.Record(Schema.String, Schema.Unknown),
              }),
            })
          ),
        })
      )(openapi)).paths["/api/execute"]?.post.responses;
      expect(Object.keys(executeResponses ?? {})).toContain("429");

      // Images are meant to be embedded on other origins (preview cards,
      // validators, chat clients), so they relax the resource policy only.
      const imageResponse = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/og/home.png"))
      );
      expect(imageResponse.headers.get("cross-origin-resource-policy")).toBe(
        "cross-origin"
      );
      expect(imageResponse.headers.get("x-content-type-options")).toBe(
        "nosniff"
      );
      expect(htmlResponse.headers.get("cross-origin-resource-policy")).toBe(
        "same-origin"
      );

      // HEAD maps onto the GET routes; a wildcard 404 used to swallow it.
      const headHome = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/", { method: "HEAD" })
        )
      );
      const headImage = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/og/home.png", { method: "HEAD" })
        )
      );
      const headMissing = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/nope", { method: "HEAD" })
        )
      );
      expect(headHome.status).toBe(200);
      expect(headHome.headers.get("content-type")).toContain("text/markdown");
      expect(headImage.status).toBe(200);
      expect(headImage.headers.get("content-type")).toBe("image/png");
      expect(headMissing.status).toBe(404);
    })
  )
);

it.effect(
  "negotiates HTML for explicit preview crawlers without changing default Markdown",
  () =>
    withHandler((handler) =>
      Effect.gen(function* testPreviewCrawlerNegotiation() {
        const crawler = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/", {
              headers: { "user-agent": "Twitterbot/1.0" },
            })
          )
        );
        const plain = yield* Effect.promise(
          handler.bind(undefined, new Request("http://localhost/"))
        );
        const browser = yield* Effect.promise(
          handler.bind(
            undefined,
            new Request("http://localhost/", {
              headers: { accept: "text/html" },
            })
          )
        );

        // Open Graph validators and unfurl services borrow a browser user
        // agent and send Accept: */*. Named AI crawlers do the same but are
        // agents, so they keep Markdown. Explicit text/markdown always wins.
        const request = (headers: Record<string, string>) =>
          Effect.promise(
            handler.bind(
              undefined,
              new Request("http://localhost/", { headers })
            )
          );
        const validator = yield* request({
          accept: "*/*",
          "user-agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
        });
        const gptBot = yield* request({
          accept: "*/*",
          "user-agent":
            "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot",
        });
        const claudeBot = yield* request({
          "user-agent":
            "Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
        });
        const curl = yield* request({
          accept: "*/*",
          "user-agent": "curl/8.7.1",
        });
        const browserWantsMarkdown = yield* request({
          accept: "text/markdown",
          "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Firefox/130.0",
        });

        expect(crawler.headers.get("content-type")).toContain("text/html");
        expect(plain.headers.get("content-type")).toContain("text/markdown");
        expect(browser.headers.get("content-type")).toContain("text/html");
        expect(validator.headers.get("content-type")).toContain("text/html");
        expect(gptBot.headers.get("content-type")).toContain("text/markdown");
        expect(claudeBot.headers.get("content-type")).toContain(
          "text/markdown"
        );
        expect(curl.headers.get("content-type")).toContain("text/markdown");
        expect(browserWantsMarkdown.headers.get("content-type")).toContain(
          "text/markdown"
        );
      })
    )
);

it.effect(
  "caches each static representation and revalidates with its ETag",
  () => {
    const cache = makeFakeStaticResponseCache();
    return withHandler(
      (handler) =>
        Effect.gen(function* testStaticCache() {
          const firstHtml = yield* Effect.promise(
            handler.bind(undefined, htmlHomeRequest())
          );
          const firstHtmlBody = yield* Effect.promise(
            firstHtml.text.bind(firstHtml)
          );
          const secondHtml = yield* Effect.promise(
            handler.bind(undefined, htmlHomeRequest())
          );
          const secondHtmlBody = yield* Effect.promise(
            secondHtml.text.bind(secondHtml)
          );
          const markdownResponse = yield* Effect.promise(
            handler.bind(undefined, new Request("http://localhost/"))
          );
          const etag = firstHtml.headers.get("etag");
          const revalidated = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request("http://localhost/", {
                headers: {
                  accept: "text/html",
                  "if-none-match": etag ?? "missing",
                },
              })
            )
          );
          const mcp = yield* Effect.promise(
            handler.bind(undefined, new Request("http://localhost/mcp"))
          );
          const favicon = yield* Effect.promise(
            handler.bind(undefined, new Request("http://localhost/favicon.svg"))
          );
          const crawlerHtml = yield* Effect.promise(
            handler.bind(
              undefined,
              new Request("http://localhost/", {
                headers: { "user-agent": "Twitterbot/1.0" },
              })
            )
          );

          expect(firstHtml.headers.get("x-ratstack-cache")).toBe("MISS");
          expect(secondHtml.headers.get("x-ratstack-cache")).toBe("HIT");
          expectSecurityHeaders(secondHtml, true);
          expect(secondHtmlBody).toBe(firstHtmlBody);
          expect(firstHtml.headers.get("cache-control")).toContain(
            "s-maxage=31536000"
          );
          expect(firstHtml.headers.get("vary")).toBe("Accept");
          expect(etag).toMatch(/^W\//u);
          expect(markdownResponse.headers.get("x-ratstack-cache")).toBe("MISS");
          expect(markdownResponse.headers.get("etag")).not.toBe(etag);
          expect(revalidated.status).toBe(304);
          expect(revalidated.headers.get("x-ratstack-cache")).toBe(
            "REVALIDATED"
          );
          expectSecurityHeaders(revalidated, false);
          expect(mcp.headers.get("x-ratstack-cache")).toBeNull();
          expect(favicon.headers.get("x-ratstack-cache")).toBe("MISS");
          expect(favicon.headers.get("cache-control")).toContain(
            "s-maxage=31536000"
          );
          expect(crawlerHtml.headers.get("x-ratstack-cache")).toBe("HIT");
          expect(crawlerHtml.headers.get("content-type")).toContain(
            "text/html"
          );
          expect(cache.matchKeys).toHaveLength(5);
          expect(cache.putKeys).toHaveLength(3);
          expect(cache.matchKeys[0]).toContain("__ratstack_content=");
          expect(cache.matchKeys[0]).toContain(
            "__ratstack_representation=html"
          );
          expect(cache.matchKeys[2]).toContain(
            "__ratstack_representation=default"
          );
          expect(cache.matchKeys[4]).toContain(
            "__ratstack_representation=html"
          );
        }),
      fakeRateLimitBindings(),
      cache
    );
  }
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
      const mcpCard = yield* Effect.promise(
        handler.bind(
          undefined,
          new Request("http://localhost/.well-known/mcp.json")
        )
      );
      const openapi = yield* Effect.promise(
        handler.bind(undefined, new Request("http://localhost/openapi.json"))
      );

      const llmsBody = yield* Effect.promise(llms.text.bind(llms));
      expect(llmsBody).toBe(llmsText("https://ratstack.sh"));
      expect(llmsBody).toContain("## Connect with MCP");
      expect(llmsBody).toContain("Use protocol 2026-07-28");
      expect(llmsBody).toContain("no `initialize` handshake");
      expect(llmsBody).toContain("Mcp-Method: tools/list");
      expect(llmsBody).toContain("params._meta");
      expect(llmsBody).toContain("## Run code");
      expect(llmsBody).toContain('"result":2');
      expect(llmsBody).toContain(
        "6 calls per IP and 300 total calls per 60 seconds"
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
      expect(JSON.stringify(yield* readJson(mcpCard))).toContain(
        "Mcp-Method: tools/list"
      );

      const openapiBody = yield* readJson(openapi);
      const OpenApiDocument = Schema.Struct({
        info: Schema.Struct({ title: Schema.String }),
        paths: Schema.Record(Schema.String, Schema.Unknown),
      });
      const document =
        yield* Schema.decodeUnknownEffect(OpenApiDocument)(openapiBody);
      expect(document.info.title).toBe("ratstack.sh");
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
      expect(authBody).toContain("There is no signup or registration route");
      expect(authBody).toContain("does not use OAuth");
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
        expectSecurityHeaders(denied, false);
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

      expect(expected).toContain("no initialize handshake");
      expect(expected).toContain("MCP-Protocol-Version header is required");
      expect(expected).toContain("https://ratstack.sh/llms.txt");
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
          "The program is the body of an async function"
        );
        expect(executeDescription).toContain(
          "Imports, exports, and `fetch` are unavailable"
        );
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
