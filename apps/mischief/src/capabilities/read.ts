import { defineCapability } from "@rat-stack/capability/define";
import { Effect, Schema } from "effect";

import { readContent } from "../content.js";
import { ReadOutput, ResourceNotFound } from "./schemas.js";

export const read = defineCapability("read", {
  annotations: {
    idempotent: true,
    readOnly: true,
  },
  description:
    "Read one exact rat-stack law or skill document by the resource id returned from search.",
  failure: ResourceNotFound,
  handler: ({ id }) => {
    const resource = readContent(id);

    if (resource === undefined) {
      return Effect.fail(
        new ResourceNotFound({
          id,
          message: `No rat-stack resource has id ${id}`,
        })
      );
    }

    return Effect.succeed(resource);
  },
  input: Schema.Struct({ id: Schema.String }),
  output: ReadOutput,
});
