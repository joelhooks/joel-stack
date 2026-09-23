import { toRpcGroup } from "@rat-stack/capability/rpc-group";
import { readContract, searchContract } from "@rat-stack/core/contracts";
import * as Layer from "effect/Layer";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as AtomRpc from "effect/unstable/reactivity/AtomRpc";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

const { group } = toRpcGroup([searchContract, readContract]);

export class DocsClient extends AtomRpc.Service<DocsClient>()("DocsClient", {
  group,
  protocol: RpcClient.layerProtocolHttp({ url: "/rpc" }).pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(RpcSerialization.layerJson)
  ),
}) {}

export const searchDocs = (query: string) =>
  DocsClient.query(
    "search",
    { limit: 10, query },
    { serializationKey: query, timeToLive: "30 seconds" }
  );

export const readDoc = (id: string) =>
  DocsClient.query("read", { id }, { serializationKey: id });
