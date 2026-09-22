import { lawSources, skillSources } from "./bundled-content.generated.js";

export type ContentKind = "law" | "skill";

export interface ContentResource {
  readonly description: string;
  readonly digest: string;
  readonly id: string;
  readonly kind: ContentKind;
  readonly name: string;
  readonly routePath: `/${string}`;
  readonly sourcePath: string;
  readonly text: string;
  readonly title: string;
}

export const lawResources: readonly ContentResource[] = lawSources.map(
  (source) => ({
    ...source,
    id: `ratstack://repo/${
      source.routePath === "/pins.md"
        ? "pins.md"
        : source.sourcePath.replace(/^\.brain\//u, "")
    }`,
    kind: "law" as const,
    name: source.routePath.slice(1),
  })
);

export const skills: readonly ContentResource[] = skillSources.map(
  (source) => ({
    ...source,
    id: `ratstack://skills/${source.name}`,
    kind: "skill" as const,
    title: source.name,
  })
);

export const contentResources: readonly ContentResource[] = [
  ...lawResources,
  ...skills,
];

const entryList = (resources: readonly ContentResource[]) =>
  resources
    .map(
      (resource) =>
        `- [${resource.title}](${resource.routePath}) — ${resource.description}`
    )
    .join("\n");

const skillGroups = [
  {
    names: ["learn-rat-stack"],
    title: "Learn",
  },
  {
    names: ["add-a-capability", "add-a-lifecycle-machine"],
    title: "Build",
  },
  {
    names: ["keep-or-cut"],
    title: "Shape a clone",
  },
] as const;

const groupedSkills = () =>
  skillGroups
    .map((group) => {
      const members = skills.filter((skill) =>
        group.names.some((name) => name === skill.name)
      );
      return members.length === 0
        ? ""
        : `### ${group.title}\n\n${entryList(members)}`;
    })
    .filter((group) => group !== "")
    .join("\n\n");

