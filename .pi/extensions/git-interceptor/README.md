# Git / jj interceptor (repo-local)

Pi extension auto-loaded from `.pi/extensions/git-interceptor/`.

- Blocks `git … --no-verify` so agents cannot bypass lefthook / CI fences.
- Forces non-interactive editors for `git` and `jj`.

Policy source: [`scripts/vcs-command-policy.js`](../../../scripts/vcs-command-policy.js).

Same policy is wired for Cursor (`.cursor/hooks.json`) and Claude Code (`.claude/settings.json`).
