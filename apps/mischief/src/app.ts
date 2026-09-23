import { toHttpApi } from "@rat-stack/capability/http-api";
import { toToolkit } from "@rat-stack/capability/toolkit";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer, Schema } from "effect";
import * as McpProtocol from "effect/unstable/ai/McpProtocol";
import * as McpServer from "effect/unstable/ai/McpServer";
import * as HttpHeaders from "effect/unstable/http/Headers";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import * as HttpApiBuilder from "effect/unstable/httpapi/HttpApiBuilder";
import * as HttpApiSchema from "effect/unstable/httpapi/HttpApiSchema";

import { a2aError, decodeA2aRequest, handleA2aRequest } from "./a2a.js";
import { capabilities } from "./capabilities/index.js";
import {
  a2aAgentCard,
  agentSkillPath,
  agentSkillsIndex,
  apiCatalog,
  appleTouchIconPngBase64,
  ardManifest,
  authMarkdown,
  faviconIcoBase64,
  homeDocumentHtml,
  lawResources,
  linkHeader,
  llmsFullText,
  llmsText,
  markdownDocument,
  mcpServerCard,
  mcpVersionText,
  ogImagePath,
  ogImages,
  publicPaths,
  ratSvg,
  robotsText,
  sitemapXml,
  skillIndex,
  skillIndexDocumentHtml,
  skills,
  staticContentVersion,
} from "./content.js";
import { renderStaticDocument } from "./html.js";
import { legacySessionNotFound } from "./legacy-mcp/session.js";
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

const json = (body: Schema.Json, contentType = "application/json") =>
  HttpServerResponse.jsonUnsafe(body, {
    contentType,
    headers: { "access-control-allow-origin": "*" },
  });

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, "https://ratstack.sh").origin;

const previewCrawler =
  /(?:Twitterbot|facebookexternalhit|Facebot|Slackbot|Discordbot|LinkedInBot|WhatsApp|TelegramBot|Bluesky|Mastodon|Pinterestbot|redditbot|Applebot)/iu;

const agentCrawler =
  /(?:GPTBot|ChatGPT-User|OAI-SearchBot|ClaudeBot|Claude-User|Claude-SearchBot|anthropic-ai|PerplexityBot|Perplexity-User|Google-Extended|CCBot|Bytespider|Amazonbot|cohere-ai|Meta-ExternalAgent|MistralAI-User|DuckAssistBot|Applebot-Extended)/iu;

const acceptedMediaTypes = (accept: string | undefined) =>
  (accept ?? "")
    .split(",")
    .map((entry) => {
      const [mediaType, ...parameters] = entry.trim().toLowerCase().split(";");

      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith("q="));

      return { mediaType: mediaType ?? "", rejected: quality === "q=0" };
    })
    .filter((entry) => entry.mediaType !== "" && !entry.rejected)
    .map((entry) => entry.mediaType);

const acceptsHtml = (request: HttpServerRequest.HttpServerRequest) => {
  const accepted = acceptedMediaTypes(request.headers.accept);

  if (accepted.includes("text/html")) {
    return true;
  }

  if (accepted.includes("text/markdown")) {
    return false;
  }

  const userAgent = request.headers["user-agent"] ?? "";

  if (previewCrawler.test(userAgent)) {
    return true;
  }

  if (agentCrawler.test(userAgent)) {
    return false;
  }

  return userAgent.startsWith("Mozilla/");
};

export interface StaticResponseCache {
  readonly match: (request: Request) => Promise<Response | undefined>;
  readonly put: (request: Request, response: Response) => Promise<void>;
}

const decodeBase64 = (base64: string) =>
  Uint8Array.from(atob(base64), (character) => character.codePointAt(0) ?? 0);

const ogImageBytes = ogImages.map((image) => ({
  bytes: decodeBase64(image.pngBase64),
  path: ogImagePath(image.routePath),
}));

const faviconIcoBytes = decodeBase64(faviconIcoBase64);

const appleTouchIconBytes = decodeBase64(appleTouchIconPngBase64);

