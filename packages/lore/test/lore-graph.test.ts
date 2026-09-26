import { expect, it } from "@effect/vitest";
import { Effect } from "effect";

import {
  buildLoreGraph,
  LoreGraph,
  NoPath,
  UnknownPage,
} from "../src/index.js";
import type { LoreBuildPage } from "../src/index.js";

const lorePage = (
  slug: string,
  terms: readonly string[],
  options: {
    readonly group?: "idea" | "concept" | "source" | "person";
    readonly sources?: readonly string[];
    readonly sourceUrl?: string;
    readonly text?: string;
  } = {}
): LoreBuildPage => {
  const lore = {
    description: `Description for ${slug}`,
    group: options.group ?? "concept",
    slug,
    sources: options.sources ?? [],
    terms,
  };

  const page = {
    group: "Lore",
    id: `ratstack://lore/${slug}`,
    routePath: `/lore/${slug}`,
    text: options.text ?? "",
    title: slug,
    url: `https://ratstack.sh/lore/${slug}`,
  };

  if (options.sourceUrl === undefined) {
    return { ...page, lore };
  }

  return { ...page, lore: { ...lore, sourceUrl: options.sourceUrl } };
};

const sourcePage = (
  routePath: string,
  id: string,
  title: string,
  text: string,
  wovenLinks: LoreBuildPage["wovenLinks"] = []
): LoreBuildPage => ({
  group: "Source file",
  id,
  routePath,
  text,
  title,
  url: `https://ratstack.sh${routePath}`,
  wovenLinks,
});

it.effect("returns backlinks from non-lore pages with the source group", () => {
  const snapshot = buildLoreGraph({
    links: [{ from: "/VISION.md", to: "/lore/cartridges" }],
    pages: [
      lorePage("cartridges", ["cartridge"]),
      sourcePage(
        "/VISION.md",
        "ratstack://repo/VISION.md",
        "VISION.md",
        "This design keeps packages removable."
      ),
    ],
  });

  return Effect.gen(function* testBacklinks() {
    const graph = yield* LoreGraph;
    const result = yield* graph.backlinks("cartridges");

    expect(result.backlinks).toEqual([
      {
        kind: "link",
        page: {
          group: "Source file",
          id: "ratstack://repo/VISION.md",
          title: "VISION.md",
          url: "https://ratstack.sh/VISION.md",
        },
      },
    ]);
  }).pipe(Effect.provide(LoreGraph.layer(snapshot)));
});

it.effect(
  "records unlinked mentions after the weave first-link rule and cap",
  () => {
    const targets = Array.from({ length: 13 }, (_, index) =>
      lorePage(`signal-${index + 1}`, [`signal ${index + 1}`])
    );

    const targetTerms = targets.map((page) => page.lore?.terms[0] ?? "");

    const wovenLinks = targets.slice(0, 12).map((page) => ({
      target: page.routePath,
      term: page.lore?.terms[0] ?? "",
    }));

    const source = sourcePage(
      "/home",
      "ratstack://page/home",
      "Home",
      [...targetTerms, targetTerms[0] ?? ""].join(" then "),
      wovenLinks
    );

    const snapshot = buildLoreGraph({
      links: targets.slice(0, 12).map((page) => ({
        from: source.routePath,
        to: page.routePath,
      })),
      pages: [...targets, source],
    });

    return Effect.gen(function* testCappedMentions() {
      const graph = yield* LoreGraph;
      const repeated = yield* graph.mentions("signal-1");
      const afterCap = yield* graph.mentions("signal-13");

      const linkToAfterCap = snapshot.edges.find(
        (edge) =>
          edge.kind === "link" && edge.to.id === "ratstack://lore/signal-13"
      );

      expect(repeated.mentions).toHaveLength(1);
      expect(repeated.mentions[0]?.excerpt).toContain("signal 1");
      expect(afterCap.mentions).toHaveLength(1);
      expect(linkToAfterCap).toBeUndefined();
    }).pipe(Effect.provide(LoreGraph.layer(snapshot)));
  }
);

