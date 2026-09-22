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
</svelte:head>

<header>
  <a href="/">ratstack.sh</a>
  <nav aria-label="Primary navigation">
    <a href="/">home</a>
    <a href="/skills">skills</a>
    <a href="/llms.txt">agent guide</a>
    <a href="/openapi.json">API docs</a>
  </nav>
</header>

{#if breadcrumbHref && breadcrumbLabel && breadcrumbName}
  <nav aria-label="Breadcrumb">
    <a href={breadcrumbHref}>{breadcrumbLabel}</a>
    <span>/</span>
    <span>{breadcrumbName}</span>
  </nav>
{/if}

<main>{@html bodyHtml}</main>

<footer>
  <p>
    Learn the pieces in a working app.
    <a href="https://github.com/joelhooks/rat-stack">Source code</a>.
  </p>
</footer>

<style>
  :global(html) {
    overflow-wrap: anywhere;
  }

  :global(body) {
    box-sizing: border-box;
    margin: 0 auto;
    max-width: 52rem;
    padding: 1rem;
  }

  nav {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
  }

  :global(pre) {
    max-width: 100%;
    overflow-x: auto;
  }

  :global(table) {
    display: block;
    max-width: 100%;
    overflow-x: auto;
  }
</style>
