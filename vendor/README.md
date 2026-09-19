# Vendored packages

Temporary bridges for pinned dependencies that are not on npm yet. Each entry says how it was built and when it can go.

| Tarball | Built from | Why | Remove when |
| --- | --- | --- | --- |
| `xstate-effect-0.1.0-alpha.2.tgz` | `statelyai/xstate` tag `xstate@6.0.0-alpha.58` (commit `0748e1b`), `packages/xstate-effect`, `pnpm install --ignore-scripts && pnpm exec preconstruct build && pnpm pack` | `@xstate/effect` is versioned and merged on `next` but its first npm publish failed with `E404 PUT registry.npmjs.org/@xstate%2feffect` on 2026-09-17 | `npm view @xstate/effect@alpha version` returns `0.1.0-alpha.2` or later. Then in `apps/cli/package.json` replace the `file:` spec with the exact npm version, delete the tarball and this row, and run `pnpm install`. |

Rebuild a tarball only from the pinned tag, never from a moving branch, so the lockfile integrity stays reproducible.
