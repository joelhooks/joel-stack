<script>
  let {
    bodyHtml,
    breadcrumbHref,
    breadcrumbLabel,
    breadcrumbName,
    description,
    logoSvg,
    origin,
    path,
    title,
  } = $props();

  const canonicalUrl = `${origin}${path}`;
</script>

<svelte:head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta property="og:type" content="website" />
  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:url" content={canonicalUrl} />
  <link rel="canonical" href={canonicalUrl} />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
</svelte:head>

<header>
  <a class="mark" href="/" aria-label="ratstack.sh home">{@html logoSvg}</a>
  <p class="wordmark">
    <strong>ratstack.sh</strong><br />
    learn the pieces in a working app
  </p>
</header>

<nav aria-label="Primary navigation">
  <a href="/">home</a>
  <a href="/skills">skills</a>
  <a href="/llms.txt">agent guide</a>
  <a href="/openapi.json">API docs</a>
  <a href="https://github.com/joelhooks/rat-stack">source</a>
</nav>

{#if breadcrumbHref && breadcrumbLabel && breadcrumbName}
  <nav aria-label="Breadcrumb" class="breadcrumb">
    <a href={breadcrumbHref}>{breadcrumbLabel}</a>
    <span>/</span>
    <span>{breadcrumbName}</span>
  </nav>
{/if}

<main>{@html bodyHtml}</main>

<footer>
  <p>
    Markdown by default. HTML when you ask for it.
    <a href="/llms.txt">Agents start here</a>.
  </p>
</footer>

<style>
  :global(:root) {
    color-scheme: light dark;
    --bg: #faf5e9;
    --fg: #262829;
    --link: #1a4fa3;
    --rule: rgb(38 40 41 / 0.35);
  }

  @media (prefers-color-scheme: dark) {
    :global(:root) {
      --bg: #262829;
      --fg: #faf5e9;
      --link: #9cc4ff;
      --rule: rgb(250 245 233 / 0.35);
    }
  }

  :global(html) {
    background: var(--bg);
    color: var(--fg);
    font:
      16px/1.5 ui-monospace,
      SFMono-Regular,
      Menlo,
      Consolas,
      monospace;
    overflow-wrap: anywhere;
  }

  :global(body) {
    box-sizing: border-box;
    margin: 0 auto;
    max-width: 80ch;
    padding: 1rem;
  }

  :global(a) {
    color: var(--link);
  }

  :global(h1),
  :global(h2),
  :global(h3) {
    line-height: 1.2;
  }

  :global(code) {
    font: inherit;
  }

  :global(pre) {
    line-height: 1.25;
    max-width: 100%;
    overflow-x: auto;
  }

  :global(table) {
    border-collapse: collapse;
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }

  :global(th),
  :global(td) {
    border: 1px solid var(--rule);
    overflow-wrap: normal;
    padding: 0.25rem 0.5rem;
    text-align: left;
    vertical-align: top;
  }

  :global(th) {
    white-space: nowrap;
  }

  :global(hr) {
    border: 0;
    border-top: 1px solid var(--rule);
  }

  header {
    align-items: center;
    display: flex;
    gap: 0.75rem;
  }

  .mark {
    flex: none;
    line-height: 0;
  }

  .mark :global(svg) {
    display: block;
    height: 2.75rem;
    width: auto;
  }

  .wordmark {
    line-height: 1.3;
    margin: 0;
  }

  nav {
    border-bottom: 1px solid var(--rule);
    border-top: 1px solid var(--rule);
    display: flex;
    flex-wrap: wrap;
    gap: 0 1rem;
    margin: 0.75rem 0 1.5rem;
    padding: 0.25rem 0;
  }

  nav.breadcrumb {
    border: 0;
    gap: 0 0.5rem;
    margin: 0 0 1rem;
    padding: 0;
  }

  footer {
    border-top: 1px solid var(--rule);
    margin-top: 2rem;
    padding-top: 0.5rem;
  }
</style>
