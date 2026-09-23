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

export const capabilities = [inspectFile] as const;
