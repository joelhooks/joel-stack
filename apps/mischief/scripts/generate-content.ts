// Build-only hashing uses Node's stable SHA-256 implementation.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createHash } from "node:crypto";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema } from "effect";
import { compile as compileMdsvex } from "mdsvex";
import remarkGfm from "remark-gfm";
import type { Component } from "svelte";
import { compile as compileSvelte } from "svelte/compiler";
import { render } from "svelte/server";
import type { Plugin } from "unified";

const originToken = "__RATSTACK_ORIGIN__";
const svelteServerUrl = import.meta.resolve("svelte/internal/server");

class ContentBuildError extends Schema.TaggedError<ContentBuildError>()(
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

interface SourceSpec {
  readonly description: string;
  readonly routePath: `/${string}`;
  readonly sourcePath: string;
  readonly title: string;
}

interface DocumentProps {
  readonly bodyHtml: string;
  readonly breadcrumbHref?: string;
  readonly breadcrumbLabel?: string;
  readonly breadcrumbName?: string;
  readonly description: string;
  readonly origin: string;
  readonly path: string;
  readonly title: string;
}

type ServerComponent = Component<Record<string, unknown>>;

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const buildError = (stage: string, sourcePath: string, cause: unknown) =>
  new ContentBuildError({ cause, sourcePath, stage });

const isServerComponent = (value: unknown): value is ServerComponent =>
  typeof value === "function";

const childNodes = (node: unknown): readonly unknown[] => {
  if (typeof node !== "object" || node === null) {
    return [];
  }
  const children: unknown = Reflect.get(node, "children");
  return Array.isArray(children) ? children : [];
};

const nodeText = (node: unknown): string => {
  if (typeof node !== "object" || node === null) {
    return "";
  }
  const value: unknown = Reflect.get(node, "value");
  if (typeof value === "string") {
    return value;
  }
  return childNodes(node).map(nodeText).join("");
};

const slugHeading = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

const stableHeadingIds: Plugin = () => {
  const used = new Map<string, number>();
  const visit = (node: unknown): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }
    const tagName: unknown = Reflect.get(node, "tagName");
    if (typeof tagName === "string" && /^h[1-6]$/u.test(tagName)) {
      const base = slugHeading(nodeText(node)) || "section";
      const count = used.get(base) ?? 0;
      used.set(base, count + 1);
      const id = count === 0 ? base : `${base}-${count + 1}`;
      const properties: unknown = Reflect.get(node, "properties");
      Reflect.set(node, "properties", {
        ...(typeof properties === "object" && properties !== null
          ? properties
          : {}),
        id,
      });
    }
    for (const child of childNodes(node)) {
      visit(child);
    }
  };
  return visit;
};

