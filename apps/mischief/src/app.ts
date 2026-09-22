import { toHttpApi } from "@rat-stack/capability/http-api";
import { toToolkit } from "@rat-stack/capability/toolkit";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer, Schema } from "effect";
import * as McpProtocol from "effect/unstable/ai/McpProtocol";
import * as McpServer from "effect/unstable/ai/McpServer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";

import { a2aError, handleA2aRequest } from "./a2a.js";
import { capabilities } from "./capabilities/index.js";
import {
  a2aAgentCard,
  agentSkillPath,
  agentSkillsIndex,
  apiCatalog,
  ardManifest,
  authMarkdown,
  homeHtml,
  lawResources,
  linkHeader,
  llmsFullText,
  llmsText,
  markdownDocument,
  mcpServerCard,
  mcpVersionText,
  publicPaths,
  robotsText,
  sitemapXml,
  skillIndex,
  skillIndexHtml,
  skills,
  staticContentVersion,
} from "./content.js";
import { renderHomePage, renderSkillPage, renderSkillsPage } from "./html.js";
import type { RateLimitName, RateLimits } from "./rate-limits.js";
import { decodeEd25519PrivateJwk, publicKeyDirectory } from "./web-bot-auth.js";

const markdown = (body: string) =>
  HttpServerResponse.text(body, {
    contentType: "text/markdown; charset=utf-8",
  });

const html = (body: string) =>
  HttpServerResponse.text(body, {
    contentType: "text/html; charset=utf-8",
  });

const json = (body: unknown, contentType = "application/json") =>
  HttpServerResponse.jsonUnsafe(body, {
    contentType,
    headers: { "access-control-allow-origin": "*" },
  });

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, "https://ratstack.sh").origin;

const acceptsHtml = (request: HttpServerRequest.HttpServerRequest) =>
  request.headers.accept?.split(",").some((entry) => {
    const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");
    const quality = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith("q="));
    return mediaType === "text/html" && quality !== "q=0";
  }) === true;

export interface StaticResponseCache {
  readonly match: (request: Request) => Promise<Response | undefined>;
  readonly put: (request: Request, response: Response) => Promise<void>;
}

const staticPaths = new Set<string>(publicPaths);
const negotiatedHtmlPaths = new Set<string>([
  "/",
  "/skills",
  ...skills.map((skill) => skill.routePath),
]);
const staticCacheControl =
  "public, max-age=60, s-maxage=31536000, stale-while-revalidate=86400";

const staticRepresentation = (
  request: HttpServerRequest.HttpServerRequest,
  path: string
) =>
  negotiatedHtmlPaths.has(path) && acceptsHtml(request) ? "html" : "default";

const staticEtag = (path: string, representation: string) =>
  `W/"${staticContentVersion}:${representation}:${encodeURIComponent(path)}"`;

const matchesEtag = (requestValue: string | undefined, etag: string) =>
  requestValue
    ?.split(",")
    .map((value) => value.trim())
    .some((value) => value === etag || value === "*") === true;

const staticHeaders = (
  path: string,
  etag: string,
  cacheStatus: "HIT" | "MISS" | "REVALIDATED"
) => ({
  "cache-control": staticCacheControl,
  etag,
  ...(negotiatedHtmlPaths.has(path) ? { vary: "Accept" } : {}),
  "x-ratstack-cache": cacheStatus,
});

const staticCacheKey = (
  request: HttpServerRequest.HttpServerRequest,
  representation: string
) => {
  const url = new URL(request.url, "https://ratstack.sh");
  url.hash = "";
  url.search = "";
  url.searchParams.set("__ratstack_content", staticContentVersion);
  url.searchParams.set("__ratstack_representation", representation);
  return new Request(url, { method: "GET" });
};

