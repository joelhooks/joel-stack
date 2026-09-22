import {
  homeMarkdownTemplate,
  lawSources,
  originToken,
  skillIndexMarkdown,
  skillSources,
} from "./bundled-content.generated.js";

export {
  homeDocumentHtml,
  skillIndexDocumentHtml,
  staticContentVersion,
} from "./bundled-content.generated.js";

export type ContentKind = "law" | "skill";

export interface ContentResource {
  readonly description: string;
  readonly digest: string;
  readonly documentHtml: string;
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

export const markdownDocument = (origin: string) =>
  homeMarkdownTemplate.replaceAll(originToken, origin);

export const mcpVersionText = (origin: string) =>
  `ratstack.sh MCP supports protocol 2026-07-28 only.\nSee ${origin}/llms.txt for connection details.\n`;

export const llmsText = (origin: string) => `# ratstack.sh

Use this working app to learn Effect, XState, TypeScript, Alchemy, and agent interfaces together.

## Read this repo

- [Home](${origin}/): short overview
- [All public docs](${origin}/llms-full.txt): rules and skills in one response
- [HTTP API](${origin}/openapi.json): routes, inputs, outputs, and errors
- [MCP server](${origin}/mcp): tools for search, reading, and sandboxed code

## Connect with MCP

Use protocol 2026-07-28. Older clients need to upgrade before connecting.

Each IP may make 120 API or MCP requests per 60 seconds. \`execute\` also allows 6 calls per IP and 300 total calls per 60 seconds. Cloudflare counts these limits separately in each location.

## Source files

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

export const skillIndex = () => skillIndexMarkdown;

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
  "/auth.md",
  "/llms.txt",
  "/llms-full.txt",
  "/openapi.json",
  "/robots.txt",
  "/sitemap.xml",
  "/skills",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/agent-skills/index.json",
  "/.well-known/ai-catalog.json",
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
  `</.well-known/agent-card.json>; rel="service-desc"; type="application/a2a+json"`,
  `</.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/json"`,
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

export const a2aAgentCard = (origin: string) => ({
  capabilities: {
    extendedAgentCard: false,
    pushNotifications: false,
    streaming: false,
  },
  defaultInputModes: ["text/plain"],
  defaultOutputModes: ["text/plain"],
  description:
    "Answers questions about rat-stack by searching and reading its public files.",
  name: "Rat Stack",
  skills: [
    {
      description:
        "Answer a rat-stack question by searching the public law and skills, then reading the matching sources.",
      examples: [
        "How do I add a capability?",
        "Where does lifecycle state live?",
      ],
      id: "answer-rat-stack-question",
      name: "Answer a rat-stack question",
      tags: ["rat-stack", "documentation", "source-grounded"],
    },
  ],
  supportedInterfaces: [
    {
      protocolBinding: "JSONRPC",
      protocolVersion: "1.0",
      url: `${origin}/a2a`,
    },
  ],
  version: "0.1.0",
});

export const ardManifest = (origin: string) => ({
  entries: [
    {
      displayName: "Rat Stack MCP",
      identifier: "urn:air:ratstack.sh:server:mcp",
      representativeQueries: [
        "how do I add a capability",
        "show the rat-stack project law",
      ],
      type: "application/mcp-server-card+json",
      url: `${origin}/.well-known/mcp.json`,
    },
    {
      displayName: "Rat Stack A2A Agent",
      identifier: "urn:air:ratstack.sh:agent:a2a",
      representativeQueries: [
        "answer a question about rat-stack",
        "where does rat-stack lifecycle state live",
      ],
      type: "application/a2a+json",
      url: `${origin}/.well-known/agent-card.json`,
    },
  ],
  host: {
    displayName: "Rat Stack",
    identifier: "did:web:ratstack.sh",
  },
  specVersion: "1.0",
});

export const authMarkdown = `# ratstack.sh auth.md

You do not need an account or token to use ratstack.sh.

## Access

- Send normal HTTPS requests to the public MCP, A2A, and HTTP routes.
- Do not send credentials. Ratstack does not issue or accept access tokens.
- There is no signup or registration route.
- Ratstack does not use OAuth.
`;

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
