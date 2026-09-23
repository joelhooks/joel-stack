import { Auth } from "@rat-stack/auth";
import {
  ratTestPerson,
  runAsPerson,
  testPersonLayer,
} from "@rat-stack/auth/devtools";
import type { AnyCapability } from "@rat-stack/capability";
import { toRpc } from "@rat-stack/capability/rpc";
import { toToolkit } from "@rat-stack/capability/toolkit";
import { devtools, devtoolsLayer } from "@rat-stack/devtools";
import { RuntimeContext } from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { McpProtocol, McpServer } from "effect/unstable/ai";
import { RpcSerialization, RpcServer } from "effect/unstable/rpc";

export const DEVTOOLS_RPC_PATH = "/__rat/rpc";

export const DEVTOOLS_MCP_PATH = "/__rat/mcp";

const DEV_AUTH_SECRET = "rat-stack-dev-only-secret-never-deployed";

const devAuth = Layer.unwrap(
  Config.option(Config.String("PORTLESS_URL")).pipe(
    Effect.orDie,
    Effect.map((portlessUrl) =>
      Auth.memoryLayer(
        DEV_AUTH_SECRET,
        Option.match(portlessUrl, {
          onNone: () => ({}),
          onSome: (baseURL) => ({ baseURL }),
        })
      )
    )
  )
);

export const devtoolsRoutes = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
) =>
  Layer.unwrap(
    Effect.map(
      devtools([...capabilities, ratTestPerson], { runAs: runAsPerson }),
      ({ capabilities: all, recorded, tools }) => {
        const app = toRpc(recorded);
        const overlay = toRpc(tools);
        const agents = toToolkit(all);

        return Layer.mergeAll(
          RpcServer.layerHttp({
            group: app.group,
            path: "/rpc",
            protocol: "http",
          }).pipe(Layer.provide(app.layer)),
          RpcServer.layerHttp({
            group: overlay.group,
            path: DEVTOOLS_RPC_PATH,
            protocol: "http",
          }).pipe(Layer.provide(overlay.layer)),
          McpServer.toolkit(agents.toolkit).pipe(
            Layer.provideMerge(agents.layer),
            Layer.provide(
              McpServer.layerHttp({
                name: "rat-stack-web-devtools",
                path: DEVTOOLS_MCP_PATH,
                protocols: [McpProtocol.v2025_06_18, McpProtocol.v2025_03_26],
                version: "0.0.0",
              })
            )
          )
        );
      }
    )
  ).pipe(
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(devtoolsLayer()),
    Layer.provideMerge(testPersonLayer("dev")),
    Layer.provideMerge(devAuth),
    Layer.provideMerge(RuntimeContext.phantom)
  );
