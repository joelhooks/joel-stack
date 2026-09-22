import { Schema } from "effect";

const ContentKind = Schema.Literals(["law", "skill"]);

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
