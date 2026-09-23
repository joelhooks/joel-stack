import { toRpc } from "@rat-stack/capability/rpc";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

import { contentCapabilities } from "./capabilities/index.js";

export const rpcProjection = toRpc(contentCapabilities);

export default class RpcBackend extends Cloudflare.Workers.RpcWorker<RpcBackend>()(
  "RpcBackend",
  {
    main: import.meta.url,
    schema: rpcProjection.group,
    workersDev: false,
  },
  Effect.succeed(
    RpcServer.toHttpEffect(rpcProjection.group).pipe(
      Effect.provide(
        Layer.mergeAll(rpcProjection.layer, RpcSerialization.layerJson)
      )
    )
  )
) {}
