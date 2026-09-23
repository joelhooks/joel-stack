import { Console, Effect, Option, Predicate, Schema, SchemaAST } from "effect";
import { Argument, Command, Flag } from "effect/unstable/cli";

import { Approval } from "./approval.js";
import type {
  AnyCapability,
  FailureOf,
  InputOf,
  OutputOf,
  PlainSchema,
  RequirementsOf as CapabilityRequirementsOf,
} from "./contract.js";

export interface ToCommandOptions<Output> {
  readonly name?: string | undefined;
  readonly positional?: readonly string[] | undefined;
  readonly render?: ((output: Output) => string) | undefined;
}

interface FieldSpec {
  readonly description: string | undefined;
  readonly kind: "string" | "number" | "boolean" | "literals" | "json";
  readonly literals: readonly string[];
  readonly optional: boolean;
}

const literalOf = (ast: SchemaAST.AST): string | undefined =>
  SchemaAST.isLiteral(ast) && Predicate.isString(ast.literal)
    ? ast.literal
    : undefined;

const primitiveKinds: Partial<
  Record<SchemaAST.AST["_tag"], FieldSpec["kind"]>
> = {
  Boolean: "boolean",
  Number: "number",
  String: "string",
};

const primitiveKind = (ast: SchemaAST.AST): FieldSpec["kind"] =>
  primitiveKinds[ast._tag] ?? "json";

const describe = (field: PlainSchema): FieldSpec => {
  let ast: SchemaAST.AST = field.ast;
  let optional = ast.context?.isOptional === true;

  const description = SchemaAST.resolveDescription(ast);

  if (SchemaAST.isUnion(ast)) {
    const members = ast.types.filter(
      (member) => !SchemaAST.isUndefined(member)
    );

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
    // SAFETY: a JSON-string flag decoded by the field's own schema. `withSchema` wants a codec with the CLI environment as its services; a plain field schema needs none, which `never` satisfies.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    Flag.withSchema(Schema.fromJsonString(field) as never),
    Flag.withMetavar("JSON")
  );

const flagBuilders: Record<
  FieldSpec["kind"],
  (name: string, field: PlainSchema, spec: FieldSpec) => Flag.Flag<unknown>
> = {
  boolean: (name) => Flag.Boolean(name).pipe(Flag.withDefault(false)),
  json: (name, field) => jsonFlag(name, field),
  literals: (name, _field, spec) => Flag.Literals(name, spec.literals),
  number: (name) => Flag.Finite(name),
  string: (name) => Flag.String(name),
};

const flagFor = (name: string, field: PlainSchema): Flag.Flag<unknown> => {
  const spec = describe(field);
  const base = flagBuilders[spec.kind](name, field, spec);

  const described =
    spec.description === undefined
      ? base
      : base.pipe(Flag.withDescription(spec.description));

  return spec.optional && spec.kind !== "boolean"
    ? described.pipe(Flag.optional, Flag.map(Option.getOrUndefined))
    : described;
};

const argumentBuilders: Record<
  FieldSpec["kind"],
  (name: string, spec: FieldSpec) => Argument.Argument<unknown>
> = {
  boolean: (name) => Argument.String(name),
  json: (name) => Argument.String(name),
  literals: (name, spec) => Argument.Literals(name, spec.literals),
  number: (name) => Argument.Finite(name),
  string: (name) => Argument.String(name),
};

const argumentFor = (
  name: string,
  field: PlainSchema
): Argument.Argument<unknown> => {
  const spec = describe(field);
  const base = argumentBuilders[spec.kind](name, spec);

  return spec.description === undefined
    ? base
    : base.pipe(Argument.withDescription(spec.description));
};

const JSON_FLAG = "json";

const APPROVAL_FLAG = "yes";

export const toCommand = <C extends AnyCapability>(
  capability: C,
  options?: ToCommandOptions<OutputOf<C>["Type"]>
) => {
  const { contract } = capability;
  const positional = new Set(options?.positional);

  const config: Record<
    string,
    Flag.Flag<unknown> | Argument.Argument<unknown>
  > = {};

  for (const [name, field] of Object.entries(contract.input.fields)) {
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

  if (contract.needsApproval) {
    config[APPROVAL_FLAG] = Flag.Boolean(APPROVAL_FLAG).pipe(
      Flag.withDefault(false),
      Flag.withDescription("Approve this capability for this invocation")
    );
  }

  const decodeInput = Schema.decodeUnknownEffect(contract.input);
  const encodeOutput = Schema.encodeEffect(contract.output);

  // SAFETY: `C extends Any` widens the handler's channels to `unknown`; the extractors recover the concrete ones from `C`.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const run = capability.handler as (
    input: InputOf<C>["Type"]
  ) => Effect.Effect<
    OutputOf<C>["Type"],
    FailureOf<C>["Type"],
    CapabilityRequirementsOf<C>
  >;

  return Command.make(
    options?.name ?? contract.name,
    config,
    Effect.fn(`Capability.${contract.name}`)(function* runCommand(parsed) {
      const { [APPROVAL_FLAG]: yes, [JSON_FLAG]: json, ...fields } = parsed;
      const input = yield* decodeInput(fields);

      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Decoded through `contract.input`, whose Type `C` makes precise.
      const output = yield* run(input).pipe(
        Effect.provide(yes === true ? Approval.allowAll : Approval.denyAll)
      );

      const text =
        render !== undefined && json !== true
          ? render(output)
          : JSON.stringify(yield* encodeOutput(output), null, 2);

      yield* Console.log(text);
    })
  ).pipe(Command.withDescription(contract.description));
};
