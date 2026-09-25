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

export interface DebtEntry {
  readonly directive: string;
  readonly file: string;
  readonly kind: string;
  readonly line: number;
  readonly reason: string | undefined;
}

const DebtKind = Schema.Literals([
  "effect-diagnostics",
  "oxlint",
  "typescript",
]);

const DebtDiagnosticPayload = Schema.Struct({
  directive: Schema.String,
  kind: DebtKind,
  reason: Schema.optional(Schema.String),
});

const DebtLintSpan = Schema.Struct({
  column: Schema.Finite,
  length: Schema.Finite,
  line: Schema.Finite,
  offset: Schema.Finite,
});

const DebtLintDiagnostic = Schema.Struct({
  code: Schema.String,
  filename: Schema.String,
  labels: Schema.Array(Schema.Struct({ span: DebtLintSpan })),
  message: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
});

const DebtLintOutput = Schema.Struct({
  diagnostics: Schema.Array(DebtLintDiagnostic),
  number_of_files: Schema.Finite,
  number_of_rules: Schema.Finite,
  start_time: Schema.Finite,
  threads_count: Schema.Finite,
});

export interface DebtLintResult {
  readonly entries: readonly DebtEntry[];
  readonly fileCount: number;
  readonly ruleCount: number;
}

export const assertSkillGroups = (
  skillNames: readonly string[],
  groups: readonly { readonly names: readonly string[] }[]
): void => {
  const groupedNames = new Set(groups.flatMap((group) => group.names));

  const ungrouped = skillNames
    .toSorted()
    .find((name) => !groupedNames.has(name));

  if (ungrouped !== undefined) {
    throw buildError(
      "skill grouping",
      `skills/${ungrouped}/SKILL.md`,
      new Error(`Skill ${ungrouped} does not belong to a home-page group`)
    );
  }
};

export const isDebtSourcePath = (file: string) => {
  const segments = file.split("/");

  const excludedSegments = new Set([
    ".agent_sources",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "generated",
    "node_modules",
    "vendor",
  ]);

  if (
    segments.some((segment) => excludedSegments.has(segment)) ||
    file.startsWith("tools/oxlint/anti-slop/") ||
    /(?:\.generated|\.gen)\.[^.]+$/u.test(file)
  ) {
    return false;
  }

  const allowedRoot = /^(?:apps|packages|scripts|tools)\//u.test(file);
  const rootConfig = /^[^/]+\.config\.ts$/u.test(file);
  const sourceFile = /\.[cm]?[jt]sx?$/u.test(file);

  return sourceFile && (allowedRoot || rootConfig);
};

export const parseDebtLintOutput = (raw: string): DebtLintResult => {
  try {
    const output = Schema.decodeSync(Schema.fromJsonString(DebtLintOutput))(
      raw
    );

    const entries = output.diagnostics.map((diagnostic) => {
      if (diagnostic.code !== "rat-stack-debt(debt-ledger)") {
        throw new Error(`Unexpected lint rule: ${diagnostic.code}`);
      }

      const [label] = diagnostic.labels;

      if (label === undefined) {
        throw new Error(`Missing source location: ${diagnostic.filename}`);
      }

      const payload = Schema.decodeSync(
        Schema.fromJsonString(DebtDiagnosticPayload)
      )(diagnostic.message);

      return {
        directive: payload.directive,
        file: diagnostic.filename,
        kind: payload.kind,
        line: label.span.line,
        reason: payload.reason,
      };
    });

    return {
      entries: entries.toSorted(
        (left, right) =>
          left.file.localeCompare(right.file) ||
          left.line - right.line ||
          left.directive.localeCompare(right.directive)
      ),
      fileCount: output.number_of_files,
      ruleCount: output.number_of_rules,
    };
  } catch (error) {
    throw buildError("debt lint output", "oxlint JSON", error);
  }
};

const tableCell = (value: string) =>
  value.replaceAll("|", "\\|").replaceAll(/\s+/gu, " ").trim();

export const debtLedgerMarkdown = (entries: readonly DebtEntry[]) => {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }

  const countRows = [...counts]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `| ${kind} | ${count} |`);

  const rows = entries.map((entry) => {
    const link = `https://github.com/joelhooks/rat-stack/blob/main/${entry.file}#L${entry.line}`;
    const reason = entry.reason ?? "no reason given";

    return `| [${entry.file}:${entry.line}](${link}) | ${tableCell(entry.directive)} | ${tableCell(reason)} |`;
  });

  return [
    "# Debt ledger",
    "",
    '> "Debt only shrinks."',
    "",
    `Total: **${entries.length}** directives.`,
    "",
    "## Count by directive kind",
    "",
    "| Kind | Count |",
    "| --- | ---: |",
    ...countRows,
    "",
    "The vendored `tools/oxlint/anti-slop/` plugin is excluded. It is Dillon Mulroy's code, not our debt.",
    "",
    "## Every directive",
    "",
    "| File | Directive | Reason |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
};

const linkHrefs = (source: string) => {
  const body = source
    .replaceAll(/```[\s\S]*?```/gu, "")
    .replaceAll(/~~~[\s\S]*?~~~/gu, "")
    .replaceAll(/`[^`\n]+`/gu, "");

  const links = new Set<string>();

  const markdownLink =
    /\]\(\s*(?:<(?<angle>[^>]+)>|(?<plain>[^)\s]+))(?:\s+[^)]*)?\)/gu;

  const referenceLink =
    /^\s*\[[^\]]+\]:\s*(?:<(?<angle>[^>]+)>|(?<plain>\S+))/gmu;

  const htmlAttribute =
    /\b(?:href|src)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/giu;

  const autoLink = /<(?<url>(?:https?:)?\/\/[^>\s]+)>/giu;

  for (const match of body.matchAll(markdownLink)) {
    const href = match.groups?.angle ?? match.groups?.plain;

    if (href !== undefined) {
      links.add(href);
    }
  }

  for (const pattern of [referenceLink, htmlAttribute, autoLink]) {
    for (const match of body.matchAll(pattern)) {
      const href =
        match.groups?.angle ??
        match.groups?.plain ??
        match.groups?.double ??
        match.groups?.single ??
        match.groups?.url;

      if (href !== undefined) {
        links.add(href);
      }
    }
  }

  return [...links];
};

export const internalRouteForLink = (
  href: string,
  pageRoute: string,
  origin = "https://ratstack.sh"
): string | undefined => {
  try {
    const base = new URL(pageRoute, origin);
    const target = new URL(href, base);

    if (target.origin !== base.origin) {
      return undefined;
    }

    return target.pathname.length > 1
      ? target.pathname.replace(/\/$/u, "")
      : target.pathname;
  } catch {
    return undefined;
  }
};

export const validateInternalLinks = (options: {
  readonly knownRoutes: ReadonlySet<string>;
  readonly pageRoute: string;
  readonly sourcePath: string;
  readonly text: string;
}): void => {
  for (const href of linkHrefs(options.text)) {
    const route = internalRouteForLink(href, options.pageRoute);

    if (route !== undefined && !options.knownRoutes.has(route)) {
      throw buildError(
        `internal link ${href}`,
        options.sourcePath,
        new Error(`resolves to unserved route ${route}`)
      );
    }
  }
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
