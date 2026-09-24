import { Predicate } from "effect";
import type { JsonSchema } from "effect";
import { Tool } from "effect/unstable/ai";

import type { InputSchema } from "./contract.js";

export const inputJsonSchemaOf = (
  input: InputSchema
): JsonSchema.JsonSchema => {
  const schema = Tool.getJsonSchemaFromSchema(input);

  if (Object.keys(input.fields).length !== 0) {
    return schema;
  }

  const nullGuard = schema.not;

  if (
    Predicate.isObject(nullGuard) &&
    Object.keys(nullGuard).length === 1 &&
    "type" in nullGuard &&
    nullGuard.type === "null"
  ) {
    delete schema.not;
  }

  return { ...schema, properties: {}, type: "object" };
};