const staticCaching = (cache: StaticResponseCache) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* cacheStaticResponse() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "https://ratstack.sh").pathname;
        if (request.method !== "GET" || !staticPaths.has(path)) {
          return yield* httpEffect;
        }

        const representation = staticRepresentation(request, path);
        const etag = staticEtag(path, representation);
        if (matchesEtag(request.headers["if-none-match"], etag)) {
          return HttpServerResponse.empty({
            headers: staticHeaders(path, etag, "REVALIDATED"),
            status: 304,
          });
        }

        const key = staticCacheKey(request, representation);
        const cached = yield* Effect.tryPromise(
          // Cloudflare's Cache API owns this Promise-returning boundary.
          // oxlint-disable-next-line typescript/promise-function-async
          () => cache.match(key)
        ).pipe(Effect.orElseSucceed(() => null));
        if (cached !== null && cached !== undefined) {
          const headers = new Headers(cached.headers);
          headers.set("x-ratstack-cache", "HIT");
          return HttpServerResponse.fromWeb(
            new Response(cached.body, {
              headers,
              status: cached.status,
              statusText: cached.statusText,
            })
          );
        }

        const response = (yield* httpEffect).pipe(
          HttpServerResponse.setHeaders(staticHeaders(path, etag, "MISS"))
        );
        if (response.status === 200) {
          const webResponse = HttpServerResponse.toWeb(response);
          yield* Effect.tryPromise(
            // Cloudflare's Cache API owns this Promise-returning boundary.
            // oxlint-disable-next-line typescript/promise-function-async
            () => cache.put(key, webResponse)
          ).pipe(Effect.orElseSucceed(() => null));
        }
        return response;
      }),
    { global: true }
  );

export const toolkitProjection = toToolkit(capabilities);
export const apiProjection = toHttpApi("Mischief", capabilities, {
  prefix: "/api",
});

const apiRoutes = HttpApiBuilder.layer(apiProjection.api, {
  openapiPath: "/openapi.json",
}).pipe(
  Layer.provide(apiProjection.layer),
  Layer.provide(AlchemyHttp.Platform)
);

const mcpTransport = McpServer.layerHttp({
  allowedOrigins: ["https://ratstack.sh", "http://localhost:1337"],
  description: "Search, read, and execute against the rat-stack source corpus",
  instructions:
    "Use search to find a file. Use read to get its exact text. Use execute only when one short program can replace several tool calls.",
  name: "sh.ratstack/rat-stack",
  path: "/mcp",
  protocols: [McpProtocol.v2026_07_28],
  version: "0.2.0",
  websiteUrl: "https://ratstack.sh/",
});

const mcp = Layer.mergeAll(
  McpServer.toolkit(toolkitProjection.toolkit).pipe(
    Layer.provide(toolkitProjection.layer)
  ),
  ...lawResources.map((resource) =>
    McpServer.resource({
      content: Effect.succeed(resource.text),
      description: resource.description,
      mimeType: "text/markdown",
      name: resource.name,
      uri: resource.id,
    })
  ),
  ...skills.map((skill) =>
    McpServer.prompt({
      content: () => Effect.succeed(skill.text),
      description: skill.description,
      name: skill.name,
    })
  )
).pipe(Layer.provide(mcpTransport));

const contentRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/", (request) => {
    const origin = originOf(request);
    return Effect.succeed(
      acceptsHtml(request)
        ? html(renderHomePage(origin, homeHtml))
        : markdown(markdownDocument(origin))
    );
  }),
  HttpRouter.add("GET", "/llms.txt", (request) =>
    Effect.succeed(markdown(llmsText(originOf(request))))
  ),
  HttpRouter.add("GET", "/llms-full.txt", (request) =>
    Effect.succeed(markdown(llmsFullText(originOf(request))))
  ),
  HttpRouter.add("GET", "/auth.md", markdown(authMarkdown)),
  HttpRouter.add("GET", "/skills", (request) =>
    Effect.succeed(
      acceptsHtml(request)
        ? html(renderSkillsPage(originOf(request), skillIndexHtml))
        : markdown(skillIndex())
    )
  ),
  HttpRouter.add(
    "GET",
    "/robots.txt",
    HttpServerResponse.text(robotsText, {
      contentType: "text/plain; charset=utf-8",
    })
  ),
  HttpRouter.add("GET", "/sitemap.xml", (request) =>
    Effect.succeed(
      HttpServerResponse.text(sitemapXml(originOf(request)), {
        contentType: "application/xml; charset=utf-8",
      })
    )
  ),
  HttpRouter.add(
    "GET",
    "/.well-known/agent-skills/index.json",
    json(agentSkillsIndex())
  ),
  HttpRouter.add("GET", "/.well-known/ai-catalog.json", (request) =>
    Effect.succeed(json(ardManifest(originOf(request))))
  ),
  ...(["/.well-known/agent-card.json", "/.well-known/agent.json"] as const).map(
    (path) =>
      HttpRouter.add("GET", path, (request) =>
        Effect.succeed(
          json(a2aAgentCard(originOf(request)), "application/a2a+json")
        )
      )
  ),
  HttpRouter.add("POST", "/a2a", (request) =>
    request.json.pipe(
      Effect.flatMap(handleA2aRequest),
      Effect.map((response) => json(response, "application/a2a+json")),
      Effect.orElseSucceed(() =>
        json(a2aError(-32_600, "Invalid Request"), "application/a2a+json")
      )
    )
  ),
  HttpRouter.add("GET", "/.well-known/api-catalog", (request) =>
    Effect.succeed(
      json(apiCatalog(originOf(request)), "application/linkset+json")
    )
  ),
  HttpRouter.add("GET", "/.well-known/mcp.json", (request) =>
    Effect.succeed(json(mcpServerCard(originOf(request))))
  ),
  ...lawResources.map((resource) =>
    HttpRouter.add("GET", resource.routePath, markdown(resource.text))
  ),
  ...skills.flatMap((skill) => [
    HttpRouter.add("GET", skill.routePath, (request) =>
      Effect.succeed(
        acceptsHtml(request)
          ? html(renderSkillPage(originOf(request), skill))
          : markdown(skill.text)
      )
    ),
    HttpRouter.add("GET", agentSkillPath(skill.name), markdown(skill.text)),
  ])
);

const JsonRpcEnvelope = Schema.Struct({
  id: Schema.optional(
    Schema.Union([Schema.String, Schema.Finite, Schema.Null])
  ),
  method: Schema.optional(Schema.String),
});

const inspectMcpRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* inspectRequest() {
    const { source } = request;
    const body: unknown =
      source instanceof Request
        ? yield* Effect.tryPromise(
            // The Fetch Request owns this Promise-returning boundary.
            // oxlint-disable-next-line typescript/promise-function-async
            () => source.clone().json()
          )
        : yield* request.json;
    return yield* Schema.decodeUnknownEffect(JsonRpcEnvelope)(body);
  }).pipe(Effect.orElseSucceed(() => null));

const exceededMessage = (name: RateLimitName) =>
  `${name} rate limit exceeded; retry after 60 seconds.`;

const rateLimitResponse = (
  request: HttpServerRequest.HttpServerRequest,
  name: RateLimitName,
  mcpToolCall: boolean
) => {
  const message = exceededMessage(name);
  if (!request.url.startsWith("/mcp")) {
    return Effect.succeed(
      HttpServerResponse.text(message, {
        headers: { "retry-after": "60" },
        status: 429,
      })
    );
  }

  return inspectMcpRequest(request).pipe(
    Effect.map((envelope) =>
      HttpServerResponse.jsonUnsafe(
        mcpToolCall
          ? {
              id: envelope?.id ?? null,
              jsonrpc: "2.0",
              result: {
                content: [{ text: message, type: "text" }],
                isError: true,
              },
            }
          : {
              error: { code: -32_000, message },
              id: envelope?.id ?? null,
              jsonrpc: "2.0",
            },
        { headers: { "retry-after": "60" } }
      )
    )
  );
};

