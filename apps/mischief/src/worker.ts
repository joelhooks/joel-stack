import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as McpProtocol from "effect/unstable/ai/McpProtocol";
import * as McpServer from "effect/unstable/ai/McpServer";
import * as HttpRouter from "effect/unstable/http/HttpRouter";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";

import {
  AGENT_LAW_URI,
  agentLaw,
  agentPage,
  agentPageHtml,
  learnRatStack,
  llmsText,
  robotsText,
} from "./content.js";

const markdown = (body: string) =>
  HttpServerResponse.text(body, {
    contentType: "text/markdown; charset=utf-8",
  });

const mcpTransport = McpServer.layerHttp({
  allowedOrigins: ["https://ratstack.sh", "http://localhost:1337"],
  description: "Learn and use the rat-stack agentic TypeScript scaffold",
  instructions:
    "Read the project-law resource first. Use the learn-rat-stack prompt for the guided path.",
  name: "sh.ratstack/rat-stack",
  path: "/mcp",
  protocols: [McpProtocol.v2026_07_28],
  version: "0.1.0",
  websiteUrl: "https://ratstack.sh/",
});

const mcp = Layer.mergeAll(
  McpServer.resource({
    content: Effect.succeed(agentLaw),
    description: "The rat-stack repository law",
    mimeType: "text/markdown",
    name: "project-law",
    uri: AGENT_LAW_URI,
  }),
  McpServer.prompt({
    content: () => Effect.succeed(learnRatStack.body),
    description: learnRatStack.description,
    name: learnRatStack.name,
  })
).pipe(Layer.provide(mcpTransport));

export const routes = Layer.mergeAll(
  HttpRouter.add("GET", "/", (request) =>
    Effect.succeed(
      request.headers.accept?.includes("text/html") === true
        ? HttpServerResponse.text(agentPageHtml, {
            contentType: "text/html; charset=utf-8",
          })
        : markdown(agentPage)
    )
  ),
  HttpRouter.add("GET", "/llms.txt", markdown(llmsText)),
  HttpRouter.add(
    "GET",
    "/robots.txt",
    HttpServerResponse.text(robotsText, {
      contentType: "text/plain; charset=utf-8",
    })
  ),
  mcp
);

export default class Mischief extends Cloudflare.Worker<Mischief>()(
  "Mischief",
  {
    dev: { port: 1337 },
    main: import.meta.url,
  },
  Effect.gen(function* makeMischief() {
    return {
      fetch: yield* HttpRouter.toHttpEffect(routes).pipe(Effect.orDie),
    };
  })
) {}
