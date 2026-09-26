import { implement } from "@rat-stack/capability/implement";
import {
  backlinksContract,
  mentionsContract,
  neighborsContract,
  pathContract,
} from "@rat-stack/core/contracts";
import { LoreGraph } from "@rat-stack/lore";

export const backlinks = implement(backlinksContract, ({ slug }) =>
  LoreGraph.use((graph) => graph.backlinks(slug))
);

export const neighbors = implement(neighborsContract, ({ depth, slug }) =>
  LoreGraph.use((graph) => graph.neighbors(slug, depth))
);

export const mentions = implement(mentionsContract, ({ slug }) =>
  LoreGraph.use((graph) => graph.mentions(slug))
);

export const path = implement(pathContract, ({ from, to }) =>
  LoreGraph.use((graph) => graph.path(from, to))
);
