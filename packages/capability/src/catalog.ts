// The catalog is the code-mode projection's wire form: every capability as
// JSON Schema (the same schemas MCP and OpenAPI publish), plus a TypeScript
// declaration of the `tools` object a sandboxed program sees, and a small
// ranked search over it. After Executor's kernel IR and Cloudflare's Code
// Mode: types are generated from JSON Schema, never from Effect internals.
import type { JsonSchema } from "effect";
import { Tool } from "effect/unstable/ai";

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
    failure: Tool.getJsonSchemaFromSchema(capability.failure),
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];

const quoteKey = (key: string): string =>
  /^[A-Za-z_$][\w$]*$/u.test(key) ? key : JSON.stringify(key);

const literal = (value: unknown): string => {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return JSON.stringify(value);
  }
  return value === null ? "null" : "unknown";
};

const refName = (ref: unknown): string | undefined =>
  typeof ref === "string" && ref.startsWith("#/$defs/")
    ? ref.slice("#/$defs/".length)
    : undefined;

const objectType = (schema: Record<string, unknown>): string => {
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = new Set(stringArray(schema.required));
  const members = Object.entries(properties).map(([key, value]) => {
    const optional = required.has(key) ? "" : "?";
    const description =
      isRecord(value) && typeof value.description === "string"
        ? `/** ${value.description} */ `
        : "";
    // typeOf and the object/primitive printers are mutually recursive.
    // oxlint-disable-next-line no-use-before-define
    return `${description}readonly ${quoteKey(key)}${optional}: ${typeOf(value)}`;
  });
  return members.length === 0 ? "{}" : `{ ${members.join("; ")} }`;
};

const primitive = (type: string, schema: Record<string, unknown>): string => {
  switch (type) {
    case "string": {
      const enumeration = Array.isArray(schema.enum) ? schema.enum : undefined;
      return enumeration === undefined
        ? "string"
        : enumeration.map(literal).join(" | ");
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
      // oxlint-disable-next-line no-use-before-define
      return `ReadonlyArray<${typeOf(schema.items)}>`;
    }
    case "object": {
      return objectType(schema);
    }
    default: {
      return "unknown";
    }
  }
};

/** Prints a TypeScript type for a JSON Schema fragment; `unknown` when unsure. */
export const typeOf = (schema: unknown): string => {
  if (!isRecord(schema)) {
    return "unknown";
  }
  const ref = refName(schema.$ref);
  if (ref !== undefined) {
    return ref;
  }
  if ("const" in schema) {
    return literal(schema.const);
  }
  if (isRecord(schema.not) && Object.keys(schema.not).length === 0) {
    return "never";
  }
  const variants = schema.anyOf ?? schema.oneOf;
  if (Array.isArray(variants)) {
    return variants.map(typeOf).join(" | ");
  }
  const { type } = schema;
  if (Array.isArray(type)) {
    return type.map((member) => primitive(String(member), schema)).join(" | ");
  }
  if (typeof type === "string") {
    return primitive(type, schema);
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map(literal).join(" | ");
  }
  return "unknown";
};

const definitions = (schema: unknown): readonly [string, unknown][] =>
  isRecord(schema) && isRecord(schema.$defs)
    ? Object.entries(schema.$defs)
    : [];

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
  const named = new Map<string, unknown>();
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
    ([name, schema]) => `type ${name} = ${typeOf(schema)};`
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
    const fields = isRecord(entry.input.properties)
      ? Object.keys(entry.input.properties)
      : [];
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
