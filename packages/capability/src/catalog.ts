// The catalog is the code-mode projection's wire form: every capability as
// JSON Schema (the same schemas MCP and OpenAPI publish), plus a TypeScript
// declaration of the `tools` object a sandboxed program sees, and a small
// ranked search over it. After Executor's kernel IR and Cloudflare's Code
// Mode: types are generated from JSON Schema, never from Effect internals.
import { Option, Schema } from "effect";
import type { JsonSchema } from "effect";
import { Tool } from "effect/unstable/ai";

import { failureSchemaOf } from "./capability.js";
import type { Annotations, AnyCapability } from "./capability.js";

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly annotations: Annotations;
  readonly needsApproval: boolean;
  readonly input: JsonSchema.JsonSchema;
  readonly output: JsonSchema.JsonSchema;
  readonly failure: JsonSchema.JsonSchema;
}

export interface Catalog {
  readonly version: "1";
  readonly capabilities: readonly CatalogEntry[];
}

export const toCatalog = (capabilities: readonly AnyCapability[]): Catalog => ({
  capabilities: capabilities.map((capability) => ({
    annotations: capability.annotations,
    description: capability.description,
    failure: Tool.getJsonSchemaFromSchema(failureSchemaOf(capability)),
    input: Tool.getJsonSchemaFromSchema(capability.input),
    name: capability.name,
    needsApproval: capability.needsApproval,
    output: Tool.getJsonSchemaFromSchema(capability.output),
  })),
  version: "1",
});

// ---------------------------------------------------------------------------
// JSON Schema -> TypeScript
// ---------------------------------------------------------------------------

/** A JSON value the printer can render as a TypeScript literal type. */
type JsonLiteral = string | number | boolean | null;

/** The JSON Schema keywords the printer reads, parsed once at the boundary. */
interface JsonSchemaNode {
  readonly $defs?: Readonly<Record<string, JsonSchemaNode>>;
  readonly $ref?: string;
  readonly anyOf?: readonly JsonSchemaNode[];
  readonly const?: JsonLiteral;
  readonly description?: string;
  readonly enum?: readonly JsonLiteral[];
  readonly items?: JsonSchemaNode;
  readonly not?: JsonSchemaNode;
  readonly oneOf?: readonly JsonSchemaNode[];
  readonly properties?: Readonly<Record<string, JsonSchemaNode>>;
  readonly required?: readonly string[];
  readonly type?: string | readonly string[];
}

const JsonLiteralSchema = Schema.Union([
  Schema.String,
  Schema.Finite,
  Schema.Boolean,
  Schema.Null,
]);

const JsonSchemaNodeSchema: Schema.Codec<JsonSchemaNode> = Schema.Struct({
  $defs: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend(() => JsonSchemaNodeSchema)
    )
  ),
  $ref: Schema.optionalKey(Schema.String),
  anyOf: Schema.optionalKey(
    Schema.Array(Schema.suspend(() => JsonSchemaNodeSchema))
  ),
  const: Schema.optionalKey(JsonLiteralSchema),
  description: Schema.optionalKey(Schema.String),
  enum: Schema.optionalKey(Schema.Array(JsonLiteralSchema)),
  items: Schema.optionalKey(Schema.suspend(() => JsonSchemaNodeSchema)),
  not: Schema.optionalKey(Schema.suspend(() => JsonSchemaNodeSchema)),
  oneOf: Schema.optionalKey(
    Schema.Array(Schema.suspend(() => JsonSchemaNodeSchema))
  ),
  properties: Schema.optionalKey(
    Schema.Record(
      Schema.String,
      Schema.suspend(() => JsonSchemaNodeSchema)
    )
  ),
  required: Schema.optionalKey(Schema.Array(Schema.String)),
  type: Schema.optionalKey(
    Schema.Union([Schema.String, Schema.Array(Schema.String)])
  ),
});

const parseNode = Schema.decodeUnknownOption(JsonSchemaNodeSchema);

const quoteKey = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/u.test(key) ? key : JSON.stringify(key);

const literal = (value: JsonLiteral): string =>
  value === null ? "null" : JSON.stringify(value);

const refName = (ref: string | undefined): string | undefined =>
  ref?.startsWith("#/$defs/") === true
    ? ref.slice("#/$defs/".length)
    : undefined;

const objectType = (node: JsonSchemaNode): string => {
  const required = new Set(node.required);

  const members = Object.entries(node.properties ?? {}).map(([key, value]) => {
    const optional = required.has(key) ? "" : "?";

    const description =
      value.description === undefined ? "" : `/** ${value.description} */ `;

    // printNode and the object/primitive printers are mutually recursive.
    // oxlint-disable-next-line no-use-before-define
    return `${description}readonly ${quoteKey(key)}${optional}: ${printNode(value)}`;
  });

  return members.length === 0 ? "{}" : `{ ${members.join("; ")} }`;
};

