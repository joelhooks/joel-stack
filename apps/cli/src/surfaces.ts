// The Node HTTP server is the one place where nothing in Effect wraps the
// built-in: `NodeHttpServer.layer` takes a `node:http` server factory.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createServer } from "node:http";

// The REST and MCP surfaces, each a projection of the same capabilities.
// Nothing here knows what the capabilities do; it only chooses transports.
import { NodeHttpServer } from "@effect/platform-node";
import { toHttpApi, toToolkit } from "@rat-stack/capability";
import { capabilities } from "@rat-stack/core";
import { Layer, Logger } from "effect";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { HttpRouter } from "effect/unstable/http";
import { HttpApiBuilder, HttpApiScalar } from "effect/unstable/httpapi";

import { VERSION } from "./version.js";

export const http = toHttpApi("RatStack", capabilities);
export const tools = toToolkit(capabilities);

/** Routes: the API, its OpenAPI document, and a Scalar reference page. */
export const routes = Layer.merge(
  HttpApiBuilder.layer(http.api, { openapiPath: "/openapi.json" }).pipe(
    Layer.provide(http.layer)
  ),
  HttpApiScalar.layer(http.api, { path: "/docs" })
);

export const webServer = (port: number) =>
  HttpRouter.serve(routes).pipe(
    Layer.provide(NodeHttpServer.layer(() => createServer(), { port }))
  );

/**
 * MCP over stdio. Stdout is the protocol channel, so logs go to stderr; the
 * three protocol versions are the ones current clients negotiate.
 */
export const mcpServer = McpServer.toolkit(tools.toolkit).pipe(
  Layer.provideMerge(tools.layer),
  Layer.provide(
    McpServer.layerStdio({
      name: "rat-stack",
      protocols: [
        McpProtocol.v2025_06_18,
        McpProtocol.v2025_03_26,
        McpProtocol.v2024_11_05,
      ],
      version: VERSION,
    })
  ),
  Layer.provide(Layer.succeed(Logger.LogToStderr, true))
);
