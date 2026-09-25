import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import {
  assertSkillGroups,
  ContentBuildError,
  debtLedgerMarkdown,
  deriveAgentMarkdown,
  deriveHtmlMarkdown,
  encodeIco,
  internalRouteForLink,
  isDebtSourcePath,
  loreLinkTargets,
  parseDebtLintOutput,
  parseLorePage,
  validateInternalLinks,
} from "../scripts/content-lib.ts";
import {
  appleTouchIconPngBase64,
  faviconIcoBase64,
  homeDocumentHtml,
  lawSources,
  loreSources,
  ogImages,
  skillSources,
} from "../src/bundled-content.generated.js";

const fakePng = (size: number) => new Uint8Array(size).fill(size);

const root = (path: Path.Path) => path.resolve(import.meta.dirname, "../../..");

it.effect("decodes Oxlint JSON and formats the debt ledger", () =>
  Effect.sync(() => {
    const output = JSON.stringify({
      diagnostics: [
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "root.config.ts",
          labels: [{ span: { column: 0, length: 10, line: 1, offset: 0 } }],
          message: JSON.stringify({
            directive: "@ts-nocheck",
            kind: "typescript",
            reason: "root config directive",
          }),
          severity: "error",
        },
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "apps/sample.ts",
          labels: [{ span: { column: 0, length: 10, line: 3, offset: 50 } }],
          message: JSON.stringify({
            directive: [
              "@effect-diagnostics",
              "-next-line asyncFunction:off",
            ].join(""),
            kind: "effect-diagnostics",
            reason: "typed boundary",
          }),
          severity: "error",
        },
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "apps/sample.ts",
          labels: [{ span: { column: 0, length: 10, line: 4, offset: 80 } }],
          message: JSON.stringify({
            directive: "@ts-expect-error",
            kind: "typescript",
          }),
          severity: "error",
        },
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "apps/sample.ts",
          labels: [{ span: { column: 0, length: 10, line: 2, offset: 20 } }],
          message: JSON.stringify({
            directive: "oxlint-disable-next-line no-console",
            kind: "oxlint",
            reason: "fixture reason",
          }),
          severity: "error",
        },
      ],
      number_of_files: 4,
      number_of_rules: 1,
      start_time: 0.08,
      threads_count: 16,
    });

    const result = parseDebtLintOutput(output);
    const markdown = debtLedgerMarkdown(result.entries);

    expect(result).toMatchObject({ fileCount: 4, ruleCount: 1 });
    expect(result.entries).toHaveLength(4);
    expect(result.entries[0]).toMatchObject({
      directive: "oxlint-disable-next-line no-console",
      file: "apps/sample.ts",
      line: 2,
      reason: "fixture reason",
    });
    expect(result.entries[2]?.reason).toBeUndefined();
    expect(markdown).toContain('> "Debt only shrinks."');
    expect(markdown).toContain("Total: **4** directives.");
    expect(markdown).toContain("apps/sample.ts:2");
    expect(markdown).toContain("no reason given");
    expect(markdown).toContain("Dillon Mulroy's code");
    expect(markdown).toBe(debtLedgerMarkdown(result.entries));
    expect(isDebtSourcePath("root.config.ts")).toBe(true);
    expect(isDebtSourcePath("tools/oxlint/anti-slop/vendor.ts")).toBe(false);
    expect(isDebtSourcePath("apps/generated.generated.ts")).toBe(false);
    expect(() => parseDebtLintOutput("not JSON")).toThrow(ContentBuildError);
  })
);

it.effect("requires every discovered skill to have a group", () =>
  Effect.sync(() => {
    expect(() => {
      assertSkillGroups(
        ["learn-rat-stack", "unassigned-skill"],
        [{ names: ["learn-rat-stack"] }]
      );
    }).toThrow(ContentBuildError);
    expect(() => {
      assertSkillGroups(
        ["learn-rat-stack", "unassigned-skill"],
        [{ names: ["learn-rat-stack"] }]
      );
    }).toThrow("skills/unassigned-skill/SKILL.md");
  })
);

it.effect("rejects unserved relative and absolute internal links", () =>
  Effect.sync(() => {
    const knownRoutes = new Set(["/", "/resources/peers.svx"]);

    expect(
      internalRouteForLink("../projects/hidden.svx", "/resources/peers.svx")
    ).toBe("/projects/hidden.svx");
    expect(() => {
      validateInternalLinks({
        knownRoutes,
        pageRoute: "/resources/peers.svx",
        sourcePath: ".brain/resources/peers.svx",
        text: "[broken](/resources/missing.svx)",
      });
    }).toThrow(/internal link \/resources\/missing\.svx failed for/u);
    expect(() => {
      validateInternalLinks({
        knownRoutes,
        pageRoute: "/resources/peers.svx",
        sourcePath: ".brain/resources/peers.svx",
        text: "[relative](./missing.svx)",
      });
    }).toThrow(/\.\/missing\.svx/u);
    expect(() => {
      validateInternalLinks({
        knownRoutes,
        pageRoute: "/resources/peers.svx",
        sourcePath: ".brain/resources/peers.svx",
        text: "[external](https://example.com/page)",
      });
    }).not.toThrow();
  })
);

