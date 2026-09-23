// Build-only hashing uses Node's stable SHA-256 implementation.
// @effect-diagnostics-next-line nodeBuiltinImport:off
import { createHash } from "node:crypto";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Resvg } from "@resvg/resvg-js";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { compile as compileMdsvex } from "mdsvex";
import remarkGfm from "remark-gfm";
import satori from "satori";
import { createHighlighter } from "shiki";
import type { Highlighter } from "shiki";
import type { Component } from "svelte";
import { compile as compileSvelte } from "svelte/compiler";
import { render } from "svelte/server";
import type { Plugin } from "unified";

import {
  deriveAgentMarkdown,
  deriveHtmlMarkdown,
  encodeIco,
} from "./content-lib.ts";

const originToken = "__RATSTACK_ORIGIN__";

const repoUrl = "https://github.com/joelhooks/rat-stack";

// Backtick spans that look like repository paths. Placeholders such as
// `packages/core/src/<capability>.ts` fail the character class on purpose.
const repoPathToken =
  /^(?:\.brain|\.pi|\.cursor|\.claude|apps|packages|scripts|skills|vendor)\/[\w./-]+$|^[\w.-]+\.(?:md|ts|js|json|yml|yaml|toml|schema)$/u;

const fencedBlock = /```[\s\S]*?```/gu;

