import { Schema } from "effect";

export class TestPersonUnavailable extends Schema.TaggedError<TestPersonUnavailable>()(
  "TestPersonUnavailable",
  { message: Schema.String, name: Schema.String }
) {}
