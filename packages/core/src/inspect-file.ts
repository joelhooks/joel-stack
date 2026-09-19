// The first Capability: the same file inspection the CLI has always done,
// now stated once and projected to the CLI, REST, and MCP surfaces by
// @rat-stack/capability. The handler runs the lifecycle machine, so every
// surface shares the same states and the same typed failure.
import { defineCapability } from "@rat-stack/capability";
import { Schema } from "effect";

import { runInspectMachine } from "./inspect-machine.js";
import { FileStatsError, FileStatsSchema } from "./stats.js";

export const inspectFile = defineCapability("inspectFile", {
  annotations: { idempotent: true, readOnly: true },
  description: "Count bytes, characters, words, and lines in a file",
  failure: FileStatsError,
  handler: ({ path }) => runInspectMachine(path),
  input: Schema.Struct({
    path: Schema.String.annotate({ description: "File to inspect" }),
  }),
  output: FileStatsSchema,
});

/** Every capability this package offers, in catalog order. */
export const capabilities = [inspectFile] as const;
