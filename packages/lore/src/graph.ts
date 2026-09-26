import { Schema } from "effect";

export const LoreGroupSchema = Schema.Literals([
  "idea",
  "concept",
  "source",
  "person",
]);

export const LorePageReferenceSchema = Schema.Struct({
  group: Schema.String,
  id: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

export const LoreNodeSchema = Schema.Struct({
  description: Schema.String,
  group: LoreGroupSchema,
  id: Schema.String,
  slug: Schema.String,
  terms: Schema.Array(Schema.String),
  title: Schema.String,
  url: Schema.String,
});

export const LoreEdgeKindSchema = Schema.Literals([
  "link",
  "citation",
  "mention",
]);

export const LoreEdgeSchema = Schema.Struct({
  excerpt: Schema.optional(Schema.String),
  from: LorePageReferenceSchema,
  kind: LoreEdgeKindSchema,
  to: LorePageReferenceSchema,
});

export const LoreGraphSnapshotSchema = Schema.Struct({
  edges: Schema.Array(LoreEdgeSchema),
  nodes: Schema.Array(LoreNodeSchema),
});

export const LoreBacklinksSchema = Schema.Struct({
  backlinks: Schema.Array(
    Schema.Struct({
      kind: LoreEdgeKindSchema,
      page: LorePageReferenceSchema,
    })
  ),
});

export const LoreNeighborsSchema = Schema.Struct({
  neighbors: Schema.Array(
    Schema.Struct({
      distance: Schema.Finite,
      node: LoreNodeSchema,
    })
  ),
});

export const LoreMentionsSchema = Schema.Struct({
  mentions: Schema.Array(
    Schema.Struct({
      excerpt: Schema.String,
      page: LorePageReferenceSchema,
    })
  ),
});

export const LorePathSchema = Schema.Struct({
  edges: Schema.Array(LoreEdgeSchema),
  nodes: Schema.Array(LoreNodeSchema),
});

export type LoreGroup = typeof LoreGroupSchema.Type;

export type LorePageReference = typeof LorePageReferenceSchema.Type;

export type LoreNode = typeof LoreNodeSchema.Type;

export type LoreEdgeKind = typeof LoreEdgeKindSchema.Type;

export type LoreEdge = typeof LoreEdgeSchema.Type;

export type LoreGraphSnapshot = typeof LoreGraphSnapshotSchema.Type;

export type LoreBacklinks = typeof LoreBacklinksSchema.Type;

export type LoreNeighbors = typeof LoreNeighborsSchema.Type;

export type LoreMentions = typeof LoreMentionsSchema.Type;

export type LorePath = typeof LorePathSchema.Type;

export interface LoreBuildPage {
  readonly group: string;
  readonly id: string;
  readonly routePath: string;
  readonly text: string;
  readonly title: string;
  readonly url: string;
  readonly wovenLinks?: readonly {
    readonly target: string;
    readonly term: string;
  }[];
  readonly lore?: {
    readonly description: string;
    readonly group: LoreGroup;
    readonly slug: string;
    readonly sourceUrl?: string;
    readonly sources: readonly string[];
    readonly terms: readonly string[];
  };
}

export interface LoreBuildLink {
  readonly from: string;
  readonly to: string;
}

export interface BuildLoreGraphInput {
  readonly links: readonly LoreBuildLink[];
  readonly pages: readonly LoreBuildPage[];
}

const canonicalSource = (value: string) => {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";

    return url.toString().replace(/\/$/u, "");
  } catch {
    return value;
  }
};

const escapedRegex = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const withoutMarkdownLinks = (value: string) =>
  value
    .replaceAll(/\[[^\]]*\]\([^)]*\)/gu, (match) => " ".repeat(match.length))
    .replaceAll(/<a\b[^>]*>[\s\S]*?<\/a>/giu, (match) =>
      " ".repeat(match.length)
    );

const textWithoutFrontmatter = (value: string) =>
  value.replace(/^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/u, "");

const excerptAround = (text: string, index: number) => {
  const start = Math.max(0, index - 90);
  const end = Math.min(text.length, start + 220);
  const excerpt = text.slice(start, end).replaceAll(/\s+/gu, " ").trim();

  return `${start > 0 ? "…" : ""}${excerpt}${end < text.length ? "…" : ""}`;
};

