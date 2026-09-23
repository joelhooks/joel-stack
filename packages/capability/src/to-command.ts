// Projection: Capability -> effect/unstable/cli Command.
//
// The input Struct's fields become flags (or positional arguments when named
// in `positional`). The primitive field kinds map to the matching Flag
// primitive so help text and parsing stay native; anything else is a JSON
// string flag decoded through the field's own schema. The handler decodes the
// parsed values through the input schema once more, so the Command cannot
// call the capability with anything the schema would reject.
//
// Output is the encoded output schema as JSON, or `render(output)` when a
// renderer is supplied, in which case `--json` switches back to JSON.
import type { SchemaAST } from "effect";
import { Console, Effect, Option, Schema } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { Approval } from "./approval.js";
import type {
  AnyCapability,
  FailureOf,
  InputOf,
  OutputOf,
  PlainSchema,
  RequirementsOf as CapabilityRequirementsOf,
} from "./capability.js";

export interface ToCommandOptions<Output> {
  /** Command name; defaults to the capability's name. */
  readonly name?: string | undefined;
  /** Input fields to take as positional arguments, in order. */
  readonly positional?: readonly string[] | undefined;
  /** Human-readable rendering; enables a `--json` flag for the raw output. */
  readonly render?: ((output: Output) => string) | undefined;
}

interface FieldShape {
  readonly description: string | undefined;
  readonly kind: "string" | "number" | "boolean" | "literals" | "json";
  readonly literals: readonly string[];
  readonly optional: boolean;
}

const isUndefinedAst = (ast: SchemaAST.AST): boolean =>
  ast._tag === "Undefined";

const literalOf = (ast: SchemaAST.AST): string | undefined =>
  ast._tag === "Literal" && typeof ast.literal === "string"
    ? ast.literal
    : undefined;

const primitiveKinds: Partial<
  Record<SchemaAST.AST["_tag"], FieldShape["kind"]>
> = {
  Boolean: "boolean",
  Number: "number",
  String: "string",
};

const primitiveKind = (ast: SchemaAST.AST): FieldShape["kind"] =>
  primitiveKinds[ast._tag] ?? "json";

const describe = (field: PlainSchema): FieldShape => {
  let ast: SchemaAST.AST = field.ast;
  let optional = ast.context?.isOptional === true;

  const description =
    typeof ast.annotations?.description === "string"
      ? ast.annotations.description
      : undefined;

  if (ast._tag === "Union") {
    const members = ast.types.filter((member) => !isUndefinedAst(member));

    if (members.length < ast.types.length) {
      optional = true;
    }

    const [only] = members;

    if (members.length === 1 && only !== undefined) {
      ast = only;
    } else {
      const literals = members.map(literalOf);

      if (literals.every((literal) => literal !== undefined)) {
        return { description, kind: "literals", literals, optional };
      }

      return { description, kind: "json", literals: [], optional };
    }
  }

  const literal = literalOf(ast);

  if (literal !== undefined) {
    return { description, kind: "literals", literals: [literal], optional };
  }

  const kind = primitiveKind(ast);

  return { description, kind, literals: [], optional };
};

const jsonFlag = (name: string, field: PlainSchema) =>
  Flag.String(name).pipe(
    // A JSON-string flag decoded by the field's own schema. `withSchema` wants
    // a codec with the CLI environment as its services; a plain field schema
    // needs none, which `never` satisfies.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    Flag.withSchema(Schema.fromJsonString(field) as never),
    Flag.withMetavar("JSON")
  );

const flagBuilders: Record<
  FieldShape["kind"],
  (name: string, field: PlainSchema, shape: FieldShape) => Flag.Flag<unknown>
> = {
  boolean: (name) => Flag.Boolean(name).pipe(Flag.withDefault(false)),
  json: (name, field) => jsonFlag(name, field),
  literals: (name, _field, shape) => Flag.Literals(name, shape.literals),
  number: (name) => Flag.Finite(name),
  string: (name) => Flag.String(name),
};

const flagFor = (name: string, field: PlainSchema): Flag.Flag<unknown> => {
  const shape = describe(field);
  const base = flagBuilders[shape.kind](name, field, shape);

  const described =
    shape.description === undefined
      ? base
      : base.pipe(Flag.withDescription(shape.description));

  return shape.optional && shape.kind !== "boolean"
    ? described.pipe(Flag.optional, Flag.map(Option.getOrUndefined))
    : described;
};

const argumentBuilders: Record<
  FieldShape["kind"],
  (name: string, shape: FieldShape) => Argument.Argument<unknown>
> = {
  boolean: (name) => Argument.String(name),
  json: (name) => Argument.String(name),
  literals: (name, shape) => Argument.Literals(name, shape.literals),
  number: (name) => Argument.Finite(name),
  string: (name) => Argument.String(name),
};

const argumentFor = (
  name: string,
  field: PlainSchema
): Argument.Argument<unknown> => {
  const shape = describe(field);
  const base = argumentBuilders[shape.kind](name, shape);

  return shape.description === undefined
    ? base
    : base.pipe(Argument.withDescription(shape.description));
};

const JSON_FLAG = "json";

const APPROVAL_FLAG = "yes";

export const toCommand = <C extends AnyCapability>(
  capability: C,
  options?: ToCommandOptions<OutputOf<C>["Type"]>
) => {
  const positional = new Set(options?.positional);

  const config: Record<
    string,
    Flag.Flag<unknown> | Argument.Argument<unknown>
  > = {};

  for (const [name, field] of Object.entries(capability.input.fields)) {
    config[name] = positional.has(name)
      ? argumentFor(name, field)
      : flagFor(name, field);
  }

  const render = options?.render;

  if (render !== undefined) {
    config[JSON_FLAG] = Flag.Boolean(JSON_FLAG).pipe(
      Flag.withDefault(false),
      Flag.withDescription("Print machine-readable JSON")
    );
  }

  if (capability.needsApproval) {
    config[APPROVAL_FLAG] = Flag.Boolean(APPROVAL_FLAG).pipe(
      Flag.withDefault(false),
      Flag.withDescription("Approve this capability for this invocation")
    );
  }

  const decodeInput = Schema.decodeUnknownEffect(capability.input);
  const encodeOutput = Schema.encodeEffect(capability.output);

  // `C extends Any` widens the handler's channels to `unknown`; the extractors
  // recover the concrete ones from `C`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const run = capability.handler as (
    input: InputOf<C>["Type"]
  ) => Effect.Effect<
    OutputOf<C>["Type"],
    FailureOf<C>["Type"],
    CapabilityRequirementsOf<C>
  >;

  return Command.make(
    options?.name ?? capability.name,
    config,
    Effect.fn(`Capability.${capability.name}`)(function* runCommand(parsed) {
      const { [APPROVAL_FLAG]: yes, [JSON_FLAG]: json, ...fields } = parsed;
      const input = yield* decodeInput(fields);

      // Decoded through `capability.input`, whose Type `C` makes precise.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const output = yield* run(input).pipe(
        Effect.provide(yes === true ? Approval.allowAll : Approval.denyAll)
      );

      const text =
        render !== undefined && json !== true
          ? render(output)
          : JSON.stringify(yield* encodeOutput(output), null, 2);

      yield* Console.log(text);
    })
  ).pipe(Command.withDescription(capability.description));
};
