# Project context

Pi appends this file to its system prompt for sessions in this repo. A child project rewrites this section on day one; what follows describes rat-stack itself.

- Repo law lives in `AGENTS.md`; product intent in `VISION.md`. Read both before substantial work.
- Validation gate: `pnpm turbo run check test build`. Lefthook runs `pnpm check` and `pnpm test` on commit; CI runs the full gate on a cold cache.
- Domain terms: a **capability** (`defineCapability` in `packages/core`) is one named, schema-typed behavior; a **projection** (`packages/capability`) turns capabilities into a CLI command, an HTTP API, an MCP toolkit, or code mode; the **fence** is the type-aware lint, Effect language-service diagnostics, and hooks that make bypasses fail loudly.
- Active constraint: `@xstate/effect` is vendored as a tarball until it publishes to npm (`vendor/README.md` has the swap rule).
- Current focus: keep the template instantiable. Any change must survive `gh repo create <name> --template joelhooks/rat-stack` followed by a cold `pnpm install` and the full gate.

## Brain procedures

`.brain/` is the agent-connected project brain (PARA: projects, areas, resources, archives).

- Organize by usefulness — ask: where will this be useful next?
- Keep notes atomic, linked, source-grounded, authored as `.svx`.
- Capture only durable decisions, terms, tradeoffs, gotchas, sources, questions, and review feedback.
- Refine captures into graph edges, backlinks, summaries, and canonical concepts.
- Express knowledge as code, docs, decisions, UI, issues, or plans. Storage is not the goal; output is.
- No PKM ceremony, no append-only logs as truth, no generic static-site sludge.
