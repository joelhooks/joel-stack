// Build-only content generation needs the Node hashing implementation.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createHash } from "node:crypto";
// Build-only content generation needs direct repository filesystem access.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { readdir, readFile, writeFile } from "node:fs/promises";
// Build-only content generation resolves checked-in repository paths.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import path from "node:path";

import { Schema } from "effect";
import { Marked, Renderer } from "marked";

const here = import.meta.dirname;
const root = path.resolve(here, "../../..");
const output = path.join(here, "../src/bundled-content.generated.ts");

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const visibleMarkdown = (text: string) =>
  text.replace(/^---\n[\s\S]*?\n---\n?/u, "");

const slug = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

// `{@html}` does not sanitize. These inputs are trusted, checked-in repository
// files. If the source boundary widens, sanitize here before generating HTML.
const renderMarkdown = (source: string) => {
  const headings: { depth: number; id: string; text: string }[] = [];
  const used = new Map<string, number>();
  const renderer = new Renderer();

  renderer.heading = function heading({ depth, text, tokens }) {
    const base = slug(text) || "section";
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    const id = count === 0 ? base : `${base}-${count + 1}`;
    headings.push({ depth, id, text });
    return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>`;
  };

  const parser = new Marked({ gfm: true, renderer });
  const html = parser.parse(visibleMarkdown(source), { async: false });
  if (typeof html !== "string") {
    throw new TypeError("Expected synchronous Markdown rendering");
  }
  return { headings, html };
};

// This build-only boundary reads each checked-in source before Worker bundling.
// @effect-diagnostics-next-line asyncFunction:off
const readSource = async (
  sourcePath: string,
  routePath: string,
  title: string,
  description: string
) => {
  const text = await readFile(path.join(root, sourcePath), "utf-8");
  return {
    description,
    digest: digest(text),
    ...renderMarkdown(text),
    routePath,
    sourcePath,
    text,
    title,
  };
};

const lawSources = await Promise.all([
  readSource(
    "AGENTS.md",
    "/AGENTS.md",
    "Repository law",
    "Commands, architecture constraints, boundaries, and contribution rules."
  ),
  readSource(
    "VISION.md",
    "/VISION.md",
    "Product vision",
    "Why rat-stack exists and what a successful clone should preserve."
  ),
  readSource(
    "README.md",
    "/README.md",
    "Rat-stack README",
    "The stack, shipped example, surfaces, and first-run instructions."
  ),
  readSource(
    "vendor/README.md",
    "/vendor/README.md",
    "Vendoring policy",
    "Rules for pinned unpublished packages and eventual removal."
  ),
  readSource(
    ".brain/resources/effect-4-reference-projects.svx",
    "/resources/effect-4-reference-projects.svx",
    "Effect 4 reference projects",
    "Source-grounded reference implementations for this pinned Effect release."
  ),
  readSource(
    ".brain/resources/schema-projections-and-code-mode.svx",
    "/resources/schema-projections-and-code-mode.svx",
    "Schema projections and code mode",
    "The architectural reasoning behind capabilities and their projections."
  ),
]);

const packageDirectoryPaths = await Promise.all(
  // This build-only boundary enumerates workspace manifests concurrently.
  // @effect-diagnostics-next-line asyncFunction:off
  ["apps", "packages"].map(async (directory) => {
    const entries = await readdir(path.join(root, directory), {
      withFileTypes: true,
    });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => `${directory}/${entry.name}/package.json`);
  })
);
const packagePaths = [
  "package.json",
  ...packageDirectoryPaths.flat(),
].toSorted();

const DependencyMap = Schema.Record(Schema.String, Schema.String);
const PackageJson = Schema.Struct({
  dependencies: Schema.optional(DependencyMap),
  devDependencies: Schema.optional(DependencyMap),
  name: Schema.optional(Schema.String),
  optionalDependencies: Schema.optional(DependencyMap),
  peerDependencies: Schema.optional(DependencyMap),
});
const decodePackageJson = Schema.decodeUnknownSync(PackageJson);

const packagePins = await Promise.all(
  // This build-only boundary reads and decodes workspace manifests concurrently.
  // @effect-diagnostics-next-line asyncFunction:off
  packagePaths.map(async (sourcePath) => {
    const packageText = await readFile(path.join(root, sourcePath), "utf-8");
    const json = decodePackageJson(JSON.parse(packageText));
    const dependencies = [
      ...Object.entries(json.dependencies ?? {}).map(([name, version]) => ({
        kind: "dependency",
        name,
        version,
      })),
      ...Object.entries(json.devDependencies ?? {}).map(([name, version]) => ({
        kind: "devDependency",
        name,
        version,
      })),
      ...Object.entries(json.optionalDependencies ?? {}).map(
        ([name, version]) => ({ kind: "optionalDependency", name, version })
      ),
      ...Object.entries(json.peerDependencies ?? {}).map(([name, version]) => ({
        kind: "peerDependency",
        name,
        version,
      })),
    ].toSorted((left, right) => left.name.localeCompare(right.name));
    return {
      dependencies,
      name: json.name ?? sourcePath,
      sourcePath,
    };
  })
);

const pinsText = [
  "# Workspace pins",
  "",
  "Generated from every workspace `package.json`. The package files remain the source of truth.",
  "",
  ...packagePins.flatMap((workspace) => [
    `## ${workspace.name}`,
    "",
    `Source: \`${workspace.sourcePath}\``,
    "",
    "| Package | Kind | Version |",
    "| --- | --- | --- |",
    ...workspace.dependencies.map(
      (dependency) =>
        `| \`${dependency.name}\` | ${dependency.kind} | \`${dependency.version}\` |`
    ),
    "",
  ]),
].join("\n");

