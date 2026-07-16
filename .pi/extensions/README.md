# Repo-local Pi extensions

Pi auto-loads `.pi/extensions/*.ts` and `.pi/extensions/*/index.ts` when it starts in this repo.

This scaffold is inert by default. `example.ts.example` is ignored by Pi's extension discovery. To add a project extension:

1. Copy it to a uniquely named `.ts` file.
2. Uncomment and adapt the example.
3. Check that its command, tool, status, and event names do not clash with global extensions.
4. Keep optional dependencies lazy so a missing package cannot break Pi startup.
5. Run `pi -p "Reply with exactly: ok"` from the repo root before committing.

Repo-local extensions run with full system permissions. Keep them small, source-controlled, and project-specific.
