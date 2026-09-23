import type { AnyCapability } from "@rat-stack/capability";
import { toRpc } from "@rat-stack/capability/rpc";
import * as Layer from "effect/Layer";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

export const contentRoutes = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
) => {
  const content = toRpc(capabilities);

  return RpcServer.layerHttp({
    group: content.group,
    path: "/rpc",
    protocol: "http",
  }).pipe(
    Layer.provide(content.layer),
    Layer.provide(RpcSerialization.layerJson)
  );
};