const staticPaths = new Set<string>([
  ...publicPaths,
  "/favicon.svg",
  "/favicon.ico",
  "/apple-touch-icon.png",
  ...ogImageBytes.map((image) => image.path),
]);

const negotiatedHtmlPaths = new Set<string>([
  "/",
  "/skills",
  ...lawResources.map((resource) => resource.routePath),
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
) => {
  const headers = HttpHeaders.fromInput({
    "cache-control": staticCacheControl,
    etag,
    "x-ratstack-cache": cacheStatus,
  });

  return negotiatedHtmlPaths.has(path)
    ? HttpHeaders.set(headers, "vary", "Accept")
    : headers;
};

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
          // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's Cache API owns this Promise-returning boundary.
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
            // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's Cache API owns this Promise-returning boundary.
            () => cache.put(key, webResponse)
          ).pipe(Effect.orElseSucceed(() => null));
        }

        return response;
      }),
    { global: true }
  );

export const toolkitProjection = toToolkit(capabilities);

const RateLimited = Schema.String.annotate({
  description:
    "Rate limit exceeded for this IP or for execute globally. Retry after the number of seconds in Retry-After.",
  httpApiStatus: 429,
  identifier: "RateLimited",
}).pipe(HttpApiSchema.asText({ contentType: "text/plain" }));

export const apiProjection = toHttpApi("ratstack.sh", capabilities, {
  errors: [RateLimited],
  prefix: "/api",
});

const apiRoutes = HttpApiBuilder.layer(apiProjection.api, {
  openapiPath: "/openapi.json",
}).pipe(
  Layer.provide(apiProjection.layer),
  Layer.provide(AlchemyHttp.Platform)
);

export const modernMcpProtocols = [McpProtocol.v2026_07_28] as const;

export const legacyMcpProtocols = [
  McpProtocol.v2025_11_25,
  McpProtocol.v2025_06_18,
  McpProtocol.v2025_03_26,
  McpProtocol.v2024_11_05,
] as const;

const mcpTransport = (
  protocols: typeof modernMcpProtocols | typeof legacyMcpProtocols
) =>
  McpServer.layerHttp({
    allowedOrigins: ["https://ratstack.sh", "http://localhost:1337"],
    description:
      "Search, read, and execute against the rat-stack source corpus",
    instructions:
      "Use search to find a file. Use read to get its exact text. Use execute only when one short program can replace several tool calls.",
    name: "sh.ratstack/rat-stack",
    path: "/mcp",
    protocols,
    version: "0.2.0",
    websiteUrl: "https://ratstack.sh/",
  });

export const mcpLayer = (
  protocols: typeof modernMcpProtocols | typeof legacyMcpProtocols
) =>
  Layer.mergeAll(
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
  ).pipe(Layer.provide(mcpTransport(protocols)));

const mcp = mcpLayer(modernMcpProtocols);