const loadCompiledComponent = Effect.fn("loadCompiledComponent")(
  function* loadCompiledComponent(source: string, sourcePath: string) {
    const compiled = yield* Effect.try({
      catch: (cause) => buildError("Svelte compile", sourcePath, cause),
      try: () =>
        compileSvelte(source, {
          css: "injected",
          filename: sourcePath,
          generate: "server",
        }).js.code,
    });
    const executable = compiled.replaceAll(
      "'svelte/internal/server'",
      JSON.stringify(svelteServerUrl)
    );
    const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(executable)}`;
    const loaded: unknown = yield* Effect.tryPromise({
      catch: (cause) => buildError("Svelte module load", sourcePath, cause),
      // Node's module loader owns this Promise-returning boundary.
      // oxlint-disable-next-line typescript/promise-function-async
      try: () => import(moduleUrl).then((module): unknown => module),
    });
    const component: unknown =
      typeof loaded === "object" && loaded !== null
        ? Reflect.get(loaded, "default")
        : undefined;
    if (!isServerComponent(component)) {
      return yield* new ContentBuildError({
        cause: new TypeError("Compiled module has no component export"),
        sourcePath,
        stage: "Svelte module load",
      });
    }
    return component;
  }
);

const compileMarkdownBody = Effect.fn("compileMarkdownBody")(
  function* compileMarkdownBody(source: string, sourcePath: string) {
    const transformed: unknown = yield* Effect.tryPromise({
      catch: (cause) => buildError("mdsvex compile", sourcePath, cause),
      // mdsvex 0.12.8 declares a nested Promise even though JavaScript adopts it.
      // Mapping the fulfilled value to unknown lets us validate the real boundary.
      // @effect-diagnostics-next-line asyncFunction:off -- mdsvex owns this Promise boundary.
      try: async () =>
        await compileMdsvex(source, {
          extensions: [".md", ".svx"],
          filename: sourcePath,
          highlight: false,
          rehypePlugins: [stableHeadingIds],
          remarkPlugins: [remarkGfm as Plugin],
        }).then((value): unknown => value),
    });
    const componentSource: unknown =
      typeof transformed === "object" && transformed !== null
        ? Reflect.get(transformed, "code")
        : undefined;
    if (typeof componentSource !== "string") {
      return yield* new ContentBuildError({
        cause: new TypeError("mdsvex returned no component source"),
        sourcePath,
        stage: "mdsvex compile",
      });
    }
    const component = yield* loadCompiledComponent(componentSource, sourcePath);
    return yield* Effect.try({
      catch: (cause) => buildError("Svelte body render", sourcePath, cause),
      try: () => render(component, { props: {} }).body,
    });
  }
);

const renderDocument = Effect.fn("renderDocument")(function* renderDocument(
  shell: ServerComponent,
  props: DocumentProps,
  sourcePath: string
) {
  const rendered = yield* Effect.try({
    catch: (cause) => buildError("Svelte document render", sourcePath, cause),
    try: () => render(shell, { props: { ...props } }),
  });
  const document = `<!doctype html>
<html lang="en">
<head>${rendered.head}</head>
<body>${rendered.body}</body>
</html>`;
  if (/<script\b/iu.test(document)) {
    return yield* new ContentBuildError({
      cause: new Error("Static documents must not contain client scripts"),
      sourcePath,
      stage: "Svelte document render",
    });
  }
  return document;
});

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

const frontmatterValue = (text: string, field: string) => {
  const value = new RegExp(`^${field}:\\s*(.+)$`, "mu").exec(text)?.[1]?.trim();
  if (value === undefined || value === "") {
    throw new Error(`Missing ${field} frontmatter`);
  }
  return value;
};

const sourceLiteral = (value: unknown) =>
  JSON.stringify(value, null, 2).replaceAll(
    "@effect-diagnostics",
    "\\u0040effect-diagnostics"
  );

const lawSpecs: readonly SourceSpec[] = [
  {
    description:
      "What you may change, which commands to run, and which changes need approval.",
    routePath: "/AGENTS.md",
    sourcePath: "AGENTS.md",
    title: "AGENTS.md",
  },
  {
    description: "What this starter is for and what a useful copy should keep.",
    routePath: "/VISION.md",
    sourcePath: "VISION.md",
    title: "VISION.md",
  },
  {
    description:
      "What is in the repo, how the example works, and how to run it.",
    routePath: "/README.md",
    sourcePath: "README.md",
    title: "README.md",
  },
  {
    description:
      "How to pin an unpublished package and when to remove the local copy.",
    routePath: "/vendor/README.md",
    sourcePath: "vendor/README.md",
    title: "vendor/README.md",
  },
  {
    description:
      "Working examples for the exact Effect version used by this repo.",
    routePath: "/resources/effect-4-reference-projects.svx",
    sourcePath: ".brain/resources/effect-4-reference-projects.svx",
    title: "Effect 4 examples",
  },
  {
    description:
      "Why one typed action powers the command line, HTTP, MCP, and sandbox.",
    routePath: "/resources/schema-projections-and-code-mode.svx",
    sourcePath: ".brain/resources/schema-projections-and-code-mode.svx",
    title: "One action, four interfaces",
  },
];

const PackageDependencies = Schema.Record(Schema.String, Schema.String);
const PackageJson = Schema.Struct({
  dependencies: Schema.optional(PackageDependencies),
  devDependencies: Schema.optional(PackageDependencies),
  name: Schema.optional(Schema.String),
  optionalDependencies: Schema.optional(PackageDependencies),
  peerDependencies: Schema.optional(PackageDependencies),
});

const skillGroups = [
  { names: ["learn-rat-stack"], title: "See how the pieces fit" },
  {
    names: ["add-a-capability", "add-a-lifecycle-machine"],
    title: "Learn by building",
  },
  { names: ["keep-or-cut"], title: "Choose what you keep" },
] as const;

const program = Effect.gen(function* generateContent() {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../..");
  const output = path.join(
    root,
    "apps/mischief/src/bundled-content.generated.ts"
  );

  const readText = (sourcePath: string) =>
    fileSystem
      .readFileString(path.join(root, sourcePath))
      .pipe(Effect.mapError((cause) => buildError("read", sourcePath, cause)));

  const directoryNames = (directory: string, entries: readonly string[]) =>
    Effect.forEach(
      entries,
      (entry) =>
        fileSystem
          .stat(path.join(root, directory, entry))
          .pipe(
            Effect.map((info) =>
              info.type === "Directory" ? entry : undefined
            )
          ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map((results) =>
        results.filter((entry): entry is string => entry !== undefined)
      )
    );

  const shellSource = yield* readText("apps/mischief/src/document.svelte");
  const shell = yield* loadCompiledComponent(
    shellSource,
    "apps/mischief/src/document.svelte"
  );

  const makeDocument = (
    bodyHtml: string,
    metadata: Omit<DocumentProps, "bodyHtml" | "origin">,
    sourcePath: string
  ) =>
    renderDocument(
      shell,
      { bodyHtml, origin: originToken, ...metadata },
      sourcePath
    );

  const readSource = (spec: SourceSpec) =>
    Effect.gen(function* readAndRenderSource() {
      const text = yield* readText(spec.sourcePath);
      const bodyHtml = yield* compileMarkdownBody(text, spec.sourcePath);
      const documentHtml = yield* makeDocument(
        bodyHtml,
        {
          breadcrumbHref: "/",
          breadcrumbLabel: "source files",
          breadcrumbName: spec.title,
          description: spec.description,
          path: spec.routePath,
          title: `${spec.title} | rat-stack`,
        },
        spec.sourcePath
      );
      return {
        description: spec.description,
        digest: digest(text),
        documentHtml,
        routePath: spec.routePath,
        sourcePath: spec.sourcePath,
        text,
        title: spec.title,
      };
    });

  const lawSources = yield* Effect.forEach(lawSpecs, readSource, {
    concurrency: "unbounded",
  });

  const packageDirectoryGroups = yield* Effect.forEach(
    ["apps", "packages"],
    (directory) =>
      Effect.gen(function* findPackageFiles() {
        const entries = yield* fileSystem
          .readDirectory(path.join(root, directory))
          .pipe(
            Effect.mapError((cause) =>
              buildError("read directory", directory, cause)
            )
          );
        const directories = yield* directoryNames(directory, entries);
        return directories.map((entry) => `${directory}/${entry}/package.json`);
      }),
    { concurrency: "unbounded" }
  );
  const packagePaths = [
    "package.json",
    ...packageDirectoryGroups.flat(),
  ].toSorted();
  const packagePins = yield* Effect.forEach(
    packagePaths,
    (sourcePath) =>
      Effect.gen(function* readPackagePins() {
        const packageText = yield* readText(sourcePath);
        const json = yield* Schema.decodeEffect(
          Schema.fromJsonString(PackageJson)
        )(packageText).pipe(
          Effect.mapError((cause) =>
            buildError("package JSON decode", sourcePath, cause)
          )
        );
        const dependencies = [
          ...Object.entries(json.dependencies ?? {}).map(([name, version]) => ({
            kind: "dependency",
            name,
            version,
          })),
          ...Object.entries(json.devDependencies ?? {}).map(
            ([name, version]) => ({ kind: "devDependency", name, version })
          ),
          ...Object.entries(json.optionalDependencies ?? {}).map(
            ([name, version]) => ({ kind: "optionalDependency", name, version })
          ),
          ...Object.entries(json.peerDependencies ?? {}).map(
            ([name, version]) => ({ kind: "peerDependency", name, version })
          ),
        ].toSorted((left, right) => left.name.localeCompare(right.name));
        return {
          dependencies,
          name: json.name ?? sourcePath,
          sourcePath,
        };
      }),
    { concurrency: "unbounded" }
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
  const pinsBodyHtml = yield* compileMarkdownBody(pinsText, "pins.md");
  const pinsDocumentHtml = yield* makeDocument(
    pinsBodyHtml,
    {
      breadcrumbHref: "/",
      breadcrumbLabel: "source files",
      breadcrumbName: "pins.md",
      description:
        "Exact dependency values declared by every workspace package.",
      path: "/pins.md",
      title: "pins.md | rat-stack",
    },
    "pins.md"
  );
  lawSources.splice(4, 0, {
    description: "Exact dependency values declared by every workspace package.",
    digest: digest(pinsText),
    documentHtml: pinsDocumentHtml,
    routePath: "/pins.md",
    sourcePath: "workspace package.json files",
    text: pinsText,
    title: "pins.md",
  });

  const skillEntries = yield* fileSystem
    .readDirectory(path.join(root, "skills"))
    .pipe(
      Effect.mapError((cause) => buildError("read directory", "skills", cause))
    );
  const skillDirectories = yield* directoryNames("skills", skillEntries);
  const skillSources = yield* Effect.forEach(
    skillDirectories.toSorted(),
    (directoryName) =>
      Effect.gen(function* readSkill() {
        const sourcePath = `skills/${directoryName}/SKILL.md`;
        const text = yield* readText(sourcePath);
        const name = yield* Effect.try({
          catch: (cause) => buildError("frontmatter", sourcePath, cause),
          try: () => frontmatterValue(text, "name"),
        });
        if (name !== directoryName) {
          return yield* new ContentBuildError({
            cause: new Error(
              `Skill directory ${directoryName} does not match frontmatter name ${name}`
            ),
            sourcePath,
            stage: "frontmatter",
          });
        }
        const description = yield* Effect.try({
          catch: (cause) => buildError("frontmatter", sourcePath, cause),
          try: () => frontmatterValue(text, "description"),
        });
        const bodyHtml = yield* compileMarkdownBody(text, sourcePath);
        const routePath = `/skills/${name}` as const;
        const documentHtml = yield* makeDocument(
          bodyHtml,
          {
            breadcrumbHref: "/skills",
            breadcrumbLabel: "skills",
            breadcrumbName: name,
            description,
            path: routePath,
            title: `${name} | rat-stack`,
          },
          sourcePath
        );
        return {
          description,
          digest: digest(text),
          documentHtml,
          name,
          routePath,
          sourcePath,
          text,
        };
      }),
    { concurrency: "unbounded" }
  );

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

Point an MCP client at the [MCP endpoint](${originToken}/mcp).

The server can search the public rat-stack files, read an exact file, and run a short program in a locked-down sandbox.

- [MCP connection details](${originToken}/.well-known/mcp.json)
- [HTTP API docs](${originToken}/openapi.json)
- [Short agent guide](${originToken}/llms.txt)
- [All public agent docs](${originToken}/llms-full.txt)
`;
  const skillIndexMarkdown = `# Learn the stack

These four skills use a working app to teach the pieces inside it.

Install them:

\`npx skills add joelhooks/rat-stack\`

${groupedSkills}
`;

  const homeBodyHtml = yield* compileMarkdownBody(
    homeMarkdownTemplate,
    "ratstack-home.md"
  );
  const homeDocumentHtml = yield* makeDocument(
    homeBodyHtml,
    {
      description:
        "Learn Effect, XState, TypeScript, Alchemy, and agent interfaces in one working app.",
      path: "/",
      title: "rat-stack: learn the pieces in a working app",
    },
    "ratstack-home.md"
  );
  const skillIndexBodyHtml = yield* compileMarkdownBody(
    skillIndexMarkdown,
    "ratstack-skills.md"
  );
  const skillIndexDocumentHtml = yield* makeDocument(
    skillIndexBodyHtml,
    {
      description:
        "Four hands-on guides to Effect actions, XState lifecycles, and the seams between stack pieces.",
      path: "/skills",
      title: "Learn the stack | rat-stack",
    },
    "ratstack-skills.md"
  );

  const staticSourcePathGroups = yield* Effect.forEach(
    ["apps/mischief/src", "packages/capability/src"],
    (directory) =>
      fileSystem
        .readDirectory(path.join(root, directory), { recursive: true })
        .pipe(
          Effect.map((relativePaths) =>
            relativePaths
              .filter(
                (relativePath) =>
                  (relativePath.endsWith(".ts") ||
                    relativePath.endsWith(".svelte")) &&
                  relativePath !== "bundled-content.generated.ts"
              )
              .map((relativePath) => `${directory}/${relativePath}`)
          ),
          Effect.mapError((cause) =>
            buildError("read directory", directory, cause)
          )
        ),
    { concurrency: "unbounded" }
  );
  const staticSourcePaths = staticSourcePathGroups.flat().toSorted();
  const staticSourceText = yield* Effect.forEach(staticSourcePaths, readText, {
    concurrency: "unbounded",
  });
  const staticContentVersion = digest(
    [
      homeMarkdownTemplate,
      skillIndexMarkdown,
      ...lawSources.map((resource) => resource.digest),
      ...skillSources.map((skill) => skill.digest),
      ...staticSourceText,
    ].join("\u0000")
  ).slice(0, 16);

  const generated = `// Generated by scripts/generate-content.ts. Do not edit by hand.\n\nexport const originToken = ${sourceLiteral(originToken)} as const;\n\nexport const staticContentVersion = ${sourceLiteral(staticContentVersion)} as const;\n\nexport const homeMarkdownTemplate = ${sourceLiteral(homeMarkdownTemplate)} as const;\n\nexport const homeDocumentHtml = ${sourceLiteral(homeDocumentHtml)} as const;\n\nexport const skillIndexMarkdown = ${sourceLiteral(skillIndexMarkdown)} as const;\n\nexport const skillIndexDocumentHtml = ${sourceLiteral(skillIndexDocumentHtml)} as const;\n\nexport const lawSources = ${sourceLiteral(lawSources)} as const;\n\nexport const skillSources = ${sourceLiteral(skillSources)} as const;\n`;
  const temporaryOutput = yield* fileSystem
    .makeTempFile({
      directory: path.dirname(output),
      prefix: ".bundled-content.",
      suffix: ".tmp",
    })
    .pipe(
      Effect.mapError((cause) =>
        buildError("create temporary file", output, cause)
      )
    );
  yield* fileSystem
    .writeFileString(temporaryOutput, generated)
    .pipe(
      Effect.mapError((cause) => buildError("write", temporaryOutput, cause))
    );
  yield* fileSystem
    .rename(temporaryOutput, output)
    .pipe(Effect.mapError((cause) => buildError("rename", output, cause)));
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
