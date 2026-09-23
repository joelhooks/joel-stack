import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { rpcRouteHandler } from "../server/rpc.js";

export const Route = createFileRoute("/rpc")({
  server: {
    handlers: {
      // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare service bindings return Promises.
      ANY: rpcRouteHandler(async (request) => await env.BACKEND.fetch(request)),
    },
  },
});
