import {
  homeMarkdownTemplate,
  lawSources,
  loreIndexMarkdown,
  llmsLoreLinks,
  loreSources,
  originToken,
  skillIndexMarkdown,
  skillSources,
} from "./bundled-content.generated.js";

export { loreGraphSnapshot } from "./bundled-content.generated.js";

export {
  appleTouchIconPngBase64,
  faviconIcoBase64,
  homeDocumentHtml,
  loreIndexDocumentHtml,
  noVerifyDocumentHtml,
  noVerifyMarkdown,
  ogImages,
  ratSvg,
  skillIndexDocumentHtml,
  staticContentVersion,
} from "./bundled-content.generated.js";

export const ogImagePath = (routePath: string): `/${string}` =>
  `/og${routePath === "/" ? "/home" : routePath}.png`;

export type ContentKind = "law" | "skill" | "lore";

export type LoreGroup = "idea" | "concept" | "source" | "person";

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
      source.sourcePath.includes(" ")
        ? source.routePath.slice(1)
        : source.sourcePath.replace(/^\.brain\//u, "")
    }`,
    kind: "law" as const,
    name: source.routePath.slice(1),
  })
);

export interface LoreResource extends ContentResource {
  readonly group: LoreGroup;
  readonly terms: readonly string[];
}

export const loreResources: readonly LoreResource[] = loreSources.map(
  (source) => ({
    ...source,
    id: `ratstack://lore/${source.slug}`,
    kind: "lore" as const,
    name: source.slug,
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
  ...loreResources,
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

const mcpToolsListBody = JSON.stringify({
  id: "rat-stack-tools",
  jsonrpc: "2.0",
  method: "tools/list",
  params: {
    _meta: {
      "io.modelcontextprotocol/clientCapabilities": {},
      "io.modelcontextprotocol/clientInfo": {
        name: "rat-stack-example",
        version: "0.1.0",
      },
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
    },
  },
});

export const mcpToolsListExample = (origin: string) =>
  [
    `curl --request POST '${origin}/mcp' \\`,
    "  --header 'accept: application/json, text/event-stream' \\",
    "  --header 'content-type: application/json' \\",
    "  --header 'MCP-Protocol-Version: 2026-07-28' \\",
    "  --header 'Mcp-Method: tools/list' \\",
    `  --data '${mcpToolsListBody}'`,
  ].join("\n");

export const mcpProtocolVersions = [
  "2026-07-28",
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;

export const mcpVersionText = (origin: string) =>
  `ratstack.sh MCP answers every client at ${origin}/mcp.\nProtocol 2026-07-28 is stateless and has no initialize handshake; send the version header, Mcp-Method header, and params._meta shown in the worked tools/list request.\nOlder clients (2025-11-25 back to 2024-11-05) send initialize as usual and get a session of their own.\nSee ${origin}/llms.txt for the complete curl example.\n`;

export const llmsText = (origin: string) => `# ratstack.sh

The reference for building an app and its cloud as one typed program: Effect, Alchemy, and a fence that makes the easy path the right one.

## Read this repo

- [Home](${origin}/): short overview
- [All public docs](${origin}/llms-full.txt): rules, lore, and skills in one response
- [HTTP API](${origin}/openapi.json): routes, inputs, outputs, and errors
- [MCP server](${origin}/mcp): tools for search, reading, and sandboxed code

## Connect with MCP

Point any MCP client at \`${origin}/mcp\`. Protocol 2026-07-28 is stateless and has no \`initialize\` handshake: every request sends \`MCP-Protocol-Version\`, \`Mcp-Method\`, and the \`params._meta\` block shown here.

\`\`\`sh
${mcpToolsListExample(origin)}
\`\`\`

Older clients (2025-11-25 back to 2024-11-05) send \`initialize\` as usual. Each one gets its own session, held by a Durable Object so it survives between requests.

Each IP may make 120 API or MCP requests per 60 seconds. \`execute\` also allows 6 calls per IP and 300 total calls per 60 seconds. Cloudflare counts these limits separately in each location.

## Run code

\`execute\` runs the \`code\` value as the body of an async function. \`return\` sets \`result\`, and \`console.log\` output appears in \`logs\`; imports, exports, and \`fetch\` are unavailable.

\`\`\`sh
curl --request POST '${origin}/api/execute' \\
  --header 'content-type: application/json' \\
  --data '{"code":"return 1 + 1"}'
# {"logs":[],"result":2}
\`\`\`

## Source files

${entryList(lawResources)}

## Lore

${(["idea", "concept", "source", "person"] as const)
  .flatMap((group) => {
    const pages = loreResources.filter((resource) => resource.group === group);

    return pages.length === 0
      ? []
      : [
          `### ${group[0]?.toUpperCase()}${group.slice(1)}`,
          "",
          entryList(pages),
        ];
  })
  .join("\n\n")}

## Skills

${entryList(skills)}

## Lore on this page

${llmsLoreLinks.replaceAll(originToken, origin)}
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

export const loreIndex = () => loreIndexMarkdown;

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
  "/lore",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/agent-skills/index.json",
  "/.well-known/ai-catalog.json",
  "/.well-known/api-catalog",
  "/.well-known/mcp.json",
  ...lawResources.map((resource) => resource.routePath),
  ...loreResources.map((resource) => resource.routePath),
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
  protocolVersions: mcpProtocolVersions,
  serverInfo: { name: "sh.ratstack/rat-stack", version: "0.2.0" },
  transport: { endpoint: `${origin}/mcp`, type: "streamable-http" },
  "x-ratstack-example": mcpToolsListExample(origin),
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

const loreTermsById = new Map(
  loreResources.map((resource) => [
    resource.id,
    resource.terms.join(" ").toLowerCase(),
  ])
);

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
    .flatMap((resource) => {
      const title = resource.title.toLowerCase();
      const description = resource.description.toLowerCase();
      const text = resource.text.toLowerCase();
      const loreTerms = loreTermsById.get(resource.id) ?? "";

      const score =
        (queryText !== "" && title.includes(queryText) ? 40 : 0) +
        terms.reduce(
          (total, term) =>
            total +
            occurrences(title, term) * 12 +
            occurrences(loreTerms, term) * 12 +
            occurrences(description, term) * 6 +
            Math.min(10, occurrences(text, term)),
          0
        );

      return queryText === "" || score > 0 ? [{ resource, score }] : [];
    })
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
