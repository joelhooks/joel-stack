import { implement } from "@rat-stack/capability/implement";
import { searchContract } from "@rat-stack/core/contracts";
import { Effect } from "effect";

import { searchContent } from "../content.js";

export const search = implement(searchContract, ({ limit, query }) => {
  const matches = searchContent(query, limit);

  return Effect.succeed({
    matches,
    total: matches.length,
  });
});
