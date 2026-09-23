import { contentCapabilities } from "@rat-stack/mischief/capabilities";
import { HttpRouter } from "effect/unstable/http";

import type { BackendFetch } from "../server/rpc.js";
import { devtoolsRoutes } from "./devtools/routes.js";

const { handler } = HttpRouter.toWebHandler(
  devtoolsRoutes(contentCapabilities),
  {
    disableLogger: true,
  }
);

export const backend: BackendFetch = handler;

export const devtoolsBackend: BackendFetch = handler;
