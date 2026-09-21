import { learnRatStackSource } from "./bundled-content.generated.js";

export { agentLaw } from "./bundled-content.generated.js";

export const AGENT_LAW_URI = "ratstack://repo/AGENTS.md";

export const agentPage = `# rat-stack

An Effect-first TypeScript stack for agents. Define one schema-typed capability, then project it to CLI, HTTP, MCP, and code mode.

## Start here

1. Read \`AGENTS.md\` for the project law.
2. Read \`VISION.md\` for product intent.
3. Add behavior with \`defineCapability\`.
4. Add the capability to the catalog.
5. Run \`pnpm turbo run check test build\`.

## Connect

MCP endpoint: \`/mcp\`
Protocol: \`2026-07-28\`

The prototype MCP exposes the project law as a resource and a guided learn-rat-stack prompt.
`;

export const llmsText = `# rat-stack

> An Effect-first TypeScript template where one schema-typed capability projects to CLI, HTTP, MCP, and code mode.

## Start here

- [Agent-first guide](https://ratstack.sh/): The shortest path into the stack.
- [MCP endpoint](https://ratstack.sh/mcp): The project law and learn-rat-stack prompt over Streamable HTTP.
`;

export const robotsText = `User-agent: *
Allow: /
Content-Signal: ai-train=no, search=yes, ai-input=yes
`;

export interface BundledSkill {
  readonly body: string;
  readonly description: string;
  readonly name: string;
  readonly raw: string;
}

const skillPattern =
  /^---\r?\nname: (?<name>[^\r\n]+)\r?\ndescription: (?<description>[^\r\n]+)\r?\n---\r?\n(?<body>[\s\S]*)$/u;

const parseBundledSkill = (raw: string): BundledSkill => {
  const match = skillPattern.exec(raw);
  const name = match?.groups?.name;
  const description = match?.groups?.description;
  const body = match?.groups?.body;
  if (name === undefined || description === undefined || body === undefined) {
    throw new Error(
      "skills/learn-rat-stack/SKILL.md must contain name and description frontmatter"
    );
  }
  return { body, description, name, raw };
};

export const learnRatStack = parseBundledSkill(learnRatStackSource);

const escapeHtml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const agentPageHtml = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>rat-stack</title>
<meta name="description" content="An Effect-first TypeScript stack for agents.">
<meta property="og:type" content="website">
<meta property="og:title" content="rat-stack">
<meta property="og:description" content="One schema-typed capability, every agent surface.">
<meta property="og:url" content="https://ratstack.sh/">
<meta property="og:image" content="https://ratstack.sh/og.png">
<style>body{margin:0;background:#262829;color:#faf5e9;font:16px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}pre{box-sizing:border-box;max-width:76ch;margin:0 auto;padding:2rem 1.25rem;white-space:pre-wrap;overflow-wrap:anywhere}</style>
</head>
<body><pre>${escapeHtml(agentPage)}</pre></body>
</html>
`;
