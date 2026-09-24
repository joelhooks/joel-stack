import { Context, Effect, Layer, Schema } from "effect";

import { defineContract, implement } from "../src/index.js";
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

const echoContract = defineContract("echo", {
  annotations: { idempotent: true, readOnly: true },
  description: "Repeat text a number of times",
  failure: Schema.Never,
  input: Schema.Struct({
    text: Schema.String.annotate({ description: "Text to repeat" }),
    times: Schema.optional(Schema.Finite),
  }),
  output: Schema.Struct({ text: Schema.String }),
});

export const echo = implement(echoContract, ({ text, times }) =>
  Effect.succeed({ text: text.repeat(times ?? 1) })
);

const greetContract = defineContract("greet", {
  description: "Greet someone by name",
  failure: NotFound,
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.Struct({ greeting: Schema.String }),
});

export const greet = implement(greetContract, ({ name }) =>
  name === "nobody"
    ? Effect.fail(new NotFound({ name }))
    : Greeter.use((greeter) => greeter.greet(name)).pipe(
        Effect.map((greeting) => ({ greeting }))
      )
);

const approvedContract = defineContract("approved", {
  description: "A capability that requires approval",
  failure: Schema.Never,
  input: Schema.Struct({ message: Schema.String }),
  needsApproval: true,
  output: Schema.Struct({ ok: Schema.Boolean }),
});

export const approved = implement(approvedContract, () =>
  Effect.succeed({ ok: true })
);

const mixedContract = defineContract("mixed", {
  description: "Echo a mixed input back",
  failure: Schema.Never,
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

export const mixed = implement(mixedContract, (input) => Effect.succeed(input));

const noArgsContract = defineContract("noArgs", {
  description: "Return a fixed value without input",
  failure: Schema.Never,
  input: Schema.Struct({}),
  output: Schema.String,
});

export const noArgs = implement(noArgsContract, () => Effect.succeed("ready"));

const checkedInputContract = defineContract("checkedInput", {
  description: "Use checked enum and array-length constraints",
  failure: Schema.Never,
  input: Schema.Struct({
    mode: Schema.Literals(["fast", "slow"]),
    values: Schema.Array(Schema.String)
      .check(Schema.isMinLength(1))
      .check(Schema.isMaxLength(3)),
  }),
  output: Schema.String,
});

export const checkedInput = implement(
  checkedInputContract,
  ({ mode, values }) => Effect.succeed(`${mode}:${values.length}`)
);
