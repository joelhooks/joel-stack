import { Schema } from "effect";

export class NoPath extends Schema.TaggedError<NoPath>()("NoPath", {
  from: Schema.String,
  message: Schema.String,
  to: Schema.String,
}) {}