lawSources.splice(4, 0, {
  description: "Exact dependency values declared by every workspace package.",
  digest: digest(pinsText),
  ...renderMarkdown(pinsText),
  routePath: "/pins.md",
  sourcePath: "workspace package.json files",
  text: pinsText,
  title: "Workspace pins",
});

const skillDirectory = path.join(root, "skills");
const skillEntries = await readdir(skillDirectory, { withFileTypes: true });
const skillNames = skillEntries
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .toSorted();

const frontmatterValue = (text: string, field: string) => {
  const value = new RegExp(`^${field}:\\s*(.+)$`, "mu").exec(text)?.[1]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`Missing ${field} frontmatter`);
  }
  return value;
};

const skillSources = await Promise.all(
  // This build-only boundary reads checked-in skill sources concurrently.
  // @effect-diagnostics-next-line asyncFunction:off
  skillNames.map(async (directoryName) => {
    const sourcePath = `skills/${directoryName}/SKILL.md`;
    const text = await readFile(path.join(root, sourcePath), "utf-8");
    const name = frontmatterValue(text, "name");
    if (name !== directoryName) {
      throw new Error(
        `Skill directory ${directoryName} does not match frontmatter name ${name}`
      );
    }
    return {
      description: frontmatterValue(text, "description"),
      digest: digest(text),
      ...renderMarkdown(text),
      name,
      routePath: `/skills/${name}`,
      sourcePath,
      text,
    };
  })
);

const entryList = (
  resources: readonly {
    readonly description: string;
    readonly routePath: string;
    readonly title?: string;
    readonly name?: string;
  }[]
) =>
  resources
    .map(
      (resource) =>
        `- [${resource.title ?? resource.name ?? resource.routePath}](${resource.routePath}) — ${resource.description}`
    )
    .join("\n");

const skillGroups = [
  { names: ["learn-rat-stack"], title: "Learn" },
  {
    names: ["add-a-capability", "add-a-lifecycle-machine"],
    title: "Build",
  },
  { names: ["keep-or-cut"], title: "Shape a clone" },
] as const;

const groupedSkills = skillGroups
  .map((group) => {
    const members = skillSources.filter((skill) =>
      group.names.some((name) => name === skill.name)
    );
    return members.length === 0
      ? ""
      : `### ${group.title}\n\n${entryList(members)}`;
  })
  .filter((group) => group !== "")
  .join("\n\n");

const homeMarkdownTemplate = `# ratstack.sh

> A source-first TypeScript scaffold where one schema-typed capability projects to CLI, HTTP, MCP, and sandboxed code mode.

\`npx skills add joelhooks/rat-stack\`

## Skills

${groupedSkills}

## Law

${entryList(lawSources)}

## MCP

Connect a modern stateless MCP client to [{{ORIGIN}}/mcp]({{ORIGIN}}/mcp). The server exposes \`search\`, \`read\`, and sandboxed \`execute\` tools, every law file as a resource, and every skill as a prompt.

- [MCP server card]({{ORIGIN}}/.well-known/mcp.json)
- [OpenAPI]({{ORIGIN}}/openapi.json)
- [Agent index]({{ORIGIN}}/llms.txt)
- [Full agent corpus]({{ORIGIN}}/llms-full.txt)
`;

const skillIndexMarkdown = `# Rat-stack skills

Install all four skills:

\`npx skills add joelhooks/rat-stack\`

${groupedSkills}
`;

const { html: homeHtml } = renderMarkdown(
  homeMarkdownTemplate.replaceAll("{{ORIGIN}}", "https://ratstack.sh")
);
const { html: skillIndexHtml } = renderMarkdown(skillIndexMarkdown);

const sourceLiteral = (value: unknown) =>
  JSON.stringify(value, null, 2).replaceAll(
    "@effect-diagnostics",
    "\\u0040effect-diagnostics"
  );

const generated = `// Generated by scripts/generate-content.ts. Do not edit by hand.\n\nexport const homeMarkdownTemplate = ${sourceLiteral(homeMarkdownTemplate)} as const;\n\nexport const homeHtml = ${sourceLiteral(homeHtml)} as const;\n\nexport const skillIndexMarkdown = ${sourceLiteral(skillIndexMarkdown)} as const;\n\nexport const skillIndexHtml = ${sourceLiteral(skillIndexHtml)} as const;\n\nexport const lawSources = ${sourceLiteral(lawSources)} as const;\n\nexport const skillSources = ${sourceLiteral(skillSources)} as const;\n`;

await writeFile(output, generated, "utf-8");
