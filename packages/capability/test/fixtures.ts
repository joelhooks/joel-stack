import { Context, Effect, Layer, Schema } from "effect";

import { defineCapability } from "../src/index.js";
import { NotFound } from "./not-found.js";

export { NotFound } from "./not-found.js";

export class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("@rat-stack/capability/test/Greeter", {
  make: Effect.succeed({
    greet: (name: string) => Effect.succeed(`hello ${name}`),
  }),
}) {
  static readonly layer = Layer.effect(this, this.make);
}

/** Pure, read-only, no requirements. */
export const echo = defineCapability("echo", {
  annotations: { idempotent: true, readOnly: true },
  description: "Repeat text a number of times",
  failure: Schema.Never,
  handler: ({ text, times }) =>
    Effect.succeed({ text: text.repeat(times ?? 1) }),
  input: Schema.Struct({
    text: Schema.String.annotate({ description: "Text to repeat" }),
    times: Schema.optional(Schema.Finite),
  }),
  output: Schema.Struct({ text: Schema.String }),
});

/** Needs a service and has a typed failure. */
export const greet = defineCapability("greet", {
  description: "Greet someone by name",
  failure: NotFound,
  handler: ({ name }) =>
    name === "nobody"
      ? Effect.fail(new NotFound({ name }))
      : Greeter.use((greeter) => greeter.greet(name)).pipe(
          Effect.map((greeting) => ({ greeting }))
        ),
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.Struct({ greeting: Schema.String }),
});

/** Requires a host decision before the handler can run. */
export const approved = defineCapability("approved", {
  description: "A capability that requires approval",
  failure: Schema.Never,
  handler: () => Effect.succeed({ ok: true }),
  input: Schema.Struct({ message: Schema.String }),
  needsApproval: true,
  output: Schema.Struct({ ok: Schema.Boolean }),
});

/** Exercises the remaining flag kinds. */
export const shape = defineCapability("shape", {
  description: "Echo a mixed input back",
  failure: Schema.Never,
  handler: (input) => Effect.succeed(input),
  input: Schema.Struct({
    enabled: Schema.Boolean,
    mode: Schema.Literals(["fast", "slow"]),
    tags: Schema.Array(Schema.String),
  }),
  output: Schema.Struct({
    enabled: Schema.Boolean,
    mode: Schema.Literals(["fast", "slow"]),
    tags: Schema.Array(Schema.String),
  }),
});
