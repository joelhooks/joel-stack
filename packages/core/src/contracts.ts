import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { FileStatsError, FileStatsSchema } from "./stats.js";

const ContentKind = Schema.Literals(["law", "skill", "lore"]);

export const SearchMatch = Schema.Struct({
  description: Schema.String,
  digest: Schema.String,
  excerpt: Schema.String,
  id: Schema.String,
  kind: ContentKind,
  routePath: Schema.String,
  score: Schema.Finite,
  title: Schema.String,
});

export const SearchOutput = Schema.Struct({
  matches: Schema.Array(SearchMatch),
  total: Schema.Finite,
});

export const ReadOutput = Schema.Struct({
  description: Schema.String,
  digest: Schema.String,
  id: Schema.String,
  kind: ContentKind,
  routePath: Schema.String,
  sourcePath: Schema.String,
  text: Schema.String,
  title: Schema.String,
});

export class ResourceNotFound extends Schema.TaggedError<ResourceNotFound>()(
  "ResourceNotFound",
  {
    id: Schema.String,
    message: Schema.String,
  }
) {}

export const inspectFileContract = defineContract("inspectFile", {
  annotations: { idempotent: true, readOnly: true },
  description: "Count bytes, characters, words, and lines in a file",
  failure: FileStatsError,
  input: Schema.Struct({
    path: Schema.String.annotate({ description: "File to inspect" }),
  }),
  output: FileStatsSchema,
});

export const searchContract = defineContract("search", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Search rat-stack repository law and skills. Returns stable resource ids for read.",
  failure: Schema.Never,
  input: Schema.Struct({
    limit: Schema.optional(Schema.Finite),
    query: Schema.String,
  }),
  output: SearchOutput,
});

export const readContract = defineContract("read", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Read one exact rat-stack law or skill document by the resource id returned from search.",
  failure: ResourceNotFound,
  input: Schema.Struct({ id: Schema.String }),
  output: ReadOutput,
});
