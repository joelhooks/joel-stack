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
    stylesheet,
    title,
  } = $props();

  const canonicalUrl = `${origin}${path}`;

  const isHome = path === "/";
</script>

<svelte:head>
  {@html `<style>${stylesheet}</style>`}
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
    <a href="/lore">lore</a> ·
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