it.effect("rejects malformed lore frontmatter and filename slugs", () =>
  Effect.sync(() => {
    const invalidFrontmatterPath = ".brain/resources/lore/one-idea.svx";
    const invalidSlugPath = ".brain/resources/lore/Bad_slug.svx";
    const validFields = `---\ntitle: "One idea"\ndescription: "A short sentence."\nsources: []\n---\n`;

    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        `---\ndescription: "A short sentence."\nsources: []\n---\n`
      )
    ).toThrow(
      new RegExp(`frontmatter failed for ${invalidFrontmatterPath}`, "u")
    );
    expect(() => parseLorePage(invalidSlugPath, validFields)).toThrow(
      new RegExp(`frontmatter failed for ${invalidSlugPath}`, "u")
    );
    expect(() => parseLorePage(invalidSlugPath, validFields)).toThrow(
      ContentBuildError
    );
    expect(parseLorePage(invalidFrontmatterPath, validFields).sources).toEqual(
      []
    );
    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        validFields.replace(
          "sources: []",
          "sources:\n  - http://example.com/source"
        )
      )
    ).toThrow(ContentBuildError);
    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        validFields.replace(
          "A short sentence.",
          "First sentence. Second sentence."
        )
      )
    ).toThrow(ContentBuildError);
  })
);

it.effect("rejects links to missing lore pages with their source path", () =>
  Effect.sync(() => {
    const sourcePath = ".brain/resources/lore/one-idea.svx";

    expect(() =>
      loreLinkTargets(
        sourcePath,
        "See [a missing idea](/lore/not-here).",
        new Set(["/lore/one-idea"])
      )
    ).toThrow(new RegExp(`lore link failed for ${sourcePath}`, "u"));
  })
);

const tagFreeSources = [
  "AGENTS.md",
  "VISION.md",
  "README.md",
  "vendor/README.md",
  "skills/add-a-capability/SKILL.md",
  "skills/add-a-lifecycle-machine/SKILL.md",
  "skills/keep-or-cut/SKILL.md",
  "skills/learn-alchemy/SKILL.md",
  "skills/learn-rat-stack/SKILL.md",
];

