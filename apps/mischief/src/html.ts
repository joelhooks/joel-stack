interface HtmlMetadata {
  readonly description: string;
  readonly path: `/${string}` | "/";
  readonly title: string;
}

interface SkillPage {
  readonly description: string;
  readonly html: string;
  readonly name: string;
}

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const renderDocument = (
  origin: string,
  metadata: HtmlMetadata,
  body: string
) => {
  const title = escapeAttribute(metadata.title);
  const description = escapeAttribute(metadata.description);
  const canonicalUrl = `${origin}${metadata.path}`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<meta name="description" content="${description}">
<meta property="og:type" content="website">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${description}">
<meta property="og:url" content="${canonicalUrl}">
<link rel="canonical" href="${canonicalUrl}">
</head>
<body>
<header>
<a href="/">ratstack.sh</a>
<nav aria-label="Primary navigation">
<a href="/">catalogue</a>
<a href="/skills">skills</a>
<a href="/llms.txt">llms.txt</a>
<a href="/openapi.json">openapi</a>
</nav>
</header>
<main>${body}</main>
<footer>
<p>one capability → every surface · <a href="https://github.com/joelhooks/rat-stack">source</a></p>
</footer>
</body>
</html>`;
};

export const renderHomePage = (origin: string, html: string) =>
  renderDocument(
    origin,
    {
      description:
        "An Effect-first TypeScript template where one schema-typed capability projects to CLI, HTTP, MCP, and code mode.",
      path: "/",
      title: "rat-stack — one capability, every surface",
    },
    html
  );

export const renderSkillsPage = (origin: string, html: string) =>
  renderDocument(
    origin,
    {
      description:
        "Install the rat-stack skills for learning the architecture, adding capabilities and lifecycle machines, or shaping a clone.",
      path: "/skills",
      title: "rat-stack skills — learn, build, shape",
    },
    html
  );

export const renderSkillPage = (origin: string, skill: SkillPage) => {
  const name = escapeAttribute(skill.name);
  return renderDocument(
    origin,
    {
      description: skill.description,
      path: `/skills/${skill.name}`,
      title: `${skill.name} — rat-stack skill`,
    },
    `<nav aria-label="Breadcrumb">
<a href="/skills">skills</a> / <span>${name}</span>
</nav>
${skill.html}`
  );
};
