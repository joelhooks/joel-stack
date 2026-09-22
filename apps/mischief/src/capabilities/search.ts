import { defineCapability } from "@rat-stack/capability/define";
import { Effect, Schema } from "effect";

import { searchContent } from "../content.js";
import { SearchOutput } from "./schemas.js";

export const search = defineCapability("search", {
  annotations: {
    idempotent: true,
    readOnly: true,
  },
  description:
    "Search rat-stack repository law and skills. Returns stable resource ids for read.",
  failure: Schema.Never,
  handler: ({ limit, query }) => {
    const matches = searchContent(query, limit);
    return Effect.succeed({
      matches,
      total: matches.length,
    });
  },
  input: Schema.Struct({
    limit: Schema.optional(Schema.Finite),
    query: Schema.String,
  }),
  output: SearchOutput,
});