export const markdownDocument = (origin: string) => `# ratstack.sh

> A source-first TypeScript scaffold where one schema-typed capability projects to CLI, HTTP, MCP, and sandboxed code mode.

\`npx skills add joelhooks/rat-stack\`

## Skills

${groupedSkills()}

## Law

${entryList(lawResources)}

## MCP

Connect a modern stateless MCP client to [${origin}/mcp](${origin}/mcp). The server exposes \`search\`, \`read\`, and sandboxed \`execute\` tools, every law file as a resource, and every skill as a prompt.

- [MCP server card](${origin}/.well-known/mcp.json)
- [OpenAPI](${origin}/openapi.json)
- [Agent index](${origin}/llms.txt)
- [Full agent corpus](${origin}/llms-full.txt)
`;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const htmlDocument = (origin: string) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ratstack.sh</title>
<meta name="description" content="Effect-native capabilities projected to CLI, HTTP, MCP, and sandboxed code mode.">
<meta property="og:title" content="ratstack.sh">
<meta property="og:description" content="A source-first TypeScript capability stack.">
<meta property="og:type" content="website">
<meta property="og:url" content="${origin}/">
<meta property="og:image" content="${origin}/og.png">
<style>
:root{color-scheme:dark}body{margin:0;background:#10110f;color:#e9eddc;font:16px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace}main{max-width:76ch;margin:auto;padding:3rem 1.25rem}pre{white-space:pre-wrap;overflow-wrap:anywhere}a{color:#bbdb78}
</style>
</head>
<body><main><pre>${escapeHtml(markdownDocument(origin))}</pre></main></body>
</html>`;

export const mcpVersionText = (origin: string) =>
  `ratstack.sh MCP supports protocol 2026-07-28 only.\nSee ${origin}/llms.txt for connection details.\n`;

export const llmsText = (origin: string) => `# ratstack.sh

> Effect-native TypeScript capabilities with CLI, HTTP, MCP, and sandboxed code-mode projections.

## Entry points

- [Repository map](${origin}/): concise human and agent overview
- [Full corpus](${origin}/llms-full.txt): all public law and skill documents in one response
- [OpenAPI](${origin}/openapi.json): generated HTTP capability contract
- [MCP](${origin}/mcp): stateless MCP endpoint

## MCP

Protocol 2026-07-28 only. Legacy clients should read [this file](${origin}/llms.txt) and upgrade before connecting.

Rate limits: 120 API or MCP requests per IP per 60 seconds; \`execute\` is additionally limited to 6 per IP and 300 total per 60 seconds. Cloudflare counts approximately per location.

## Law

${entryList(lawResources)}

## Skills

${entryList(skills)}
`;

export const llmsFullText = (origin: string) =>
  [
    llmsText(origin),
    ...contentResources.map(
      (resource) =>
        `\n---\n\n# ${resource.routePath}\n\nSource: ${resource.sourcePath}\nSHA-256: ${resource.digest}\n\n${resource.text}`
    ),
  ].join("\n");

export const skillIndex = () => `# Rat-stack skills

Install all four skills:

\`npx skills add joelhooks/rat-stack\`

${groupedSkills()}
`;

export const robotsText = `User-agent: *
Allow: /
Content-Signal: ai-train=no, search=yes, ai-input=yes

User-agent: GPTBot
User-agent: OAI-SearchBot
User-agent: Claude-Web
User-agent: Google-Extended
User-agent: Amazonbot
User-agent: anthropic-ai
User-agent: Bytespider
User-agent: CCBot
User-agent: Applebot-Extended
Allow: /

Sitemap: https://ratstack.sh/sitemap.xml
`;

export const agentSkillPath = (name: string) =>
  `/.well-known/agent-skills/${name}/SKILL.md` as const;

export const publicPaths = [
  "/",
  "/llms.txt",
  "/llms-full.txt",
  "/openapi.json",
  "/robots.txt",
  "/sitemap.xml",
  "/skills",
  "/.well-known/agent-skills/index.json",
  "/.well-known/api-catalog",
  "/.well-known/mcp.json",
  ...lawResources.map((resource) => resource.routePath),
  ...skills.flatMap((skill) => [skill.routePath, agentSkillPath(skill.name)]),
] as const;

export const sitemapXml = (
  origin: string
) => `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${publicPaths.map((path) => `  <url><loc>${origin}${path}</loc></url>`).join("\n")}
</urlset>
`;

export const linkHeader = [
  `</.well-known/api-catalog>; rel="api-catalog"`,
  `</.well-known/mcp.json>; rel="service-desc"; type="application/json"`,
  `</.well-known/agent-skills/index.json>; rel="describedby"; type="application/json"`,
  `</llms.txt>; rel="describedby"; type="text/markdown"`,
  `</>; rel="alternate"; type="text/markdown"`,
].join(", ");

export const agentSkillsIndex = () => ({
  $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
  skills: skills.map((skill) => ({
    description: skill.description,
    digest: `sha256:${skill.digest}`,
    name: skill.name,
    type: "skill-md",
    url: agentSkillPath(skill.name),
  })),
});

export const apiCatalog = (origin: string) => ({
  linkset: [
    {
      anchor: `${origin}/mcp`,
      "service-desc": [
        {
          href: `${origin}/.well-known/mcp.json`,
          type: "application/json",
        },
        {
          href: `${origin}/openapi.json`,
          type: "application/json",
        },
      ],
      "service-doc": [{ href: `${origin}/llms.txt`, type: "text/markdown" }],
    },
  ],
});

export const mcpServerCard = (origin: string) => ({
  authentication: { required: false },
  capabilities: {
    prompts: {},
    resources: {},
    tools: {},
  },
  protocolVersion: "2026-07-28",
  serverInfo: { name: "sh.ratstack/rat-stack", version: "0.2.0" },
  transport: { endpoint: `${origin}/mcp`, type: "streamable-http" },
});

export interface SearchMatch {
  readonly description: string;
  readonly digest: string;
  readonly excerpt: string;
  readonly id: string;
  readonly kind: ContentKind;
  readonly routePath: `/${string}`;
  readonly score: number;
  readonly title: string;
}

const occurrences = (value: string, term: string) => {
  if (term === "") {
    return 0;
  }
  let count = 0;
  let offset = 0;
  while ((offset = value.indexOf(term, offset)) !== -1) {
    count += 1;
    offset += term.length;
  }
  return count;
};

const excerptAround = (text: string, query: string) => {
  const normalized = text.toLowerCase();
  const index = normalized.indexOf(query.toLowerCase());
  const start = Math.max(0, index === -1 ? 0 : index - 90);
  const excerpt = text
    .slice(start, start + 260)
    .replaceAll(/\s+/gu, " ")
    .trim();
  return `${start > 0 ? "…" : ""}${excerpt}${start + 260 < text.length ? "…" : ""}`;
};

export const searchContent = (
  query: string,
  requestedLimit = 5
): readonly SearchMatch[] => {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/u)
    .filter((term) => term.length > 1);
  const limit = Math.max(1, Math.min(20, Math.trunc(requestedLimit)));
  const queryText = terms.join(" ");

  return contentResources
    .map((resource) => {
      const title = resource.title.toLowerCase();
      const description = resource.description.toLowerCase();
      const text = resource.text.toLowerCase();
      const score =
        (queryText !== "" && title.includes(queryText) ? 40 : 0) +
        terms.reduce(
          (total, term) =>
            total +
            occurrences(title, term) * 12 +
            occurrences(description, term) * 6 +
            Math.min(10, occurrences(text, term)),
          0
        );
      return { resource, score };
    })
    .filter(({ score }) => queryText === "" || score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.resource.title.localeCompare(right.resource.title)
    )
    .slice(0, limit)
    .map(({ resource, score }) => ({
      description: resource.description,
      digest: resource.digest,
      excerpt: excerptAround(resource.text, queryText),
      id: resource.id,
      kind: resource.kind,
      routePath: resource.routePath,
      score,
      title: resource.title,
    }));
};

export const readContent = (id: string): ContentResource | undefined =>
  contentResources.find(
    (resource) => resource.id === id || resource.routePath === id
  );
