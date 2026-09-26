import {
  contentCapabilities,
  contentLayer,
} from "@rat-stack/mischief/capabilities";
import { Layer } from "effect";
import { HttpRouter } from "effect/unstable/http";

import type { BackendFetch } from "../server/rpc.js";
import { devtoolsRoutes } from "./devtools/routes.js";

const { handler } = HttpRouter.toWebHandler(
  devtoolsRoutes(contentCapabilities).pipe(Layer.provide(contentLayer)),
  {
    disableLogger: true,
  }
);

export const backend: BackendFetch = handler;

export const devtoolsBackend: BackendFetch = handler;
