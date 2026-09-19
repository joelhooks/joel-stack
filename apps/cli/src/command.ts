// Every command here is a projection of the same capabilities: `stats` is
// the CLI projection of inspectFile, `serve` and `openapi` the HTTP one, `mcp`
// the MCP one. Adding a capability in @rat-stack/core adds it to all four.
import { toCommand } from "@rat-stack/capability";
import { formatFileStats, inspectFile } from "@rat-stack/core";
import { Console, Effect, Layer } from "effect";
import { Command, Flag } from "effect/unstable/cli";

import { http, mcpServer, webServer } from "./surfaces.js";
import { VERSION } from "./version.js";

export { VERSION } from "./version.js";

const statsCommand = toCommand(inspectFile, {
  name: "stats",
  positional: ["path"],
  render: formatFileStats,
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

const mcpCommand = Command.make("mcp", {}, () =>
  Layer.launch(mcpServer).pipe(Effect.orDie)
).pipe(
  Command.withDescription("Serve the capabilities as an MCP server over stdio")
);

export const rootCommand = Command.make("rat-stack").pipe(
  Command.withDescription("Agent-first file inspection: CLI, REST, and MCP"),
  Command.withSubcommands([
    statsCommand,
    openapiCommand,
    serveCommand,
    mcpCommand,
  ])
);

export const runCommand = Command.runWith(rootCommand, { version: VERSION });
