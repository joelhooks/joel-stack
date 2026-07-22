# Agent instructions

This file is the repo law for agents and contributors. Keep commands, validation rules, architecture constraints, and project-specific stop rules here. Read `VISION.md` for product intent before planning substantial work. Pi sessions also load `.pi/APPEND_SYSTEM.md` (project context) and the live repo-local extension `.pi/extensions/project.ts`.

## Stack contract

The pinned stack is declared in `package.json` and summarized in [README.md](./README.md#what-is-in-the-stack). Keep dependencies exact. Repo-local config wins; note drift instead of silently migrating the project.

- Node `24.18.0` and npm `11.16.0`; do not replace npm with Bun.
- Effect `4.0.0-beta.99` and `@effect/platform-node` `4.0.0-beta.99`.
- XState `5.32.5` for finite lifecycles, retries, cancellation, and resumability.
- TypeScript `7.0.2` in strict mode.
- Oxlint `1.74.0` with Ultracite `7.9.4`, Oxfmt `0.59.0`, and Turborepo `2.10.5`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the exact lockfile-backed dependencies |
| `npm run check` | Typecheck, verify formatting, and run type-aware linting |
| `npm run fix` | Apply Oxfmt and safe Oxlint fixes |
| `npm test` | Build and run the Vitest suite once |
| `npm run build` | Compile the CLI into `dist/` |
| `npx turbo run check test` | Required validation before claiming a change is ready |

Run `npm run fix` only when you intend to rewrite files. Finish with `npx turbo run check test`.

## Source-first Effect work

Effect v4 is beta software. Before writing, reviewing, or refactoring Effect code, inspect source for the exact pinned beta instead of relying on memory. Authoritative source mirrors live under `.agent-sources/<name>` as committed, squashed Git subtrees so every clean clone gets the same evidence and upstream updates remain pullable.

This template documents the convention in `.agent-sources/README.md` but does not vendor an upstream mirror by default. When Effect work needs the full source surface, add it deliberately and record the upstream URL, ref or commit, and refresh command:

```sh
git subtree add --prefix=.agent-sources/effect https://github.com/Effect-TS/effect.git <ref> --squash
git subtree pull --prefix=.agent-sources/effect https://github.com/Effect-TS/effect.git <ref> --squash
```

Do not use an untracked nested clone, submodule, or copied snapshot as the durable mirror. Mirror contents are reference material, not runtime dependencies; exclude them from project typechecking, tests, linting, and formatting.

## Source control

Preserve existing work. Inspect status before editing, stage only files changed for the current task, and do not commit generated output or secrets. Committed `.agent-sources/` mirrors are intentional source, not generated junk. Use the repository's existing source-control tool; do not initialize or migrate one without approval.

## Project law — fill in

<!-- TEMPLATE: Replace this comment with the product-specific rules that every contributor and agent must follow. Keep durable product intent in VISION.md, not here. -->

- [Name the rules that must remain true across implementations.]

## Architecture — fill in

<!-- TEMPLATE: Record the important module boundaries, dependency direction, data ownership, and state-machine seams. Link deeper docs instead of duplicating them. -->

- [Describe the smallest useful architecture map for this project.]

## Boundaries and sign-off — fill in

<!-- TEMPLATE: Name changes agents may make directly and changes that need owner approval. Include security, privacy, deployment, public API, dependency, and destructive-data boundaries when they apply. -->

- Safe by default: [small, tested changes that preserve the current contract]
- Needs owner sign-off: [product promises, architecture changes, risky operations, or scope expansion]
