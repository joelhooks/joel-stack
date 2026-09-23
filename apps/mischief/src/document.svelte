<script>
  let {
    bodyHtml,
    breadcrumbHref,
    breadcrumbLabel,
    breadcrumbName,
    description,
    ogImageUrl,
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
  <meta property="og:site_name" content="ratstack.sh" />
  <meta property="og:image" content={ogImageUrl} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:alt" content={description} />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={ogImageUrl} />
  <link rel="canonical" href={canonicalUrl} />
  <link rel="icon" href="/favicon.ico" sizes="48x48" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
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
    background: #eff1f5;
    border: 1px solid #ccd0da;
    font: inherit;
    padding: 0.1em 0.25em;
  }

  :global(pre) {
    background: #eff1f5;
    border: 1px solid #ccd0da;
    line-height: 1.25;
    max-width: 100%;
    overflow-x: auto;
    padding: 0.75rem 1rem;
    tab-size: 2;
    white-space: pre;
  }

  :global(pre code) {
    background: transparent;
    border: 0;
    padding: 0;
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
    /* Text diagrams are 65 columns; shrink them to fit instead of scrolling. */
    :global(figure) {
      margin: 1rem 0;
    }

    :global(figure pre) {
      font-size: clamp(7px, 2.2vw, 1em);
    }

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
