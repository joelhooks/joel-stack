// @effect-diagnostics asyncFunction:off
// The fetch shim below must be a Promise-returning function because that is
// what `FetchHttpClient.Fetch` calls; everything around it is Effect.
// An in-process MCP client over an in-memory HTTP handler, after Effect's own
// McpServer tests: the server layer becomes a web handler, a fetch shim keeps
// the session headers, and RpcClient speaks JSON-RPC to it.
import { Effect, Layer, Logger, References } from "effect";
import { constVoid } from "effect/Function";
import { McpProtocol, McpSchema, McpServer } from "effect/unstable/ai";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpRouter,
} from "effect/unstable/http";
import { RpcClient, RpcSerialization } from "effect/unstable/rpc";

const MCP_ENDPOINT = "http://localhost/mcp";

export const serverLayer = McpServer.layerHttp({
  name: "TestServer",
  path: "/mcp",
  protocols: [McpProtocol.v2025_06_18],
  version: "0.0.0",
}).pipe(
  Layer.provideMerge(
    Layer.succeed(References.CurrentLoggers, new Set([Logger.make(constVoid)]))
  )
);

export const makeMcpClient = Effect.fnUntraced(function* makeMcpClient<A, E>(
  appLayer: Layer.Layer<A, E, HttpRouter.HttpRouter>
) {
  const { dispose, handler } = HttpRouter.toWebHandler(appLayer, {
    disableLogger: true,
  });

  yield* Effect.addFinalizer(() => Effect.promise(dispose));

  let sessionId: string | null = null;
  let protocolVersion: string | null = null;

  const fetchImpl = async (
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit
  ): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input, init);

    if (sessionId !== null) {
      request.headers.set("Mcp-Session-Id", sessionId);
    }

    if (
      protocolVersion !== null &&
      !request.headers.has("Mcp-Protocol-Version")
    ) {
      request.headers.set("Mcp-Protocol-Version", protocolVersion);
    }

    const response = await handler(request);
    sessionId = response.headers.get("Mcp-Session-Id") ?? sessionId;
    protocolVersion =
      response.headers.get("Mcp-Protocol-Version") ?? protocolVersion;

    return response;
  };

  const fetch: typeof globalThis.fetch = Object.assign(fetchImpl, {
    preconnect() {
      /* not needed in-process */
    },
  });

  const clientLayer = RpcClient.layerProtocolHttp({
    transformClient: HttpClient.mapRequest(
      HttpClientRequest.setHeader(
        "accept",
        "application/json, text/event-stream"
      )
    ),
    url: MCP_ENDPOINT,
  }).pipe(
    Layer.provideMerge([
      FetchHttpClient.layer,
      RpcSerialization.layerJsonRpc(),
    ]),
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );

  const client = yield* RpcClient.make(McpSchema.ClientRpcs).pipe(
    Effect.provide(clientLayer)
  );

  yield* client.initialize({
    capabilities: {},
    clientInfo: { name: "TestClient", version: "0.0.0" },
    protocolVersion: "2025-06-18",
  });

  return client;
});
