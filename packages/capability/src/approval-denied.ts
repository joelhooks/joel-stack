import { Schema } from "effect";

export class ApprovalDenied extends Schema.TaggedError<ApprovalDenied>()(
  "ApprovalDenied",
  {
    capabilityName: Schema.String,
    reason: Schema.String,
  },
  {
    description: "ApprovalDenied",
    httpApiStatus: 403,
  }
) {
  override get message(): string {
    return `${this.reason}: ${this.capabilityName}`;
  }
}
