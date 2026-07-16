# Repo-local Pi extensions

Pi auto-loads `.pi/extensions/*.ts` and `.pi/extensions/*/index.ts` when it starts in this repo.

`project.ts` is live: it registers a single quiet `/project-status` command and adds nothing at startup, so it cannot collide with global extensions. Grow project-specific behavior there (or in sibling files/subdirectories).

Ground rules:

1. Keep command, tool, status, and event names project-prefixed so they don't clash with global extensions.
2. Keep optional dependencies lazy so a missing package cannot break Pi startup.
3. Run `pi -p "Reply with exactly: ok"` from the repo root before committing extension changes.

Repo-local extensions run with full system permissions. Keep them small, source-controlled, and project-specific.