const primitive = (type: string, node: JsonSchemaNode): string => {
  switch (type) {
    case "string": {
      return node.enum === undefined
        ? "string"
        : node.enum.map(literal).join(" | ");
    }

    case "number":
    case "integer": {
      return "number";
    }

    case "boolean": {
      return "boolean";
    }

    case "null": {
      return "null";
    }

    case "array": {
      return node.items === undefined
        ? "ReadonlyArray<unknown>"
        : // oxlint-disable-next-line no-use-before-define
          `ReadonlyArray<${printNode(node.items)}>`;
    }

    case "object": {
      return objectType(node);
    }

    default: {
      return "unknown";
    }
  }
};

const printNode = (node: JsonSchemaNode): string => {
  const ref = refName(node.$ref);

  if (ref !== undefined) {
    return ref;
  }

  if (node.const !== undefined) {
    return literal(node.const);
  }

  if (node.not !== undefined && Object.keys(node.not).length === 0) {
    return "never";
  }

  const variants = node.anyOf ?? node.oneOf;

  if (variants !== undefined) {
    return variants.map(printNode).join(" | ");
  }

  // `type` is one name or a list of names; flattening covers both.
  const types = [node.type ?? []].flat();

  if (types.length > 0) {
    return types.map((member) => primitive(member, node)).join(" | ");
  }

  if (node.enum !== undefined) {
    return node.enum.map(literal).join(" | ");
  }

  return "unknown";
};

/** Prints a TypeScript type for a JSON Schema fragment; `unknown` when unsure. */
export const typeOf = (schema: JsonSchema.JsonSchema): string =>
  Option.match(parseNode(schema), {
    onNone: () => "unknown",
    onSome: printNode,
  });

const definitions = (
  schema: JsonSchema.JsonSchema
): readonly (readonly [string, JsonSchemaNode])[] =>
  Option.match(parseNode(schema), {
    onNone: () => [],
    onSome: (node) => Object.entries(node.$defs ?? {}),
  });

const docComment = (lines: readonly string[]): string =>
  ["/**", ...lines.map((line) => ` * ${line}`), " */"].join("\n");

/** One capability as a member of the `tools` object. */
export const signatureOf = (entry: CatalogEntry): string => {
  const notes = [entry.description];

  if (entry.annotations.readOnly) {
    notes.push("Read-only.");
  }

  if (entry.annotations.destructive) {
    notes.push("Destructive: may irreversibly change state.");
  }

  if (entry.needsApproval) {
    notes.push("Needs approval before it runs.");
  }

  const failure = typeOf(entry.failure);

  if (failure !== "never") {
    notes.push(`@throws ${failure}`);
  }

  return `${docComment(notes)}\nreadonly ${quoteKey(entry.name)}: (input: ${typeOf(entry.input)}) => Promise<${typeOf(entry.output)}>;`;
};

/** The `.d.ts` a sandboxed program can rely on: named failures, then `tools`. */
export const toTypeScript = (catalog: Catalog): string => {
  const named = new Map<string, JsonSchemaNode>();

  for (const entry of catalog.capabilities) {
    for (const [name, schema] of [
      ...definitions(entry.input),
      ...definitions(entry.output),
      ...definitions(entry.failure),
    ]) {
      named.set(name, schema);
    }
  }

  const aliases = [...named].map(
    ([name, node]) => `type ${name} = ${printNode(node)};`
  );

  const members = catalog.capabilities.map((entry) =>
    signatureOf(entry)
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n")
  );

  return [...aliases, "declare const tools: {", ...members, "};", ""].join(
    "\n"
  );
};

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

const tokens = (text: string): readonly string[] =>
  text
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 1);

export interface SearchMatch {
  readonly name: string;
  readonly description: string;
  readonly score: number;
  readonly signature: string;
}

/**
 * Token overlap between the query and each capability's name, description,
 * and input field names. Deterministic and dependency-free; a real deployment
 * can swap in embeddings behind the same shape.
 */
export const searchCatalog = (
  catalog: Catalog,
  query: string,
  limit = 5
): readonly SearchMatch[] => {
  const wanted = new Set(tokens(query));

  const scored = catalog.capabilities.map((entry) => {
    const fields = Option.match(parseNode(entry.input), {
      onNone: () => [],
      onSome: (node) => Object.keys(node.properties ?? {}),
    });

    const haystack = [
      ...tokens(entry.name).map((token) => [token, 3] as const),
      ...tokens(entry.description).map((token) => [token, 1] as const),
      ...fields.flatMap((field) =>
        tokens(field).map((token) => [token, 2] as const)
      ),
    ];

    let score = 0;

    for (const [token, weight] of haystack) {
      if (wanted.has(token)) {
        score += weight;
      }
    }

    return {
      description: entry.description,
      name: entry.name,
      score,
      signature: signatureOf(entry),
    };
  });

  return scored
    .filter((match) => wanted.size === 0 || match.score > 0)
    .toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit);
};