const requestProtection = (rateLimits: RateLimits) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* protectRequest() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const path = new URL(request.url, "https://ratstack.sh").pathname;
        const isMcp = path === "/mcp";
        const isApi = path === "/api" || path.startsWith("/api/");
        const mcpToolCall =
          isMcp && request.headers["mcp-method"] === "tools/call";
        const isExecute =
          path === "/api/execute" ||
          (mcpToolCall && request.headers["mcp-name"] === "execute");

        if (isMcp || isApi) {
          const clientIp = request.headers["cf-connecting-ip"] ?? "unknown";
          const checks: readonly (readonly [RateLimitName, string])[] = [
            ["API_PER_IP", clientIp],
            ...(isExecute
              ? ([
                  ["EXECUTE_PER_IP", clientIp],
                  ["EXECUTE_GLOBAL", "global"],
                ] as const)
              : []),
          ];

          for (const [name, key] of checks) {
            if (!(yield* rateLimits.limit(name, key))) {
              return yield* rateLimitResponse(request, name, mcpToolCall);
            }
          }
        }

        if (isMcp && request.method === "GET") {
          return HttpServerResponse.text(mcpVersionText(originOf(request)), {
            contentType: "text/plain; charset=utf-8",
          });
        }

        if (
          isMcp &&
          request.method === "POST" &&
          request.headers["mcp-protocol-version"] === undefined
        ) {
          const envelope = yield* inspectMcpRequest(request);
          if (envelope?.method === "initialize") {
            return HttpServerResponse.text(mcpVersionText(originOf(request)), {
              contentType: "text/plain; charset=utf-8",
              status: 400,
            });
          }
        }

        return yield* httpEffect;
      }),
    { global: true }
  );

const linkHeaders = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.map(HttpServerResponse.setHeader("Link", linkHeader))
    ),
  { global: true }
);

export interface WebBotAuthOptions {
  readonly enabled: boolean;
  readonly privateJwk?: string;
}

export interface MischiefRouteOptions {
  readonly rateLimits?: RateLimits;
  readonly staticCache?: StaticResponseCache;
  readonly webBotAuth?: WebBotAuthOptions;
}

const webBotAuthResponse = (options: WebBotAuthOptions) => {
  if (!options.enabled) {
    return HttpServerResponse.text("Not found.\n", {
      contentType: "text/plain; charset=utf-8",
      status: 404,
    });
  }
  if (options.privateJwk === undefined) {
    return HttpServerResponse.text("Web Bot Auth key is not configured.\n", {
      contentType: "text/plain; charset=utf-8",
      status: 503,
    });
  }
  return decodeEd25519PrivateJwk(options.privateJwk).pipe(
    Effect.map((key) => json(publicKeyDirectory(key))),
    Effect.orElseSucceed(() =>
      HttpServerResponse.text("Web Bot Auth key is invalid.\n", {
        contentType: "text/plain; charset=utf-8",
        status: 503,
      })
    )
  );
};

const webBotAuthRoutes = (options: WebBotAuthOptions) =>
  HttpRouter.add(
    "GET",
    "/.well-known/http-message-signatures-directory",
    webBotAuthResponse(options)
  );

export const makeRoutes = (options: MischiefRouteOptions = {}) =>
  Layer.mergeAll(
    contentRoutes,
    apiRoutes,
    mcp,
    // Tests without bindings and the default `routes` skip protection.
    options.rateLimits === undefined
      ? Layer.empty
      : requestProtection(options.rateLimits),
    linkHeaders,
    options.staticCache === undefined
      ? Layer.empty
      : staticCaching(options.staticCache),
    webBotAuthRoutes(options.webBotAuth ?? { enabled: false })
  );

export const routes = makeRoutes();
