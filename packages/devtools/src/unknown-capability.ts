import { Schema } from "effect";

export class UnknownCapability extends Schema.TaggedError<UnknownCapability>()(
  "UnknownCapability",
  {
    available: Schema.Array(Schema.String),
    name: Schema.String,
  }
) {}
