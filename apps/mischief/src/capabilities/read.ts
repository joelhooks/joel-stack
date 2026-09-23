import { implement } from "@rat-stack/capability/implement";
import { readContract, ResourceNotFound } from "@rat-stack/core/contracts";
import { Effect } from "effect";

import { readContent } from "../content.js";

export const read = implement(readContract, ({ id }) => {
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
});
