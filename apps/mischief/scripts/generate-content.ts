import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Schema } from "effect";

const here = import.meta.dirname;
const root = path.resolve(here, "../../..");
const output = path.join(here, "../src/bundled-content.generated.ts");

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

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
      name,
      routePath: `/skills/${name}`,
      sourcePath,
      text,
    };
  })
);

const sourceLiteral = (value: unknown) =>
  JSON.stringify(value, null, 2).replaceAll(
    "@effect-diagnostics",
    "\\u0040effect-diagnostics"
  );

const generated = `// Generated by scripts/generate-content.ts. Do not edit by hand.\n\nexport const lawSources = ${sourceLiteral(lawSources)} as const;\n\nexport const skillSources = ${sourceLiteral(skillSources)} as const;\n`;

await writeFile(output, generated, "utf-8");