const mentionIn = (page: LoreBuildPage, target: LoreNode) => {
  if (target.terms.length === 0) {
    return null;
  }

  const body = textWithoutFrontmatter(page.text);
  const searchable = withoutMarkdownLinks(body);

  const terms = target.terms.toSorted(
    (left, right) => right.length - left.length || left.localeCompare(right)
  );

  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}_])(?<term>${terms.map(escapedRegex).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu"
  );

  const wovenCounts = new Map<string, number>();

  for (const woven of page.wovenLinks ?? []) {
    if (woven.target !== `/lore/${target.slug}`) {
      continue;
    }

    const key = woven.term.toLowerCase();
    wovenCounts.set(key, (wovenCounts.get(key) ?? 0) + 1);
  }

  for (const match of searchable.matchAll(pattern)) {
    const { groups, index } = match;
    const term = groups?.term;

    if (term === undefined) {
      continue;
    }

    const key = term.toLowerCase();
    const wovenCount = wovenCounts.get(key) ?? 0;

    if (wovenCount > 0) {
      wovenCounts.set(key, wovenCount - 1);
      continue;
    }

    return excerptAround(body, index);
  }

  return null;
};

const pageReference = (page: LoreBuildPage): LorePageReference => ({
  group: page.lore?.group ?? page.group,
  id: page.lore === undefined ? page.id : `ratstack://lore/${page.lore.slug}`,
  title: page.title,
  url: page.url,
});

const edgeKey = (edge: LoreEdge) =>
  `${edge.from.id}\u0000${edge.kind}\u0000${edge.to.id}`;

export const buildLoreGraph = ({
  links,
  pages,
}: BuildLoreGraphInput): LoreGraphSnapshot => {
  const nodes = pages
    .flatMap((page) =>
      page.lore === undefined
        ? []
        : [
            {
              description: page.lore.description,
              group: page.lore.group,
              id: `ratstack://lore/${page.lore.slug}`,
              slug: page.lore.slug,
              terms: [...page.lore.terms],
              title: page.title,
              url: page.url,
            },
          ]
    )
    .toSorted((left, right) => left.slug.localeCompare(right.slug));

  const pagesByRoute = new Map(pages.map((page) => [page.routePath, page]));
  const nodesBySourceUrl = new Map<string, LoreBuildPage>();
  const edges = new Map<string, LoreEdge>();

  for (const page of pages) {
    if (page.lore?.sourceUrl !== undefined) {
      nodesBySourceUrl.set(canonicalSource(page.lore.sourceUrl), page);
    }
  }

  for (const link of links) {
    const from = pagesByRoute.get(link.from);
    const to = pagesByRoute.get(link.to);

    if (from === undefined || to === undefined) {
      continue;
    }

    const edge: LoreEdge = {
      from: pageReference(from),
      kind: "link",
      to: pageReference(to),
    };

    edges.set(edgeKey(edge), edge);
  }

  for (const page of pages) {
    if (page.lore === undefined) {
      continue;
    }

    const from = pageReference(page);

    for (const source of page.lore.sources) {
      const sourcePage = nodesBySourceUrl.get(canonicalSource(source));

      const to =
        sourcePage === undefined
          ? {
              group: "external source",
              id: source,
              title: source,
              url: source,
            }
          : pageReference(sourcePage);

      const edge: LoreEdge = { from, kind: "citation", to };

      edges.set(edgeKey(edge), edge);
    }
  }

  for (const page of pages) {
    const from = pageReference(page);

    for (const target of nodes) {
      if (from.id === target.id) {
        continue;
      }

      const excerpt = mentionIn(page, target);

      if (excerpt === null) {
        continue;
      }

      const edge: LoreEdge = {
        excerpt,
        from,
        kind: "mention",
        to: {
          group: target.group,
          id: target.id,
          title: target.title,
          url: target.url,
        },
      };

      edges.set(edgeKey(edge), edge);
    }
  }

  return {
    edges: [...edges.values()].toSorted(
      (left, right) =>
        left.to.id.localeCompare(right.to.id) ||
        left.from.id.localeCompare(right.from.id) ||
        left.kind.localeCompare(right.kind)
    ),
    nodes,
  };
};
