import { Schema } from "effect";

export class UnknownPage extends Schema.TaggedError<UnknownPage>()(
  "UnknownPage",
  {
    message: Schema.String,
    slug: Schema.String,
  }
) {}