it.layer(NodeServices.layer)("generated content", (test) => {
  test.effect("the Oxlint ledger rule reads directives from comments", () =>
    Effect.gen(function* readsOnlyCommentDirectives() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const repository = root(path);
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const fixturePath = path.join(directory, "debt-ledger-fixture.ts");
      const effectDiagnostics = ["@effect", "-diagnostics"].join("");

      const fixture = [
        `const mention = "oxlint-disable ${effectDiagnostics} @ts-ignore";`,
        "// oxlint-disable-next-line test/rule -- lint reason",
        "const lintDirective = true;",
        `// ${effectDiagnostics}-next-line testRule:off -- Effect reason`,
        "const effectDirective = true;",
        "// @ts-expect-error -- TypeScript reason",
        "const typed: string = 1;",
        "// oxlint-enable test/rule -- not debt",
      ].join("\n");

      yield* fileSystem.writeFileString(fixturePath, fixture);

      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "pnpm",
          [
            "exec",
            "oxlint",
            "--config",
            path.join(repository, "scripts/oxlint-debt-ledger.config.ts"),
            "-A",
            "all",
            "-D",
            "rat-stack-debt/debt-ledger",
            "--format",
            "json",
            "--no-ignore",
            fixturePath,
          ],
          { cwd: repository }
        )
      );

      const [json, stderr] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" }
      );

      const exitCode = yield* handle.exitCode;
      const result = parseDebtLintOutput(json);

      expect(exitCode).toBe(1);
      expect(stderr).toBe("");
      expect(result).toMatchObject({ fileCount: 1, ruleCount: 1 });
      expect(
        result.entries.map(({ directive, kind, line, reason }) => ({
          directive,
          kind,
          line,
          reason,
        }))
      ).toEqual([
        {
          directive: "oxlint-disable-next-line test/rule",
          kind: "oxlint",
          line: 2,
          reason: "lint reason",
        },
        {
          directive: `${effectDiagnostics}-next-line testRule:off`,
          kind: "effect-diagnostics",
          line: 4,
          reason: "Effect reason",
        },
        {
          directive: "@ts-expect-error",
          kind: "typescript",
          line: 6,
          reason: "TypeScript reason",
        },
      ]);
    })
  );

  test.effect("keeps tag-free source documents byte-identical for agents", () =>
    Effect.gen(function* tagFreeSourcesRoundTrip() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repository = root(path);

      for (const source of tagFreeSources) {
        const text = yield* fileSystem.readFileString(
          path.join(repository, source)
        );

        expect(deriveAgentMarkdown(text), source).toBe(text);
      }
    })
  );

  test.effect("derives the agent and HTML audience representations", () =>
    Effect.sync(() => {
      const fixture = `# Audience\n\n<AgentOnly>\nAgent instruction.\n</AgentOnly>\n\n<HumanOnly>\nHuman caption.\n</HumanOnly>\n\n<Diagram alt="A small map">\n\n\`\`\`text\n┌─┐\n└─┘\n\`\`\`\n</Diagram>\n`;
      const agent = deriveAgentMarkdown(fixture);
      const html = deriveHtmlMarkdown(fixture);

      expect(agent).toContain("Agent instruction.");
      expect(agent).not.toContain("Human caption.");
      expect(agent).toContain("```text\n┌─┐\n└─┘\n```");
      expect(agent).toContain("Diagram: A small map");
      expect(agent).not.toContain("<AgentOnly>");
      expect(agent).not.toContain("<Diagram");

      expect(html).not.toContain("<AgentOnly>");
      expect(html).toContain("Human caption.");
      expect(html).toContain('<figure role="img" aria-label="A small map">');
      expect(html).toContain("<figcaption>A small map</figcaption>");
    })
  );

  test.effect("uses Shiki for code and leaves text diagrams uncoloured", () =>
    Effect.sync(() => {
      expect(homeDocumentHtml).toContain('class="shiki catppuccin-latte"');
      expect(homeDocumentHtml).toMatch(
        /<figure role="img"[^>]*>\s*<pre><code>/u
      );
      expect(homeDocumentHtml).not.toMatch(
        /<figure role="img"[^>]*>\s*<pre[^>]*style=/u
      );
    })
  );

  test.effect("packs PNG images into an ICO directory", () =>
    Effect.sync(() => {
      const ico = encodeIco([
        { bytes: fakePng(3), size: 16 },
        { bytes: fakePng(5), size: 256 },
      ]);

      const view = new DataView(ico.buffer);

      expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
      expect(ico[6]).toBe(16);
      expect(view.getUint16(6 + 6, true)).toBe(32);
      expect(view.getUint32(6 + 8, true)).toBe(3);
      expect(view.getUint32(6 + 12, true)).toBe(38);
      expect(ico[22]).toBe(0);
      expect(view.getUint32(22 + 12, true)).toBe(41);
      expect(ico.length).toBe(38 + 3 + 5);
    })
  );

  test.effect("renders the rat as a favicon and a touch icon", () =>
    Effect.sync(() => {
      const ico = Buffer.from(faviconIcoBase64, "base64");
      expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);
      expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);

      const touch = Buffer.from(appleTouchIconPngBase64, "base64");
      expect([...touch.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      expect(touch.readUInt32BE(16)).toBe(180);
      expect(touch.readUInt32BE(20)).toBe(180);
    })
  );

  test.effect("embeds the shared stylesheet in static documents", () =>
    Effect.sync(() => {
      const stylesheet =
        /<style>(?<css>[\s\S]*?)<\/style>/u.exec(homeDocumentHtml)?.groups
          ?.css ?? "";

      expect(stylesheet).toContain("ui-monospace");
      expect(stylesheet).toContain("max-width: 80ch");
      expect(homeDocumentHtml).not.toContain('rel="stylesheet"');
    })
  );

  test.effect("keeps the line breaks in a text diagram", () =>
    Effect.sync(() => {
      const figures = homeDocumentHtml.match(
        /<figure role="img"[\s\S]*?<\/figure>/gu
      );

      expect(figures?.length).toBeGreaterThan(0);

      for (const figure of figures ?? []) {
        expect(figure).toMatch(/┐\n/u);
      }
    })
  );

  test.effect("generates a 1200x630 PNG for every public page", () =>
    Effect.sync(() => {
      const expected = new Set([
        "/",
        "/skills",
        "/lore",
        "/--no-verify",
        ...lawSources.map((source) => source.routePath),
        ...loreSources.map((lore) => lore.routePath),
        ...skillSources.map((skill) => skill.routePath),
      ]);

      expect(new Set(ogImages.map((image) => image.routePath))).toEqual(
        expected
      );

      for (const image of ogImages) {
        const png = Buffer.from(image.pngBase64, "base64");
        expect(png.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        );
        expect(png.readUInt32BE(16)).toBe(1200);
        expect(png.readUInt32BE(20)).toBe(630);
      }
    })
  );
});
