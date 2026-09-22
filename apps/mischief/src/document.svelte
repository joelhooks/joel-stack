<script>
  let {
    bodyHtml,
    breadcrumbHref,
    breadcrumbLabel,
    breadcrumbName,
    description,
    origin,
    path,
    title,
  } = $props();

  const canonicalUrl = `${origin}${path}`;
  const isHome = path === "/";
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
  <nav aria-label="Primary navigation">
    {#if !isHome}<a href="/"><strong>🐀 Rat Stack</strong></a> ·{/if}
    <a href="/">home</a> ·
    <a href="/skills">skills</a> ·
    <a href="/llms.txt">agent guide</a> ·
    <a href="/openapi.json">API docs</a> ·
    <a href="https://github.com/joelhooks/rat-stack">source</a>
  </nav>
  <hr />
</header>

{#if breadcrumbHref && breadcrumbLabel && breadcrumbName}
  <nav aria-label="Breadcrumb">
    <a href={breadcrumbHref}>{breadcrumbLabel}</a> / {breadcrumbName}
  </nav>
{/if}

<main>{@html bodyHtml}</main>

<footer>
  <hr />
  <p>
    Markdown by default. HTML when you ask for it.
    <a href="/llms.txt">Agents start here</a>.
  </p>
</footer>

<style>
  :global(html) {
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
    border: 1px solid;
    overflow-wrap: normal;
    padding: 0.25rem 0.5rem;
    text-align: left;
    vertical-align: top;
  }

  :global(th) {
    white-space: nowrap;
  }

  @media (max-width: 40rem) {
    :global(thead) {
      display: none;
    }

    :global(tbody),
    :global(tr),
    :global(td) {
      display: block;
    }

    :global(tr) {
      border: 1px solid;
      margin-bottom: 0.75rem;
    }

    :global(td) {
      border: 0;
    }

    :global(td + td) {
      border-top: 1px solid;
    }

    :global(td[data-label])::before {
      content: attr(data-label) ": ";
      font-weight: bold;
    }
  }
</style>
