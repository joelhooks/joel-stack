import { toCommand } from "@rat-stack/capability";
import { capabilities, formatFileStats, inspectFile } from "@rat-stack/core";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { codeMode, http, mcpServer, webServer } from "./surfaces.js";
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

const serveCommand = Command.make(
  "serve",
  {
    port: Flag.Int("port").pipe(
      Flag.withDefault(3000),
      Flag.withDescription("TCP port to listen on")
    ),
  },
  ({ port }) => Layer.launch(webServer(port))
).pipe(
  Command.withDescription(
    "Serve the REST API, /openapi.json, and /docs until interrupted"
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
  },
  ({ codeMode: enabled }) =>
    (enabled
      ? Layer.launch(mcpServer.codeMode)
      : Layer.launch(mcpServer.tools)
    ).pipe(Effect.orDie)
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
