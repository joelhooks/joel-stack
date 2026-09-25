import { Schema } from "effect";

export class ContentBuildError extends Schema.TaggedError<ContentBuildError>()(
  "ContentBuildError",
  {
    cause: Schema.Defect(),
    sourcePath: Schema.String,
    stage: Schema.String,
  }
) {
  override get message() {
    return `${this.stage} failed for ${this.sourcePath}`;
  }
}

export const buildError = (stage: string, sourcePath: string, cause: unknown) =>
  new ContentBuildError({ cause, sourcePath, stage });

export interface LorePageMetadata {
  readonly description: string;
  readonly routePath: `/lore/${string}`;
  readonly slug: string;
  readonly sourcePath: string;
  readonly sources: readonly string[];
  readonly title: string;
}

const loreFrontmatterSchema = Schema.Struct({
  description: Schema.String,
  sources: Schema.Array(Schema.String),
  title: Schema.String,
});

const loreScalar = (frontmatter: string, field: string) => {
  const match = new RegExp(
    `^${field}:[ \\t]*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<plain>[^\\r\\n]+))$`,
    "mu"
  ).exec(frontmatter);

  return match?.groups?.double ?? match?.groups?.single ?? match?.groups?.plain;
};

const loreSources = (frontmatter: string, sourcePath: string) => {
  const line = /^sources:[ \t]*(?<inline>.*)$/mu.exec(frontmatter);
  const inline = line?.groups?.inline?.trim();

  if (inline === "[]") {
    return [];
  }

  if (inline !== "") {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("sources must be an HTTPS URL list or an empty list")
    );
  }

  return [...frontmatter.matchAll(/^[ \t]{2}-[ \t]*(?<url>.+?)[ \t]*$/gmu)].map(
    (match) => match.groups?.url ?? ""
  );
};

export const parseLorePage = (
  sourcePath: string,
  rawText: string
): LorePageMetadata => {
  const filename = sourcePath.split("/").at(-1) ?? "";
  const slug = filename.endsWith(".svx") ? filename.slice(0, -4) : "";

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("lore filename must be a lowercase kebab-case .svx slug")
    );
  }

  const block =
    /^---[ \t]*\r?\n(?<frontmatter>[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(
      rawText
    )?.groups?.frontmatter;

  if (block === undefined) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("missing YAML frontmatter")
    );
  }

  let decoded: typeof loreFrontmatterSchema.Type;

  try {
    decoded = Schema.decodeUnknownSync(loreFrontmatterSchema)({
      description: loreScalar(block, "description"),
      sources: loreSources(block, sourcePath),
      title: loreScalar(block, "title"),
    });
  } catch (error) {
    if (Schema.is(ContentBuildError)(error)) {
      throw error;
    }

    throw buildError("frontmatter", sourcePath, error);
  }

  if (decoded.title.trim() === "" || decoded.description.trim() === "") {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("title and description must not be empty")
    );
  }

  const sentencePunctuation = decoded.description.match(/[.!?](?=\s|$)/gu);

  if (sentencePunctuation?.length !== 1) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("description must be one sentence ending in punctuation")
    );
  }

  for (const source of decoded.sources) {
    let parsed: URL;

    try {
      parsed = new URL(source);
    } catch (error) {
      throw buildError("frontmatter", sourcePath, error);
    }

    if (parsed.protocol !== "https:") {
      throw buildError(
        "frontmatter",
        sourcePath,
        new Error(`source must be a public HTTPS URL: ${source}`)
      );
    }
  }

  return {
    ...decoded,
    routePath: `/lore/${slug}`,
    slug,
    sourcePath,
  };
};

export const loreLinkTargets = (
  sourcePath: string,
  markdown: string,
  knownRoutes: ReadonlySet<string>
): readonly string[] => {
  const body = markdown
    .replaceAll(/```[\s\S]*?```/gu, "")
    .replaceAll(/`[^`\n]+`/gu, "");

  const targets = new Set<string>();
  const links = /\[[^\]]+\]\((?<href>\/lore\/[^)\s]+)(?:\s+[^)]*)?\)/gu;

  for (const match of body.matchAll(links)) {
    const href = match.groups?.href;

    if (href === undefined) {
      continue;
    }

    const route = href.split(/[?#]/u, 1)[0] ?? href;

    if (!knownRoutes.has(route)) {
      throw buildError(
        "lore link",
        sourcePath,
        new Error(`linked lore page does not exist: ${route}`)
      );
    }

    targets.add(route);
  }

  return [...targets];
};

const audienceTag =
  /<(?:AgentOnly|HumanOnly|Diagram)(?:\s[^>]*)?>|<\/(?:AgentOnly|HumanOnly|Diagram)>/u;

const agentBlock =
  /<AgentOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/AgentOnly>/gu;

const humanBlock =
  /<HumanOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/HumanOnly>/gu;

const diagramBlock =
  /<Diagram\s+alt="(?<alt>[^"]*)">\s*\r?\n(?<fence>```text\r?\n[\s\S]*?\r?\n```)\s*\r?\n<\/Diagram>/gu;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const deriveAgentMarkdown = (source: string): string => {
  if (!audienceTag.test(source)) {
    return source;
  }

  const withoutHuman = source.replaceAll(humanBlock, "");

  const withDiagramText = withoutHuman.replaceAll(
    diagramBlock,
    (_match: string, alt: string, fence: string) => `${fence}\nDiagram: ${alt}`
  );

  return withDiagramText.replaceAll(agentBlock, "$<content>");
};

export const deriveHtmlMarkdown = (source: string): string => {
  if (!audienceTag.test(source)) {
    return source;
  }

  const withDiagrams = source.replaceAll(
    diagramBlock,
    (_match: string, alt: string, fence: string) =>
      `<figure role="img" aria-label="${escapeHtml(alt)}">\n\n${fence}\n\n<figcaption>${escapeHtml(alt)}</figcaption></figure>`
  );

  const withoutAgent = withDiagrams.replaceAll(agentBlock, "");

  return withoutAgent.replaceAll(humanBlock, "$<content>");
};

export const hasAudienceSyntax = (source: string) => audienceTag.test(source);

interface IcoImage {
  readonly bytes: Uint8Array;
  readonly size: number;
}

export const encodeIco = (images: readonly IcoImage[]): Uint8Array => {
  const headerSize = 6 + images.length * 16;

  const total = images.reduce(
    (length, image) => length + image.bytes.length,
    headerSize
  );

  const ico = new Uint8Array(total);
  const view = new DataView(ico.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerSize;

  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    view.setUint8(entry, image.size % 256);
    view.setUint8(entry + 1, image.size % 256);
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, image.bytes.length, true);
    view.setUint32(entry + 12, offset, true);
    ico.set(image.bytes, offset);
    offset += image.bytes.length;
  }

  return ico;
};
