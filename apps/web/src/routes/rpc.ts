import { createFileRoute } from "@tanstack/react-router";

import { backend } from "#backend";

import { rpcRouteHandler } from "../server/rpc.js";

export const Route = createFileRoute("/rpc")({
  server: {
    handlers: {
      ANY: rpcRouteHandler(backend),
    },
  },
});
