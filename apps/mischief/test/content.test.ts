import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  deriveAgentMarkdown,
  deriveHtmlMarkdown,
} from "../scripts/content-lib.ts";
import {
  homeDocumentHtml,
  lawSources,
  ogImages,
  skillSources,
} from "../src/bundled-content.generated.js";

const root = (path: Path.Path) => path.resolve(import.meta.dirname, "../../..");

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
      expect(homeDocumentHtml).toMatch(/<figure role="img"[^>]*><pre><code>/u);
      expect(homeDocumentHtml).not.toMatch(
        /<figure role="img"[^>]*><pre[^>]*style=/u
      );
    })
  );

  test.effect("generates a 1200x630 PNG for every public page", () =>
    Effect.sync(() => {
      const expected = new Set([
        "/",
        "/skills",
        ...lawSources.map((source) => source.routePath),
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
