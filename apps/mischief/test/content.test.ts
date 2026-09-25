import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  ContentBuildError,
  deriveAgentMarkdown,
  deriveHtmlMarkdown,
  encodeIco,
  loreLinkTargets,
  parseLorePage,
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