const inlineCode = /`(?<span>[^`\n]+)`/gu;

const emptyTargets: ReadonlyMap<string, string> = new Map();

const codeSpans = (text: string): readonly string[] => {
  const spans = new Set<string>();

  for (const match of text.replaceAll(fencedBlock, "").matchAll(inlineCode)) {
    const span = match.groups?.span?.trim();

    if (span !== undefined && span !== "") {
      spans.add(span);
    }
  }

  return [...spans];
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

// Commit subjects land inside a Svelte template, where angle brackets and
// braces are markup. Neutralise them before mdsvex sees the text.
const svelteSafeText = (value: string) =>
  value
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;");

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

interface PublicSpec extends SourceSpec {
  readonly rawText: string;
  readonly text: string;
}

interface OgPage {
  readonly description: string;
  readonly routePath: `/${string}`;
  readonly title: string;
}

interface DocumentProps {
  readonly bodyHtml: string;
  readonly breadcrumbHref?: string;
  readonly breadcrumbLabel?: string;
  readonly breadcrumbName?: string;
  readonly description: string;
  readonly ogImageUrl: string;
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

const isElement = (node: unknown, tagName: string) =>
  typeof node === "object" &&
  node !== null &&
  Reflect.get(node, "tagName") === tagName;

const rowsOf = (section: unknown) =>
  childNodes(section).filter((row) => isElement(row, "tr"));

// Each body cell learns its column header so the shell can stack a table into
// label and value rows on narrow screens with `attr(data-label)`.
const tableCellLabels: Plugin = () => {
  const visit = (node: unknown): void => {
    if (isElement(node, "table")) {
      const headers = childNodes(node)
        .filter((section) => isElement(section, "thead"))
        .flatMap(rowsOf)
        .flatMap((row) =>
          childNodes(row)
            .filter((cell) => isElement(cell, "th"))
            .map(nodeText)
        );

      for (const body of childNodes(node).filter((section) =>
        isElement(section, "tbody")
      )) {
        for (const row of rowsOf(body)) {
          const cells = childNodes(row).filter((cell) => isElement(cell, "td"));

          for (const [index, cell] of cells.entries()) {
            const label = headers[index];

            if (
              label === undefined ||
              typeof cell !== "object" ||
              cell === null
            ) {
              continue;
            }

            const properties: unknown = Reflect.get(cell, "properties");
            Reflect.set(cell, "properties", {
              ...(typeof properties === "object" && properties !== null
                ? properties
                : {}),
              dataLabel: label,
            });
          }
        }
      }
    }

    for (const child of childNodes(node)) {
      visit(child);
    }
  };

  return visit;
};

// Inline code spans that name a public page, a skill, or a real repository
// path become links. Fenced blocks and existing links are left alone.
const linkCodeSpans =
  (targets: ReadonlyMap<string, string>): Plugin =>
  () => {
    const visit = (node: unknown, insideBlock: boolean): void => {
      if (typeof node !== "object" || node === null) {
        return;
      }

      const children: unknown = Reflect.get(node, "children");

      if (!Array.isArray(children)) {
        return;
      }

      const list: unknown[] = children;

      for (const [index, child] of list.entries()) {
        if (!insideBlock && isElement(child, "code")) {
          const href = targets.get(nodeText(child).trim());

          if (href !== undefined) {
            list[index] = {
              children: [child],
              properties: { href },
              tagName: "a",
              type: "element",
            };
            continue;
          }
        }

        visit(
          child,
          insideBlock || isElement(child, "pre") || isElement(child, "a")
        );
      }
    };

    return (tree: unknown) => {
      visit(tree, false);
    };
  };

// The stack pieces are wiki entities. The first plain-text mention of each
// on a page links to the tool's home. Longer names come first so "Effect
// diagnostics" wins over "Effect". Headings, code, and existing links are
// left alone. Verified 2026-09-22: every URL answered 200.
const stackEntities: readonly (readonly [pattern: string, href: string])[] = [
  ["Effect diagnostics", "https://github.com/Effect-TS/language-service"],
  ["Cloudflare Workers?", "https://developers.cloudflare.com/workers/"],
  ["TypeScript 7", "https://github.com/microsoft/typescript-go"],
  ["TypeScript", "https://www.typescriptlang.org"],
  ["Turborepo", "https://turborepo.com"],
  ["Effect", "https://effect.website"],
  ["XState", "https://stately.ai/docs/xstate"],
  ["Oxlint", "https://oxc.rs/docs/guide/usage/linter"],
  ["Oxfmt", "https://oxc.rs/docs/guide/usage/formatter"],
  ["Vitest", "https://vitest.dev"],
  ["lefthook", "https://lefthook.dev"],
  ["pnpm", "https://pnpm.io"],
  ["Alchemy", "https://alchemy.run"],
  ["OpenAPI", "https://www.openapis.org"],
  ["MCP", "https://modelcontextprotocol.io"],
];

const entityPattern = new RegExp(
  `(?<![\\w./-])(?<entity>${stackEntities.map(([pattern]) => pattern).join("|")})(?![\\w./-])`,
  "gu"
);

const entityHref = (name: string) =>
  stackEntities.find(([pattern]) =>
    new RegExp(`^(?:${pattern})$`, "u").test(name)
  )?.[1];

const skippedByEntityLinker = new Set([
  "a",
  "code",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "pre",
  "figure",
]);

const linkStackEntities: Plugin = () => {
  const visit = (node: unknown, linked: Set<string>): void => {
    if (typeof node !== "object" || node === null) {
      return;
    }

    const nodeTagName: unknown = Reflect.get(node, "tagName");

    if (
      typeof nodeTagName === "string" &&
      skippedByEntityLinker.has(nodeTagName)
    ) {
      return;
    }

    const children: unknown = Reflect.get(node, "children");

    if (!Array.isArray(children)) {
      return;
    }

    const list: unknown[] = children;

    for (let index = 0; index < list.length; index += 1) {
      const child = list[index];

      if (typeof child !== "object" || child === null) {
        continue;
      }

      const tagName: unknown = Reflect.get(child, "tagName");

      if (typeof tagName === "string" && skippedByEntityLinker.has(tagName)) {
        continue;
      }

      const value: unknown = Reflect.get(child, "value");

      if (Reflect.get(child, "type") !== "text" || typeof value !== "string") {
        visit(child, linked);
        continue;
      }

      const replacement: unknown[] = [];
      let cursor = 0;

      for (const match of value.matchAll(entityPattern)) {
        const name = match.groups?.entity;
        const href = name === undefined ? undefined : entityHref(name);

        if (name === undefined || href === undefined || linked.has(href)) {
          continue;
        }

        linked.add(href);
        replacement.push(
          { type: "text", value: value.slice(cursor, match.index) },
          {
            children: [{ type: "text", value: name }],
            properties: { href },
            tagName: "a",
            type: "element",
          }
        );
        cursor = match.index + name.length;
      }

      if (replacement.length === 0) {
        continue;
      }

      replacement.push({ type: "text", value: value.slice(cursor) });
      list.splice(index, 1, ...replacement);
      index += replacement.length - 1;
    }
  };

  return (tree: unknown) => {
    visit(tree, new Set<string>());
  };
};

// Markdown and Svelte-flavoured sources compile under their own name so
// mdsvex picks the right extension; generated pages compile under the title.
const compileName = (spec: SourceSpec) =>
  /\.(?:md|svx)$/u.test(spec.sourcePath) ? spec.sourcePath : spec.title;

const ogImagePath = (routePath: string) =>
  `/og${routePath === "/" ? "/home" : routePath}.png`;

const syntaxLanguage = new Map<string, string>([
  ["bash", "bash"],
  ["css", "css"],
  ["html", "html"],
  ["js", "javascript"],
  ["json", "json"],
  ["sh", "bash"],
  ["shell", "bash"],
  ["sql", "sql"],
  ["svelte", "svelte"],
  ["toml", "toml"],
  ["ts", "typescript"],
  ["typescript", "typescript"],
  ["text", "text"],
  ["yaml", "yaml"],
  ["yml", "yaml"],
]);

const escapeCodeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeSvelteCodeHtml = (value: string) =>
  value
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("`", "&#96;");

