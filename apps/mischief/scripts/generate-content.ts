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
    "AGENTS.md",
    "What you may change, which commands to run, and which changes need approval."
  ),
  readSource(
    "VISION.md",
    "/VISION.md",
    "VISION.md",
    "What this starter is for and what a useful copy should keep."
  ),
  readSource(
    "README.md",
    "/README.md",
    "README.md",
    "What is in the repo, how the example works, and how to run it."
  ),
  readSource(
    "vendor/README.md",
    "/vendor/README.md",
    "vendor/README.md",
    "How to pin an unpublished package and when to remove the local copy."
  ),
  readSource(
    ".brain/resources/effect-4-reference-projects.svx",
    "/resources/effect-4-reference-projects.svx",
    "Effect 4 examples",
    "Working examples for the exact Effect version used by this repo."
  ),
  readSource(
    ".brain/resources/schema-projections-and-code-mode.svx",
    "/resources/schema-projections-and-code-mode.svx",
    "One action, four interfaces",
    "Why one typed action powers the command line, HTTP, MCP, and sandbox."
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
  title: "pins.md",
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
  { names: ["learn-rat-stack"], title: "See how the pieces fit" },
  {
    names: ["add-a-capability", "add-a-lifecycle-machine"],
    title: "Learn by building",
  },
  { names: ["keep-or-cut"], title: "Choose what you keep" },
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

Learn Effect, XState, TypeScript, Alchemy, and agent interfaces by taking apart a working app.

\`\`\`text
Call it    command line · HTTP · MCP · sandbox
Define it  Effect Schema · typed errors · one handler
Run it     Effect services · XState lifecycles
Check it   TypeScript 7 · Oxlint · Vitest · hooks
Ship it    pnpm · Turborepo · Alchemy · Cloudflare
\`\`\`

Rat-stack is the example. These pieces are the point.

## Learn the stack

\`npx skills add joelhooks/rat-stack\`

${groupedSkills}

## Source files

${entryList(lawSources)}

## Connect an agent

Point an MCP client at [{{ORIGIN}}/mcp]({{ORIGIN}}/mcp).

The server can search the public rat-stack files, read an exact file, and run a short program in a locked-down sandbox.

- [MCP connection details]({{ORIGIN}}/.well-known/mcp.json)
- [HTTP API docs]({{ORIGIN}}/openapi.json)
- [Short agent guide]({{ORIGIN}}/llms.txt)
- [All public agent docs]({{ORIGIN}}/llms-full.txt)
`;

const skillIndexMarkdown = `# Learn the stack

These four skills use a working app to teach the pieces inside it.

Install them:

\`npx skills add joelhooks/rat-stack\`

${groupedSkills}
`;

const staticSourcePathGroups = await Promise.all(
  ["apps/mischief/src", "packages/capability/src"].map(
    // This build-only boundary finds source that can change a public response.
    // @effect-diagnostics-next-line asyncFunction:off
    async (directory) => {
      const relativePaths = await readdir(path.join(root, directory), {
        recursive: true,
      });
      return relativePaths
        .filter(
          (relativePath) =>
            relativePath.endsWith(".ts") &&
            relativePath !== "bundled-content.generated.ts"
        )
        .map((relativePath) => `${directory}/${relativePath}`);
    }
  )
);
const staticSourcePaths = staticSourcePathGroups.flat().toSorted();
// This build-only boundary reads one source file for the cache version.
// @effect-diagnostics-next-line asyncFunction:off
const readStaticSource = async (sourcePath: string) =>
  await readFile(path.join(root, sourcePath), "utf-8");
const staticSourceText = await Promise.all(
  staticSourcePaths.map(readStaticSource)
);
const staticContentVersion = digest(
  [
    homeMarkdownTemplate,
    skillIndexMarkdown,
    ...lawSources.map((resource) => resource.digest),
    ...skillSources.map((skill) => skill.digest),
    ...staticSourceText,
  ].join("\u0000")
).slice(0, 16);

const { html: homeHtml } = renderMarkdown(
  homeMarkdownTemplate.replaceAll("{{ORIGIN}}", "https://ratstack.sh")
);
const { html: skillIndexHtml } = renderMarkdown(skillIndexMarkdown);

const sourceLiteral = (value: unknown) =>
  JSON.stringify(value, null, 2).replaceAll(
    "@effect-diagnostics",
    "\\u0040effect-diagnostics"
  );

const generated = `// Generated by scripts/generate-content.ts. Do not edit by hand.\n\nexport const staticContentVersion = ${sourceLiteral(staticContentVersion)} as const;\n\nexport const homeMarkdownTemplate = ${sourceLiteral(homeMarkdownTemplate)} as const;\n\nexport const homeHtml = ${sourceLiteral(homeHtml)} as const;\n\nexport const skillIndexMarkdown = ${sourceLiteral(skillIndexMarkdown)} as const;\n\nexport const skillIndexHtml = ${sourceLiteral(skillIndexHtml)} as const;\n\nexport const lawSources = ${sourceLiteral(lawSources)} as const;\n\nexport const skillSources = ${sourceLiteral(skillSources)} as const;\n`;

await writeFile(output, generated, "utf-8");
