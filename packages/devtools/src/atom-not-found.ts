import { Schema } from "effect";

export class AtomNotFound extends Schema.TaggedError<AtomNotFound>()(
  "AtomNotFound",
  {
    available: Schema.Array(Schema.String),
    key: Schema.String,
  }
) {}
