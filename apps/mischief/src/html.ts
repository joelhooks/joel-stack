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
<a href="/">home</a>
<a href="/skills">skills</a>
<a href="/llms.txt">agent guide</a>
<a href="/openapi.json">API docs</a>
</nav>
</header>
<main>${body}</main>
<footer>
<p>Learn the pieces in a working app. <a href="https://github.com/joelhooks/rat-stack">Source code</a>.</p>
</footer>
</body>
</html>`;
};

export const renderHomePage = (origin: string, html: string) =>
  renderDocument(
    origin,
    {
      description:
        "Learn Effect, XState, TypeScript, Alchemy, and agent interfaces in one working app.",
      path: "/",
      title: "rat-stack: learn the pieces in a working app",
    },
    html
  );

export const renderSkillsPage = (origin: string, html: string) =>
  renderDocument(
    origin,
    {
      description:
        "Four hands-on guides to Effect actions, XState lifecycles, and the seams between stack pieces.",
      path: "/skills",
      title: "Learn the stack | rat-stack",
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
      title: `${skill.name} | rat-stack`,
    },
    `<nav aria-label="Breadcrumb">
<a href="/skills">skills</a> / <span>${name}</span>
</nav>
${skill.html}`
  );
};
