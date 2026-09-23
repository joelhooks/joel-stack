import { Schema } from "effect";

export class CallNotFound extends Schema.TaggedError<CallNotFound>()(
  "CallNotFound",
  {
    firstIndex: Schema.Int,
    index: Schema.Int,
    nextIndex: Schema.Int,
  }
) {}
