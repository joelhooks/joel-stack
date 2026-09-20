# Vendored packages

Temporary bridges for pinned dependencies that are not on npm yet. Each entry says how it was built and when it can go. Nothing is vendored right now.

| Tarball | Built from | Why | Remove when |
| ------- | ---------- | --- | ----------- |
| (none)  |            |     |             |

The last one was `xstate-effect-0.1.0-alpha.2.tgz`, built from the `statelyai/xstate` tag `xstate@6.0.0-alpha.58` with `pnpm exec preconstruct build && pnpm pack` after the first npm publish failed on 2026-09-17. npm published the same bytes on 2026-09-19 and `packages/core` moved to the registry version on 2026-09-20.

## Rules for the next one

- Add a `file:` spec in the consuming package, the tarball here, and a row above with the exact tag or commit it was built from. Build only from a pinned tag, never a moving branch, so the lockfile integrity stays reproducible.
- A `file:` tarball still goes through pnpm's release-age check, which looks the version up on the registry. An unpublished version 404s and fails `pnpm install --frozen-lockfile` in CI; a warm local metadata cache hides this. Every vendored tarball needs a matching version-scoped `minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml`.
- When the version publishes, confirm the tarballs match (`npm pack <name>@<version>` and compare file lists and `dist`), replace the `file:` spec with the exact version, delete the tarball and its row, run `pnpm install`, and watch CI. Keep the `minimumReleaseAgeExclude` entry if the package is a prerelease pin like the others in that list.
