import { Schema } from "effect";

export class SandboxError extends Schema.TaggedError<SandboxError>()(
  "SandboxError",
  {
    logs: Schema.Array(Schema.String),
    message: Schema.String,
    reason: Schema.Literals(["exited", "protocol", "threw", "timeout"]),
  }
) {}