it.effect("finds unique incoming and outgoing neighbors at depth two", () => {
  const snapshot = buildLoreGraph({
    links: [
      { from: "/lore/a", to: "/lore/b" },
      { from: "/lore/a", to: "/lore/c" },
      { from: "/lore/b", to: "/lore/d" },
      { from: "/lore/c", to: "/lore/d" },
    ],
    pages: [
      lorePage("a", ["alpha"]),
      lorePage("b", ["bravo"]),
      lorePage("c", ["charlie"]),
      lorePage("d", ["delta"]),
    ],
  });

  return Effect.gen(function* testNeighbors() {
    const graph = yield* LoreGraph;
    const result = yield* graph.neighbors("a", 2);

    expect(
      result.neighbors.map(({ node, distance }) => [node.slug, distance])
    ).toEqual([
      ["b", 1],
      ["c", 1],
      ["d", 2],
    ]);
  }).pipe(Effect.provide(LoreGraph.layer(snapshot)));
});

it.effect(
  "returns shortest paths and reports paths beyond the depth limit",
  () => {
    const longChain = Array.from({ length: 14 }, (_, index) =>
      lorePage(`limit-${index}`, [`limit ${index}`])
    );

    const longChainLinks = Array.from({ length: 13 }, (_, index) => ({
      from: `/lore/limit-${index}`,
      to: `/lore/limit-${index + 1}`,
    }));

    const snapshot = buildLoreGraph({
      links: [
        { from: "/lore/a", to: "/lore/b" },
        { from: "/lore/a", to: "/lore/c" },
        { from: "/lore/b", to: "/lore/d" },
        { from: "/lore/c", to: "/lore/d" },
        ...longChainLinks,
      ],
      pages: [
        lorePage("a", ["alpha"], { sourceUrl: "https://source.test/a" }),
        lorePage("b", ["bravo"], {
          sources: ["https://source.test/a?time=3"],
        }),
        lorePage("c", ["charlie"]),
        lorePage("d", ["delta"]),
        lorePage("island", ["island"]),
        ...longChain,
      ],
    });

    return Effect.gen(function* testPaths() {
      const graph = yield* LoreGraph;
      const result = yield* graph.path("a", "d");
      const noPath = yield* graph.path("a", "island").pipe(Effect.flip);

      const boundedPath = yield* graph
        .path("limit-0", "limit-13")
        .pipe(Effect.flip);

      expect(result.nodes.map((node) => node.slug)).toEqual(["a", "b", "d"]);
      expect(result.edges.map((edge) => edge.kind)).toEqual([
        "citation",
        "link",
      ]);
      expect(noPath).toBeInstanceOf(NoPath);
      expect(noPath).toMatchObject({ from: "a", to: "island" });
      expect(boundedPath).toBeInstanceOf(NoPath);
      expect(boundedPath).toMatchObject({ from: "limit-0", to: "limit-13" });
    }).pipe(Effect.provide(LoreGraph.layer(snapshot)));
  }
);

it.effect("returns UnknownPage for every query", () => {
  const snapshot = buildLoreGraph({
    links: [],
    pages: [lorePage("known", ["known"])],
  });

  return Effect.gen(function* testUnknownPage() {
    const graph = yield* LoreGraph;
    const backlinks = yield* graph.backlinks("missing").pipe(Effect.flip);
    const neighbors = yield* graph.neighbors("missing", 1).pipe(Effect.flip);
    const mentions = yield* graph.mentions("missing").pipe(Effect.flip);
    const path = yield* graph.path("missing", "also-missing").pipe(Effect.flip);

    for (const failure of [backlinks, neighbors, mentions, path]) {
      expect(failure).toBeInstanceOf(UnknownPage);
      expect(failure).toMatchObject({ slug: "missing" });
    }
  }).pipe(Effect.provide(LoreGraph.layer(snapshot)));
});
