import { createFileRoute } from "@tanstack/react-router";

import { devtoolsBackend } from "#backend";

import { rpcRouteHandler } from "../server/rpc.js";

export const Route = createFileRoute("/__rat/$")({
  server: {
    handlers: {
      ANY: rpcRouteHandler(devtoolsBackend),
    },
  },
});