const contentRoutes = Layer.mergeAll(
  HttpRouter.add("GET", "/", (request) => {
    const origin = originOf(request);

    return Effect.succeed(
      acceptsHtml(request)
        ? html(renderStaticDocument(origin, homeDocumentHtml))
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
        ? html(renderStaticDocument(originOf(request), skillIndexDocumentHtml))
        : markdown(skillIndex())
    )
  ),
  HttpRouter.add(
    "GET",
    "/favicon.svg",
    HttpServerResponse.text(ratSvg, {
      contentType: "image/svg+xml; charset=utf-8",
    })
  ),
  HttpRouter.add(
    "GET",
    "/favicon.ico",
    HttpServerResponse.uint8Array(faviconIcoBytes, {
      contentType: "image/x-icon",
    })
  ),
  HttpRouter.add(
    "GET",
    "/apple-touch-icon.png",
    HttpServerResponse.uint8Array(appleTouchIconBytes, {
      contentType: "image/png",
    })
  ),
  ...ogImageBytes.map((image) =>
    HttpRouter.add(
      "GET",
      image.path,
      HttpServerResponse.uint8Array(image.bytes, { contentType: "image/png" })
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
      Effect.flatMap(decodeA2aRequest),
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
    HttpRouter.add("GET", resource.routePath, (request) =>
      Effect.succeed(
        acceptsHtml(request)
          ? html(renderStaticDocument(originOf(request), resource.documentHtml))
          : markdown(resource.text)
      )
    )
  ),
  ...skills.flatMap((skill) => [
    HttpRouter.add("GET", skill.routePath, (request) =>
      Effect.succeed(
        acceptsHtml(request)
          ? html(renderStaticDocument(originOf(request), skill.documentHtml))
          : markdown(skill.text)
      )
    ),
    HttpRouter.add("GET", agentSkillPath(skill.name), markdown(skill.text)),
  ]),
  ...(
    ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "QUERY"] as const
  ).map((method) =>
    HttpRouter.add(
      method,
      "/*",
      HttpServerResponse.text("Not found.\n", {
        contentType: "text/plain; charset=utf-8",
        status: 404,
      })
    )
  )
);

const JsonRpcEnvelope = Schema.Struct({
  id: Schema.optional(
    Schema.Union([Schema.String, Schema.Finite, Schema.Null])
  ),
  method: Schema.optional(Schema.String),
  params: Schema.optional(
    Schema.Struct({ name: Schema.optional(Schema.Unknown) })
  ),
});

const inspectMcpRequest = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* inspectRequest() {
    const { source } = request;

    const body: unknown =
      source instanceof Request
        ? yield* Effect.tryPromise(
            // oxlint-disable-next-line typescript/promise-function-async -- The Fetch Request owns this Promise-returning boundary.
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

export interface LegacyMcpRouter {
  readonly forward: (
    session: string,
    request: Request
  ) => Effect.Effect<Response>;
}

const MODERN_MCP_VERSION = "2026-07-28";

const sessionIdPattern =
  /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

interface McpRequestRouting {
  readonly envelope: typeof JsonRpcEnvelope.Type | null;
  readonly isApi: boolean;
  readonly isExecute: boolean;
  readonly isMcp: boolean;
  readonly mcpToolCall: boolean;
  readonly modernMcp: boolean;
}

const routingOf = (request: HttpServerRequest.HttpServerRequest) =>
  Effect.gen(function* routeRequest() {
    const path = new URL(request.url, "https://ratstack.sh").pathname;
    const isMcp = path === "/mcp";

    const modernMcp =
      request.headers["mcp-protocol-version"] === MODERN_MCP_VERSION;

    const envelope =
      isMcp && !modernMcp && request.method === "POST"
        ? yield* inspectMcpRequest(request)
        : null;

    const mcpMethod = request.headers["mcp-method"] ?? envelope?.method;
    const mcpToolName = request.headers["mcp-name"] ?? envelope?.params?.name;
    const mcpToolCall = isMcp && mcpMethod === "tools/call";

    return {
      envelope,
      isApi: path === "/api" || path.startsWith("/api/"),
      isExecute:
        path === "/api/execute" || (mcpToolCall && mcpToolName === "execute"),
      isMcp,
      mcpToolCall,
      modernMcp,
    } satisfies McpRequestRouting;
  });

const firstExceededLimit = (
  rateLimits: RateLimits,
  request: HttpServerRequest.HttpServerRequest,
  routing: McpRequestRouting
) =>
  Effect.gen(function* checkLimits() {
    const clientIp = request.headers["cf-connecting-ip"] ?? "unknown";

    const checks: readonly (readonly [RateLimitName, string])[] = [
      ["API_PER_IP", clientIp],
      ...(routing.isExecute
        ? ([
            ["EXECUTE_PER_IP", clientIp],
            ["EXECUTE_GLOBAL", "global"],
          ] as const)
        : []),
    ];

    for (const [name, key] of checks) {
      if (!(yield* rateLimits.limit(name, key))) {
        return name;
      }
    }

    return null;
  });

const legacySessionOf = (
  request: HttpServerRequest.HttpServerRequest,
  routing: McpRequestRouting
) => {
  if (!routing.isMcp || routing.modernMcp) {
    return null;
  }

  const existing = request.headers["mcp-session-id"];

  if (existing !== undefined) {
    return existing;
  }

  if (routing.envelope?.method !== "initialize") {
    return null;
  }

  // @effect-diagnostics-next-line cryptoRandomUUID:off -- Workers ship Web Crypto and Effect has no Web Crypto layer; a random session id needs no injectable service.
  return crypto.randomUUID();
};

const routeLegacyMcp = (
  router: LegacyMcpRouter,
  request: HttpServerRequest.HttpServerRequest,
  session: string,
  routing: McpRequestRouting
) =>
  Effect.gen(function* routeLegacy() {
    if (!sessionIdPattern.test(session)) {
      return HttpServerResponse.fromWeb(
        legacySessionNotFound(routing.envelope?.id)
      );
    }

    const web = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

    return HttpServerResponse.fromWeb(yield* router.forward(session, web));
  });

const needsVersionHelp = (
  request: HttpServerRequest.HttpServerRequest,
  routing: McpRequestRouting
) =>
  routing.isMcp &&
  (request.method === "GET" ||
    (request.method === "POST" &&
      request.headers["mcp-protocol-version"] === undefined &&
      routing.envelope?.method === "initialize"));

const requestProtection = (options: {
  readonly legacyMcp?: LegacyMcpRouter;
  readonly rateLimits?: RateLimits;
}) =>
  HttpRouter.middleware(
    (httpEffect) =>
      Effect.gen(function* protectRequest() {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const routing = yield* routingOf(request);

        if (
          (routing.isMcp || routing.isApi) &&
          options.rateLimits !== undefined
        ) {
          const exceeded = yield* firstExceededLimit(
            options.rateLimits,
            request,
            routing
          );

          if (exceeded !== null) {
            return yield* rateLimitResponse(
              request,
              exceeded,
              routing.mcpToolCall
            );
          }
        }

        const session =
          options.legacyMcp === undefined
            ? null
            : legacySessionOf(request, routing);

        if (session !== null && options.legacyMcp !== undefined) {
          return yield* routeLegacyMcp(
            options.legacyMcp,
            request,
            session,
            routing
          );
        }

        if (needsVersionHelp(request, routing)) {
          return HttpServerResponse.text(mcpVersionText(originOf(request)), {
            contentType: "text/plain; charset=utf-8",
            status: request.method === "POST" ? 400 : 200,
          });
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

const securityHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
};

const contentSecurityPolicy =
  "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src https://static.cloudflareinsights.com; connect-src https://cloudflareinsights.com; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const securityHeadersMiddleware = HttpRouter.middleware(
  (httpEffect) =>
    httpEffect.pipe(
      Effect.map((response) => {
        const contentType = response.headers["content-type"] ?? "";

        const secured = HttpServerResponse.setHeaders(
          response,
          securityHeaders
        );

        const embeddable = contentType.startsWith("image/")
          ? HttpServerResponse.setHeader(
              secured,
              "cross-origin-resource-policy",
              "cross-origin"
            )
          : secured;

        return contentType.startsWith("text/html")
          ? HttpServerResponse.setHeader(
              embeddable,
              "content-security-policy",
              contentSecurityPolicy
            )
          : embeddable;
      })
    ),
  { global: true }
);

export interface WebBotAuthOptions {
  readonly enabled: boolean;
  readonly privateJwk?: string | undefined;
}

export interface MischiefRouteOptions {
  readonly legacyMcp?: LegacyMcpRouter;
  readonly rateLimits?: RateLimits;
  readonly staticCache?: StaticResponseCache | undefined;
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

export const mischiefRoutes = (options: MischiefRouteOptions = {}) =>
  Layer.mergeAll(
    contentRoutes,
    apiRoutes,
    mcp,
    securityHeadersMiddleware,
    options.rateLimits === undefined && options.legacyMcp === undefined
      ? Layer.empty
      : requestProtection(options),
    linkHeaders,
    options.staticCache === undefined
      ? Layer.empty
      : staticCaching(options.staticCache),
    webBotAuthRoutes(options.webBotAuth ?? { enabled: false })
  );

export const routes = mischiefRoutes();
