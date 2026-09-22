import { toHttpApi } from "@rat-stack/capability/http-api";
import { toToolkit } from "@rat-stack/capability/toolkit";
import * as AlchemyHttp from "alchemy/Http";
import { Effect, Layer } from "effect";
import * as McpProtocol from "effect/unstable/ai/McpProtocol";
import * as McpServer from "effect/unstable/ai/McpServer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import type * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
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
  htmlDocument,
  lawResources,
  linkHeader,
  llmsFullText,
  llmsText,
  markdownDocument,
  mcpServerCard,
  robotsText,
  sitemapXml,
  skillIndex,
  skills,
} from "./content.js";
import { decodeEd25519PrivateJwk, publicKeyDirectory } from "./web-bot-auth.js";

const markdown = (body: string) =>
  HttpServerResponse.text(body, {
    contentType: "text/markdown; charset=utf-8",
  });

const json = (body: unknown, contentType = "application/json") =>
  HttpServerResponse.jsonUnsafe(body, {
    contentType,
    headers: { "access-control-allow-origin": "*" },
  });

const originOf = (request: HttpServerRequest.HttpServerRequest) =>
  new URL(request.url, "https://ratstack.sh").origin;

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
    "Use search to find source-grounded rat-stack law and skills, read exact resources by id, and execute only when a multi-step program is more efficient.",
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
      request.headers.accept?.includes("text/html") === true
        ? HttpServerResponse.text(htmlDocument(origin), {
            contentType: "text/html; charset=utf-8",
          })
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
  HttpRouter.add("GET", "/skills", markdown(skillIndex())),
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
    HttpRouter.add("GET", skill.routePath, markdown(skill.text)),
    HttpRouter.add("GET", agentSkillPath(skill.name), markdown(skill.text)),
  ])
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
    linkHeaders,
    webBotAuthRoutes(options.webBotAuth ?? { enabled: false })
  );

export const routes = makeRoutes();
