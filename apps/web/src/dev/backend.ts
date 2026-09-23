import { toRpc } from "@rat-stack/capability/rpc";
import { contentCapabilities } from "@rat-stack/mischief/capabilities";
import * as Layer from "effect/Layer";
import { HttpRouter } from "effect/unstable/http";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import type { BackendFetch } from "../server/rpc.js";

const content = toRpc(contentCapabilities);

const { handler } = HttpRouter.toWebHandler(
  RpcServer.layerHttp({
    group: content.group,
    path: "/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(content.layer),
    Layer.provide(RpcSerialization.layerJson)
  ),
  { disableLogger: true }
);

export const backend: BackendFetch = handler;