const makeCodeHighlighter =
  (highlighter: Highlighter) =>
  (code: string, lang: string | null | undefined) => {
    const normalized = lang?.trim().toLowerCase() ?? "text";
    const language = syntaxLanguage.get(normalized) ?? "text";

    if (
      language === "text" ||
      !highlighter.getLoadedLanguages().includes(language)
    ) {
      return `<pre><code>${escapeSvelteCodeHtml(escapeCodeHtml(code))}</code></pre>`;
    }

    return escapeSvelteCodeHtml(
      highlighter.codeToHtml(code, {
        lang: language,
        theme: "catppuccin-latte",
      })
    );
  };

const makeOgElement = (page: OgPage, emojiDataUrl: string) => ({
  props: {
    children: [
      {
        props: {
          children: page.title,
          style: {
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.1,
          },
        },
        type: "div",
      },
      {
        props: {
          children: page.description,
          style: {
            fontSize: 30,
            lineHeight: 1.35,
            marginTop: 24,
            maxWidth: 1000,
          },
        },
        type: "div",
      },
      {
        props: {
          src: emojiDataUrl,
          style: {
            bottom: 64,
            height: 96,
            position: "absolute",
            right: 64,
            width: 96,
          },
        },
        type: "img",
      },
    ],
    style: {
      backgroundColor: "#ffffff",
      color: "#000000",
      display: "flex",
      flexDirection: "column",
      height: 630,
      padding: 80,
      position: "relative",
      width: 1200,
    },
  },
  type: "div",
});

const renderOgImage = (
  page: OgPage,
  emojiSvg: string,
  regularFont: Buffer,
  boldFont: Buffer
) =>
  Effect.tryPromise({
    catch: (cause) => buildError("og image", page.routePath, cause),
    // @effect-diagnostics-next-line asyncFunction:off -- satori and resvg own this Promise boundary.
    try: async () => {
      const svg = await satori(
        makeOgElement(
          page,
          `data:image/svg+xml;base64,${Buffer.from(emojiSvg).toString("base64")}`
        ),
        {
          embedFont: true,
          fonts: [
            { data: regularFont, name: "JetBrains Mono", weight: 400 },
            { data: boldFont, name: "JetBrains Mono", weight: 700 },
          ],
          height: 630,
          width: 1200,
        }
      );

      return new Resvg(svg, {
        font: { loadSystemFonts: false },
      })
        .render()
        .asPng();
    },
  });

