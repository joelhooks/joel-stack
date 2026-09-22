const audienceTag =
  /<(?:AgentOnly|HumanOnly|Diagram)(?:\s[^>]*)?>|<\/(?:AgentOnly|HumanOnly|Diagram)>/u;
const agentBlock =
  /<AgentOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/AgentOnly>/gu;
const humanBlock =
  /<HumanOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/HumanOnly>/gu;
const diagramBlock =
  /<Diagram\s+alt="(?<alt>[^"]*)">\s*\r?\n(?<fence>```text\r?\n[\s\S]*?\r?\n```)\s*\r?\n<\/Diagram>/gu;
const diagramFence = /```text\r?\n(?<body>[\s\S]*?)\r?\n```/u;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * Smart mdsvex blocks are source-level audience components:
 *
 * - `<AgentOnly>` keeps its contents for agents and drops them from HTML.
 * - `<HumanOnly>` keeps its contents for HTML and drops them for agents.
 * - `<Diagram alt="...">` keeps a text fence plus `Diagram: ...` for agents,
 *   and becomes an accessible figure for HTML.
 *
 * Tags must occupy their own block lines. Sources without these tags return
 * byte-for-byte unchanged.
 */
export const deriveAgentMarkdown = (source: string): string => {
  if (!audienceTag.test(source)) {
    return source;
  }
  const withoutHuman = source.replaceAll(humanBlock, "");
  const withDiagramText = withoutHuman.replaceAll(
    diagramBlock,
    (_match, ...captures: unknown[]) => {
      const groups = captures.at(-1);
      const record =
        typeof groups === "object" && groups !== null
          ? (groups as { alt?: string; fence?: string })
          : {};
      const fence = record.fence ?? "```text\n\n```";
      const alt = record.alt ?? "Diagram";
      return `${fence}\nDiagram: ${alt}`;
    }
  );
  return withDiagramText.replaceAll(agentBlock, "$<content>");
};

export const deriveHtmlMarkdown = (source: string): string => {
  if (!audienceTag.test(source)) {
    return source;
  }
  const withDiagrams = source.replaceAll(
    diagramBlock,
    (_match, ...captures: unknown[]) => {
      const groups = captures.at(-1);
      const record =
        typeof groups === "object" && groups !== null
          ? (groups as { alt?: string; fence?: string })
          : {};
      const alt = record.alt ?? "Diagram";
      const fence = record.fence ?? "```text\n\n```";
      const body = diagramFence.exec(fence)?.groups?.body ?? fence;
      return `<figure role="img" aria-label="${escapeHtml(alt)}"><pre><code>${escapeHtml(body)}</code></pre><figcaption>${escapeHtml(alt)}</figcaption></figure>`;
    }
  );
  const withoutAgent = withDiagrams.replaceAll(agentBlock, "");
  return withoutAgent.replaceAll(humanBlock, "$<content>");
};

export const hasAudienceSyntax = (source: string) => audienceTag.test(source);
