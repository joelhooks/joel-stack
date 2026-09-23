import { Schema } from "effect";

export class ActorNotFound extends Schema.TaggedError<ActorNotFound>()(
  "ActorNotFound",
  {
    actorId: Schema.String,
    available: Schema.Array(Schema.String),
  }
) {}