// The rat is the logo. Icons are the same Twemoji SVG at fixed sizes; the
// touch icon gets a white square because iOS fills transparency with black.
const renderRatPng = (ratSvg: string, size: number, background?: string) =>
  Effect.try({
    catch: (cause) => buildError("icon", "assets/emoji/1f400.svg", cause),
    try: () =>
      new Resvg(ratSvg, {
        ...(background === undefined ? {} : { background }),
        fitTo: { mode: "width", value: size },
        font: { loadSystemFonts: false },
      })
        .render()
        .asPng(),
  });

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
  function* compileMarkdownBody(
    source: string,
    sourcePath: string,
    highlighter: Highlighter,
    targets: ReadonlyMap<string, string> = emptyTargets
  ) {
    const transformed: unknown = yield* Effect.tryPromise({
      catch: (cause) => buildError("mdsvex compile", sourcePath, cause),
      // mdsvex 0.12.8 declares a nested Promise even though JavaScript adopts it.
      // Mapping the fulfilled value to unknown lets us validate the real boundary.
      // @effect-diagnostics-next-line asyncFunction:off -- mdsvex owns this Promise boundary.
      try: async () =>
        await compileMdsvex(deriveHtmlMarkdown(source), {
          extensions: [".md", ".svx"],
          filename: sourcePath,
          highlight: {
            highlighter: makeCodeHighlighter(highlighter),
            optimise: false,
          },
          rehypePlugins: [
            stableHeadingIds,
            tableCellLabels,
            linkCodeSpans(targets),
            linkStackEntities,
          ],
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
  {
    names: ["learn-rat-stack", "learn-alchemy"],
    title: "See how the pieces fit",
  },
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

  const highlighter = yield* Effect.tryPromise({
    catch: (cause) => buildError("Shiki highlighter", "shiki", cause),
    // @effect-diagnostics-next-line asyncFunction:off -- Shiki owns this Promise boundary.
    try: async () =>
      await createHighlighter({
        langs: [
          "bash",
          "css",
          "html",
          "javascript",
          "json",
          "svelte",
          "sql",
          "toml",
          "typescript",
          "yaml",
        ],
        themes: ["catppuccin-latte"],
      }),
  });

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

  // The rat emoji is the logo: the favicon, the icons, and every preview card.
  const emojiSvg = (yield* readText("assets/emoji/1f400.svg"))
    .replaceAll(/<!--[\s\S]*?-->\s*/gu, "")
    .trim();

  const regularFont = yield* fileSystem
    .readFile(path.join(root, "assets/fonts/JetBrainsMono-Regular.ttf"))
    .pipe(
      Effect.mapError((cause) =>
        buildError("og image", "assets/fonts/JetBrainsMono-Regular.ttf", cause)
      )
    );

  const boldFont = yield* fileSystem
    .readFile(path.join(root, "assets/fonts/JetBrainsMono-Bold.ttf"))
    .pipe(
      Effect.mapError((cause) =>
        buildError("og image", "assets/fonts/JetBrainsMono-Bold.ttf", cause)
      )
    );

  const makeDocument = (
    bodyHtml: string,
    metadata: Omit<DocumentProps, "bodyHtml" | "ogImageUrl" | "origin">,
    sourcePath: string,
    contentVersion: string
  ) =>
    renderDocument(
      shell,
      {
        bodyHtml,
        ogImageUrl: `${originToken}${ogImagePath(metadata.path)}?v=${contentVersion}`,
        origin: originToken,
        ...metadata,
      },
      sourcePath
    );

  const lawTexts: readonly PublicSpec[] = yield* Effect.forEach(
    lawSpecs,
    (spec) =>
      readText(spec.sourcePath).pipe(
        Effect.map((rawText) => ({
          ...spec,
          rawText,
          text: deriveAgentMarkdown(rawText),
        }))
      ),
    { concurrency: "unbounded" }
  );

  // The change log is the wiki's log.md: every commit that touched a served
  // file, newest first. A shallow clone simply yields fewer entries.
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const gitLog = yield* spawner
    .string(
      ChildProcess.make(
        "git",
        [
          "log",
          "-n",
          "80",
          "--date=short",
          "--format=%ad%x09%H%x09%h%x09%s",
          "--",
          ...lawSpecs.map((spec) => spec.sourcePath),
          "skills",
        ],
        { cwd: root }
      )
    )
    .pipe(Effect.orElseSucceed(() => ""));

  const logEntries = gitLog
    .split("\n")
    .filter((line) => line.trim() !== "")
    .flatMap((line) => {
      const [date, hash, short, ...subject] = line.split("\t");

      return date === undefined || hash === undefined || short === undefined
        ? []
        : [{ date, hash, short, subject: svelteSafeText(subject.join("\t")) }];
    });

  const logText = [
    "# Change log",
    "",
    "Newest first. Every commit that touched a file served on this site: the source files, the skills, and the two Brain resources. Built from git history at generation time, so a shallow clone lists fewer entries.",
    "",
    ...(logEntries.length === 0
      ? ["No git history was available when this build ran."]
      : logEntries.flatMap((entry) => [
          `## [${entry.date}] ${entry.subject}`,
          "",
          `Commit [${entry.short}](${repoUrl}/commit/${entry.hash}).`,
          "",
        ])),
  ].join("\n");

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

  const publicSpecs: readonly PublicSpec[] = [
    ...lawTexts.slice(0, 4),
    {
      description:
        "Exact dependency values declared by every workspace package.",
      rawText: pinsText,
      routePath: "/pins.md",
      sourcePath: "workspace package.json files",
      text: pinsText,
      title: "pins.md",
    },
    {
      description: "What changed in the files served here, newest first.",
      rawText: logText,
      routePath: "/log.md",
      sourcePath: "git history",
      text: logText,
      title: "log.md",
    },
    ...lawTexts.slice(4),
  ];

  const skillEntries = yield* fileSystem
    .readDirectory(path.join(root, "skills"))
    .pipe(
      Effect.mapError((cause) => buildError("read directory", "skills", cause))
    );

  const skillDirectories = yield* directoryNames("skills", skillEntries);

  const skillTexts = yield* Effect.forEach(
    skillDirectories.toSorted(),
    (directoryName) =>
      Effect.gen(function* readSkill() {
        const sourcePath = `skills/${directoryName}/SKILL.md`;
        const rawText = yield* readText(sourcePath);
        const text = deriveAgentMarkdown(rawText);

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

        const routePath = `/skills/${name}` as const;

        return { description, name, rawText, routePath, sourcePath, text };
      }),
    { concurrency: "unbounded" }
  );

  // Cross-references. A span that names a served page or a skill links inside
  // the site; a span that names a real repository path links to GitHub. Paths
  // are checked on disk, so the build cannot mint a dead link.
  const servedRoutes = new Map<string, string>();
  const titles = new Map<string, string>();

  for (const spec of publicSpecs) {
    servedRoutes.set(spec.sourcePath, spec.routePath);
    servedRoutes.set(spec.title, spec.routePath);
    titles.set(spec.routePath, spec.title);
  }

  for (const skill of skillTexts) {
    servedRoutes.set(skill.name, skill.routePath);
    titles.set(skill.routePath, skill.name);
  }

  const resolveTarget = (
    span: string,
    selfRoute: string
  ): Effect.Effect<Option.Option<string>> =>
    Effect.gen(function* resolveSpan() {
      const served = servedRoutes.get(span);

      if (served === selfRoute) {
        return Option.none();
      }

      if (served !== undefined) {
        return Option.some(served);
      }

      if (!repoPathToken.test(span)) {
        return Option.none();
      }

      const relative = span.replace(/\/$/u, "");
      const absolute = path.join(root, relative);

      const exists = yield* fileSystem
        .exists(absolute)
        .pipe(Effect.orElseSucceed(() => false));

      if (!exists) {
        return Option.none();
      }

      const info = yield* fileSystem
        .stat(absolute)
        .pipe(Effect.orElseSucceed(() => null));

      const kind = info?.type === "Directory" ? "tree" : "blob";

      return Option.some(`${repoUrl}/${kind}/main/${relative}`);
    });

  const resolveTargets = (text: string, selfRoute: string) =>
    Effect.forEach(
      codeSpans(text),
      (span) =>
        resolveTarget(span, selfRoute).pipe(
          Effect.map((href) => ({ href, span }))
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map((pairs) => {
        const targets = new Map<string, string>();

        for (const pair of pairs) {
          if (Option.isSome(pair.href)) {
            targets.set(pair.span, pair.href.value);
          }
        }

        return targets;
      })
    );

  const publicTargets = yield* Effect.forEach(
    publicSpecs,
    (spec) => resolveTargets(spec.text, spec.routePath),
    { concurrency: "unbounded" }
  );

  const skillTargets = yield* Effect.forEach(
    skillTexts,
    (skill) => resolveTargets(skill.text, skill.routePath),
    { concurrency: "unbounded" }
  );

  // Backlinks: which pages point at this one. Only in-site links count.
  const linkedFrom = new Map<string, Set<string>>();

  const recordLinks = (from: string, targets: ReadonlyMap<string, string>) => {
    for (const href of targets.values()) {
      if (!href.startsWith("/")) {
        continue;
      }

      const sources = linkedFrom.get(href) ?? new Set<string>();
      sources.add(from);
      linkedFrom.set(href, sources);
    }
  };

  for (const [index, spec] of publicSpecs.entries()) {
    recordLinks(spec.routePath, publicTargets[index] ?? emptyTargets);
  }

  for (const [index, skill] of skillTexts.entries()) {
    recordLinks(skill.routePath, skillTargets[index] ?? emptyTargets);
  }

  // Per-page provenance: the last commit that touched the source file.
  const lastChange = (sourcePath: string) =>
    spawner
      .string(
        ChildProcess.make(
          "git",
          [
            "log",
            "-n",
            "1",
            "--date=short",
            "--format=%ad%x09%H%x09%h",
            "--",
            sourcePath,
          ],
          { cwd: root }
        )
      )
      .pipe(
        Effect.orElseSucceed(() => ""),
        Effect.map((line) => {
          const [date, hash, short] = line.trim().split("\t");

          return date === undefined || hash === undefined || short === undefined
            ? undefined
            : { date, hash, short };
        })
      );

  const lastChanges = new Map<
    string,
    { date: string; hash: string; short: string }
  >();

  const trackedPaths = [
    ...publicSpecs.map((spec) => spec.sourcePath),
    ...skillTexts.map((skill) => skill.sourcePath),
  ].filter((sourcePath) => !sourcePath.includes(" "));

  const changes = yield* Effect.forEach(
    trackedPaths,
    (sourcePath) =>
      lastChange(sourcePath).pipe(
        Effect.map((change) => ({ change, sourcePath }))
      ),
    { concurrency: "unbounded" }
  );

  for (const { change, sourcePath } of changes) {
    if (change !== undefined) {
      lastChanges.set(sourcePath, change);
    }
  }

  const pageFooterHtml = (route: string, sourcePath: string) => {
    const lines: string[] = [];
    const change = lastChanges.get(sourcePath);

    if (change !== undefined) {
      lines.push(
        `<p>Last changed ${change.date} in <a href="${repoUrl}/commit/${change.hash}">${change.short}</a>. <a href="${repoUrl}/blob/main/${sourcePath}">Source on GitHub</a>. <a href="/log.md">Change log</a>.</p>`
      );
    }

    const sources = [...(linkedFrom.get(route) ?? [])].toSorted();

    if (sources.length > 0) {
      const links = sources
        .map(
          (source) =>
            `<a href="${source}">${escapeHtml(titles.get(source) ?? source)}</a>`
        )
        .join(", ");

      lines.push(`<p>Linked from: ${links}</p>`);
    }

    return lines.length === 0 ? "" : `<hr>${lines.join("")}`;
  };

  const lawBodies = yield* Effect.forEach(
    publicSpecs.map((spec, index) => ({
      spec,
      targets: publicTargets[index] ?? emptyTargets,
    })),
    ({ spec, targets }) =>
      Effect.gen(function* renderPublicBody() {
        const bodyHtml = yield* compileMarkdownBody(
          spec.rawText,
          compileName(spec),
          highlighter,
          targets
        );

        return {
          bodyHtml: `${bodyHtml}${pageFooterHtml(spec.routePath, spec.sourcePath)}`,
          spec,
        };
      }),
    { concurrency: "unbounded" }
  );

  const skillBodies = yield* Effect.forEach(
    skillTexts.map((skill, index) => ({
      skill,
      targets: skillTargets[index] ?? emptyTargets,
    })),
    ({ skill, targets }) =>
      Effect.gen(function* renderSkillBody() {
        const bodyHtml = yield* compileMarkdownBody(
          skill.rawText,
          skill.sourcePath,
          highlighter,
          targets
        );

        return {
          bodyHtml: `${bodyHtml}${pageFooterHtml(skill.routePath, skill.sourcePath)}`,
          skill,
        };
      }),
    { concurrency: "unbounded" }
  );

  const groupedSkills = skillGroups
    .map((group) => {
      const members = skillBodies
        .map(({ skill }) => skill)
        .filter((skill) => group.names.some((name) => name === skill.name));

      return members.length === 0
        ? ""
        : `### ${group.title}\n\n${entryList(members)}`;
    })
    .filter((group) => group !== "")
    .join("\n\n");

  const searchCapabilitySource = yield* readText(
    "apps/mischief/src/capabilities/search.ts"
  );

  const searchCapabilityExcerpt = searchCapabilitySource
    .split("\n")
    .slice(6)
    .join("\n")
    .trim();

  const homeMarkdownSource = `# 🐀 Rat Stack

The reference for building an app and its cloud as one typed program. Effect owns the hard parts. Alchemy infers the infrastructure from the code. The fence raises the floor, so agents can build it and you can still trust it.

Vendor it like a library. Keep the bins you need and pull the rest.

## Connect an agent

Paste this into your coding agent:

\`\`\`text
Read ${originToken}/llms.txt and use rat-stack as the reference
for how we build: Effect for the hard parts, Alchemy for the
infrastructure, and a fence that makes the easy path the right
one. Search its rules and skills before you write code, follow
its patterns, and tell me when my code breaks them.
\`\`\`

Or connect the MCP server directly:

\`\`\`sh
# Claude Code
claude mcp add --transport http rat-stack ${originToken}/mcp

# Codex
codex mcp add rat-stack --url ${originToken}/mcp
\`\`\`

Cursor reads \`~/.cursor/mcp.json\`:

\`\`\`json
{ "mcpServers": { "rat-stack": { "url": "${originToken}/mcp" } } }
\`\`\`

Install the skills into any agent that reads a skills folder:

\`\`\`sh
npx skills add joelhooks/rat-stack
\`\`\`

Every MCP client works. Clients on protocol 2026-07-28 are served without sessions; older clients get a session of their own, held by a Durable Object.

- [MCP connection details](${originToken}/.well-known/mcp.json)
- [HTTP API docs](${originToken}/openapi.json)
- [Short agent guide](${originToken}/llms.txt)
- [All public agent docs](${originToken}/llms-full.txt)

## Four ideas

- **Pieces.** An Alchemy Layer carries its own infrastructure. A service tag is the product's API. A Layer is one vendor's implementation. Swapping vendors is a one-line change.
- **Trust.** Make the easy path the right path. The codebase and the compiler stop mistakes that rules and style guides can only ask about. Remove a binding and the code that uses it stops compiling.
- **Floor.** Raise the worst case. Small cuts to failure rates multiply how long an agent can run unattended.
- **Range.** Think wider. Building got fast and deploying did not. Layers that carry their own infrastructure close that gap. If it compiles, it deploys.

The [vision](${originToken}/VISION.md) has the sources and the reasoning.

## The shelf

Every piece is a bin you can push in or pull out.

<Diagram alt="A shelf of labeled bins. In today: capability, projections, fence, and stack. Next: a database bin with D1 or PlanetScale. Coming: the agent front door.">

\`\`\`text
  labeled · push in · pull out · self-contained · easy to trash

  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
  │ capability  │ │ projections │ │ fence       │ │ stack       │
  │ one schema  │ │ CLI · HTTP  │ │ types · lint│ │ Alchemy →   │
  │ one handler │ │ MCP · code  │ │ hooks · CI  │ │ Cloudflare  │
  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘
         in              in              in              in

  ┌─────────────┐ ┌─────────────┐
  │ database    │ │ front door  │
  │ D1 or       │ │ REST · MCP  │
  │ PlanetScale │ │ A2A, sandbox│
  └─────────────┘ └─────────────┘
        next           coming
\`\`\`
</Diagram>

What to notice: removing a bin means deleting its package and the one line that provides it. Everything else still passes the checks.

## One capability, every surface

<Diagram alt="One capability projected onto the command line, HTTP with OpenAPI, MCP tools, and sandbox code mode">

\`\`\`text
              ┌─────────────────────────────────────┐
              │  one capability                     │
              │  Effect Schema: input · output · err│
              │  one Effect handler                 │
              │  XState when the work has states    │
              └──────────────────┬──────────────────┘
                                 │  defineCapability
        ┌───────────────┬────────┴──────┬───────────────┐
        ▼               ▼               ▼               ▼
  ┌───────────┐   ┌───────────┐   ┌───────────┐   ┌───────────┐
  │  command  │   │   HTTP    │   │    MCP    │   │  sandbox  │
  │   line    │   │ + OpenAPI │   │   tools   │   │ code mode │
  └───────────┘   └───────────┘   └───────────┘   └───────────┘

  checked by  TypeScript 7 · Oxlint · Vitest · lefthook
  shipped by  pnpm · Turborepo · Alchemy → Cloudflare Worker
\`\`\`
</Diagram>

What to notice: the four boxes share one handler and one set of schemas. Add a capability once and every surface picks it up.

## The pattern in code

This is the whole search capability. Every surface below calls it.

\`\`\`ts
${searchCapabilityExcerpt}
\`\`\`

What to notice: the schemas and handler live together, so the command line, HTTP, MCP, and sandbox projections cannot quietly disagree.

## Learn the stack

Skills are short guides your agent can install (see above). You can also just read them here.

${groupedSkills}

These pieces are pre-release (Effect 4 rc, XState 6 alpha, TypeScript 7, Alchemy beta). APIs move; \`pins.md\` has the exact versions this repo builds against.

## Source files

${entryList(publicSpecs)}

`;

  const homeMarkdownTemplate = deriveAgentMarkdown(homeMarkdownSource);

  const skillIndexMarkdown = `# Learn the stack

These four skills use a working app to teach the pieces inside it.

Install them:

\`npx skills add joelhooks/rat-stack\`

${groupedSkills}
`;

  const homeBodyHtml = yield* compileMarkdownBody(
    homeMarkdownSource,
    "ratstack-home.md",
    highlighter
  );

  const skillIndexBodyHtml = yield* compileMarkdownBody(
    skillIndexMarkdown,
    "ratstack-skills.md",
    highlighter
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

  // Compute the cache version from rendered bodies before wrapping them in the
  // shell. The shell receives this version in its og:image URL, so including
  // complete documents here would create a digest cycle.
  const contentVersion = digest(
    [
      homeMarkdownTemplate,
      homeBodyHtml,
      skillIndexMarkdown,
      skillIndexBodyHtml,
      emojiSvg,
      ...publicSpecs.map((spec) => spec.text),
      ...lawBodies.map(({ bodyHtml }) => bodyHtml),
      ...skillTexts.map((skill) => skill.text),
      ...skillBodies.map(({ bodyHtml }) => bodyHtml),
      ...staticSourceText,
    ].join("\u0000")
  ).slice(0, 16);

  const homeMetadata = {
    description:
      "The reference for building an app and its cloud as one typed program, with Effect, Alchemy, and a fence that raises the floor.",
    path: "/",
    title: "Rat Stack: an app and its cloud as one typed program",
  } as const;

  const skillIndexMetadata = {
    description:
      "Four hands-on guides to Effect actions, XState lifecycles, and the seams between stack pieces.",
    path: "/skills",
    title: "Learn the stack | rat-stack",
  } as const;

  const ogPages: readonly OgPage[] = [
    {
      description: homeMetadata.description,
      routePath: "/",
      title: "ratstack.sh",
    },
    {
      description: skillIndexMetadata.description,
      routePath: "/skills",
      title: "Learn the stack",
    },
    ...publicSpecs.map(({ description, routePath, title }) => ({
      description,
      routePath,
      title,
    })),
    ...skillTexts.map(({ description, name, routePath }) => ({
      description,
      routePath,
      title: name,
    })),
  ];

  const ogImages = yield* Effect.forEach(
    ogPages,
    (page) =>
      renderOgImage(
        page,
        emojiSvg,
        Buffer.from(regularFont),
        Buffer.from(boldFont)
      ).pipe(
        Effect.map((png) => ({
          pngBase64: Buffer.from(png).toString("base64"),
          routePath: page.routePath,
        }))
      ),
    { concurrency: 4 }
  );

  const faviconIcoBase64 = Buffer.from(
    encodeIco(
      yield* Effect.forEach([16, 32, 48], (size) =>
        renderRatPng(emojiSvg, size).pipe(
          Effect.map((bytes) => ({ bytes: new Uint8Array(bytes), size }))
        )
      )
    )
  ).toString("base64");

  const appleTouchIconPngBase64 = Buffer.from(
    yield* renderRatPng(emojiSvg, 180, "white")
  ).toString("base64");

  const lawSources = yield* Effect.forEach(
    lawBodies,
    ({ bodyHtml, spec }) =>
      Effect.gen(function* renderPublic() {
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
          spec.sourcePath,
          contentVersion
        );

        return {
          description: spec.description,
          digest: digest(spec.text),
          documentHtml,
          routePath: spec.routePath,
          sourcePath: spec.sourcePath,
          text: spec.text,
          title: spec.title,
        };
      }),
    { concurrency: "unbounded" }
  );

  const skillSources = yield* Effect.forEach(
    skillBodies,
    ({ bodyHtml, skill }) =>
      Effect.gen(function* renderSkill() {
        const documentHtml = yield* makeDocument(
          bodyHtml,
          {
            breadcrumbHref: "/skills",
            breadcrumbLabel: "skills",
            breadcrumbName: skill.name,
            description: skill.description,
            path: skill.routePath,
            title: `${skill.name} | rat-stack`,
          },
          skill.sourcePath,
          contentVersion
        );

        return {
          description: skill.description,
          digest: digest(skill.text),
          documentHtml,
          name: skill.name,
          routePath: skill.routePath,
          sourcePath: skill.sourcePath,
          text: skill.text,
        };
      }),
    { concurrency: "unbounded" }
  );

  const homeDocumentHtml = yield* makeDocument(
    homeBodyHtml,
    homeMetadata,
    "ratstack-home.md",
    contentVersion
  );

  const skillIndexDocumentHtml = yield* makeDocument(
    skillIndexBodyHtml,
    skillIndexMetadata,
    "ratstack-skills.md",
    contentVersion
  );

  const staticContentVersion = contentVersion;

  const generated = `// Generated by scripts/generate-content.ts. Do not edit by hand.\n\nexport const originToken = ${sourceLiteral(originToken)} as const;\n\nexport const staticContentVersion = ${sourceLiteral(staticContentVersion)} as const;\n\nexport const ogImagePath = (routePath: string) => "/og" + (routePath === "/" ? "/home" : routePath) + ".png";\n\nexport const ogImages = ${sourceLiteral(ogImages)} as const;\n\nexport const ratSvg = ${sourceLiteral(emojiSvg)} as const;\n\nexport const faviconIcoBase64 = ${sourceLiteral(faviconIcoBase64)} as const;\n\nexport const appleTouchIconPngBase64 = ${sourceLiteral(appleTouchIconPngBase64)} as const;\n\nexport const homeMarkdownTemplate = ${sourceLiteral(homeMarkdownTemplate)} as const;\n\nexport const homeDocumentHtml = ${sourceLiteral(homeDocumentHtml)} as const;\n\nexport const skillIndexMarkdown = ${sourceLiteral(skillIndexMarkdown)} as const;\n\nexport const skillIndexDocumentHtml = ${sourceLiteral(skillIndexDocumentHtml)} as const;\n\nexport const lawSources = ${sourceLiteral(lawSources)} as const;\n\nexport const skillSources = ${sourceLiteral(skillSources)} as const;\n`;

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
