import { NoPath, UnknownPage } from "@rat-stack/core/contracts";
import { Context, Effect, Layer } from "effect";

import type {
  LoreBacklinks,
  LoreEdge,
  LoreGraphSnapshot,
  LoreMentions,
  LoreNeighbors,
  LoreNode,
  LorePath,
} from "./graph.js";

export interface LoreGraphService {
  readonly backlinks: (
    slug: string
  ) => Effect.Effect<LoreBacklinks, UnknownPage>;
  readonly mentions: (slug: string) => Effect.Effect<LoreMentions, UnknownPage>;
  readonly neighbors: (
    slug: string,
    depth: 1 | 2
  ) => Effect.Effect<LoreNeighbors, UnknownPage>;
  readonly path: (
    from: string,
    to: string
  ) => Effect.Effect<LorePath, UnknownPage | NoPath>;
}

interface NeighborLink {
  readonly edge: LoreEdge;
  readonly node: LoreNode;
}

const pathDepthLimit = 12;

const makeLoreGraph = (snapshot: LoreGraphSnapshot): LoreGraphService => {
  const nodesBySlug = new Map(snapshot.nodes.map((node) => [node.slug, node]));
  const nodesById = new Map(snapshot.nodes.map((node) => [node.id, node]));

  const adjacency = new Map<string, NeighborLink[]>(
    snapshot.nodes.map((node) => [node.id, []])
  );

  for (const edge of snapshot.edges) {
    const from = nodesById.get(edge.from.id);
    const to = nodesById.get(edge.to.id);

    if (from === undefined || to === undefined) {
      continue;
    }

    adjacency.get(from.id)?.push({ edge, node: to });

    if (from.id !== to.id) {
      adjacency.get(to.id)?.push({ edge, node: from });
    }
  }

  for (const [id, links] of adjacency) {
    adjacency.set(
      id,
      links.toSorted(
        (left, right) =>
          left.node.slug.localeCompare(right.node.slug) ||
          left.edge.kind.localeCompare(right.edge.kind)
      )
    );
  }

  const backlinks = Effect.fn("LoreGraph.backlinks")(function* backlinks(
    slug: string
  ) {
    const node = nodesBySlug.get(slug);

    if (node === undefined) {
      return yield* new UnknownPage({
        message: `No lore page has slug ${slug}`,
        slug,
      });
    }

    return {
      backlinks: snapshot.edges
        .filter((edge) => edge.to.id === node.id)
        .map((edge) => ({ kind: edge.kind, page: edge.from }))
        .toSorted(
          (left, right) =>
            left.page.group.localeCompare(right.page.group) ||
            left.page.title.localeCompare(right.page.title) ||
            left.kind.localeCompare(right.kind) ||
            left.page.id.localeCompare(right.page.id)
        ),
    };
  });

  const mentions = Effect.fn("LoreGraph.mentions")(function* mentions(
    slug: string
  ) {
    const node = nodesBySlug.get(slug);

    if (node === undefined) {
      return yield* new UnknownPage({
        message: `No lore page has slug ${slug}`,
        slug,
      });
    }

    return {
      mentions: snapshot.edges
        .filter((edge) => edge.kind === "mention" && edge.to.id === node.id)
        .map((edge) => ({ excerpt: edge.excerpt ?? "", page: edge.from }))
        .toSorted(
          (left, right) =>
            left.page.group.localeCompare(right.page.group) ||
            left.page.title.localeCompare(right.page.title) ||
            left.page.id.localeCompare(right.page.id)
        ),
    };
  });

  const neighbors = Effect.fn("LoreGraph.neighbors")(function* neighbors(
    slug: string,
    depth: 1 | 2
  ) {
    const node = nodesBySlug.get(slug);

    if (node === undefined) {
      return yield* new UnknownPage({
        message: `No lore page has slug ${slug}`,
        slug,
      });
    }

    const distances = new Map<string, number>([[node.id, 0]]);
    const queue = [node.id];
    let cursor = 0;

    while (cursor < queue.length) {
      const currentId = queue[cursor];
      cursor += 1;

      if (currentId === undefined) {
        continue;
      }

      const currentDistance = distances.get(currentId) ?? 0;

      if (currentDistance >= depth) {
        continue;
      }

      for (const link of adjacency.get(currentId) ?? []) {
        if (distances.has(link.node.id)) {
          continue;
        }

        distances.set(link.node.id, currentDistance + 1);
        queue.push(link.node.id);
      }
    }

    return {
      neighbors: [...distances.entries()]
        .flatMap(([id, distance]) => {
          const neighbor = nodesById.get(id);

          return neighbor === undefined || distance === 0
            ? []
            : [{ distance, node: neighbor }];
        })
        .toSorted(
          (left, right) =>
            left.distance - right.distance ||
            left.node.slug.localeCompare(right.node.slug)
        ),
    };
  });

  const path = Effect.fn("LoreGraph.path")(function* path(
    fromSlug: string,
    toSlug: string
  ) {
    const from = nodesBySlug.get(fromSlug);

    if (from === undefined) {
      return yield* new UnknownPage({
        message: `No lore page has slug ${fromSlug}`,
        slug: fromSlug,
      });
    }

    const to = nodesBySlug.get(toSlug);

    if (to === undefined) {
      return yield* new UnknownPage({
        message: `No lore page has slug ${toSlug}`,
        slug: toSlug,
      });
    }

    const previous = new Map<
      string,
      { readonly edge: LoreEdge; readonly from: string }
    >();

    const distances = new Map<string, number>([[from.id, 0]]);
    const visited = new Set([from.id]);
    const queue = [from.id];
    let cursor = 0;

    while (cursor < queue.length && !visited.has(to.id)) {
      const currentId = queue[cursor];
      cursor += 1;

      if (currentId === undefined) {
        continue;
      }

      const currentDistance = distances.get(currentId) ?? 0;

      if (currentDistance >= pathDepthLimit) {
        continue;
      }

      for (const link of adjacency.get(currentId) ?? []) {
        if (visited.has(link.node.id)) {
          continue;
        }

        visited.add(link.node.id);
        distances.set(link.node.id, currentDistance + 1);
        previous.set(link.node.id, { edge: link.edge, from: currentId });
        queue.push(link.node.id);
      }
    }

    if (!visited.has(to.id)) {
      return yield* new NoPath({
        from: fromSlug,
        message: `No lore path connects ${fromSlug} to ${toSlug}`,
        to: toSlug,
      });
    }

    const nodes: LoreNode[] = [to];
    const edges: LoreEdge[] = [];
    let currentId = to.id;

    while (currentId !== from.id) {
      const step = previous.get(currentId);

      if (step === undefined) {
        return yield* new NoPath({
          from: fromSlug,
          message: `No lore path connects ${fromSlug} to ${toSlug}`,
          to: toSlug,
        });
      }

      const previousNode = nodesById.get(step.from);

      if (previousNode === undefined) {
        return yield* new NoPath({
          from: fromSlug,
          message: `No lore path connects ${fromSlug} to ${toSlug}`,
          to: toSlug,
        });
      }

      edges.push(step.edge);
      nodes.push(previousNode);
      currentId = step.from;
    }

    return {
      edges: edges.toReversed(),
      nodes: nodes.toReversed(),
    };
  });

  return { backlinks, mentions, neighbors, path };
};

export class LoreGraph extends Context.Service<LoreGraph, LoreGraphService>()(
  "@rat-stack/lore/LoreGraph"
) {
  static layer(snapshot: LoreGraphSnapshot) {
    return Layer.succeed(this, this.of(makeLoreGraph(snapshot)));
  }
}
