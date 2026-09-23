import { toCommand } from "@rat-stack/capability";
import { capabilities, formatFileStats, inspectFile } from "@rat-stack/core";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import {
  DEVTOOLS_HOST,
  DEVTOOLS_MCP_PATH,
  codeMode,
  devtoolsWebServer,
  http,
  mcpServer,
  webServer,
} from "./surfaces.js";
import { VERSION } from "./version.js";

export { VERSION } from "./version.js";

const capabilityCommands = capabilities.map((capability) => {
  const command =
    capability === inspectFile
      ? toCommand(capability, {
          positional: ["path"],
          render: formatFileStats,
        }).pipe(Command.withAlias("stats"))
      : toCommand(capability);

  return command;
});

const openapiCommand = Command.make("openapi", {}, () =>
  Console.log(JSON.stringify(http.openApi(), null, 2))
).pipe(Command.withDescription("Print the OpenAPI document for the REST API"));

const devtoolsFlag = Flag.Boolean("devtools").pipe(
  Flag.withDefault(false),
  Flag.withDescription(
    "Record every capability call and add the rat_* devtools tools"
  )
);

const serveCommand = Command.make(
  "serve",
  {
    devtools: devtoolsFlag,
    port: Flag.Int("port").pipe(
      Flag.withDefault(3000),
      Flag.withDescription("TCP port to listen on")
    ),
  },
  ({ devtools, port }) =>
    devtools
      ? Console.error(
          `🐀 devtools MCP: http://${DEVTOOLS_HOST}:${port}${DEVTOOLS_MCP_PATH}`
        ).pipe(
          Effect.andThen(Layer.launch(devtoolsWebServer(port))),
          Effect.orDie
        )
      : Layer.launch(webServer(port))
).pipe(
  Command.withDescription(
    "Serve the REST API, /openapi.json, and /docs until interrupted; --devtools adds MCP at /__rat/mcp on 127.0.0.1"
  )
);

const mcpCommand = Command.make(
  "mcp",
  {
    codeMode: Flag.Boolean("code-mode").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Expose search and execute instead of one tool per capability"
      )
    ),
    devtools: devtoolsFlag,
  },
  ({ codeMode: enabled, devtools }) => {
    if (devtools) {
      return enabled
        ? Layer.launch(mcpServer.devtoolsCodeMode).pipe(Effect.orDie)
        : Layer.launch(mcpServer.devtools).pipe(Effect.orDie);
    }

    return enabled
      ? Layer.launch(mcpServer.codeMode).pipe(Effect.orDie)
      : Layer.launch(mcpServer.tools).pipe(Effect.orDie);
  }
).pipe(
  Command.withDescription("Serve the capabilities as an MCP server over stdio")
);

const catalogCommand = Command.make(
  "catalog",
  {
    types: Flag.Boolean("types").pipe(
      Flag.withDefault(false),
      Flag.withDescription(
        "Print the TypeScript declarations a code-mode program sees"
      )
    ),
  },
  ({ types }) =>
    Console.log(
      types ? codeMode.declarations : JSON.stringify(codeMode.catalog, null, 2)
    )
).pipe(
  Command.withDescription(
    "Print the capability catalog as JSON Schema, or as TypeScript with --types"
  )
);

export const rootCommand = Command.make("rat-stack").pipe(
  Command.withDescription("Agent-first file inspection: CLI, REST, and MCP"),
  Command.withSubcommands([
    ...capabilityCommands,
    catalogCommand,
    openapiCommand,
    serveCommand,
    mcpCommand,
  ])
);

export const runCommand = Command.runWith(rootCommand, { version: VERSION });
