---
name: gardener
description: Keep rat-stack current and clean. Bump the bleeding-edge pins, learn from repos on the same versions, and turn every bad pattern into a lint rule before cleaning it up.
---

# Tend the garden

Rat-stack runs on prereleases: Effect 4 release candidates, Alchemy 2 betas, XState 6 alphas. They move every few days. Code that other projects copy has to stay on the current line and keep getting simpler. This skill is the routine for both.

It follows Lauren Tan's gardener loop from her Dune talk: delete tech debt, keep one paved path, and lint against anti-patterns. In her words: "whenever you see tech debt or bad patterns, your instinct should be, I need to write a lint rule against it." Her ladder for where a correction should live, hardest first, is codebase, static analysis, rules, skills, style guide. This skill sits low on that ladder on purpose. Push each finding up it.

Read `AGENTS.md` first. Work in a clean clone off `origin/main`, never in a checkout with other people's uncommitted files.

## 1. Check the pins

The core pins live in the `package.json` files and in `minimumReleaseAgeExclude` in `pnpm-workspace.yaml`. Compare each against its prerelease line on npm:

```sh
for p in effect @effect/platform-node @effect/vitest @effect/tsgo alchemy xstate @xstate/effect; do
  printf '%-24s ' "$p"; pnpm view "$p" dist-tags --json | tr -d '\n '; echo
done
```

Read the right tag for each line: `rc` for Effect 4, `latest` for Alchemy 2, `alpha` for XState 6 and `@xstate/effect`. `latest` on `effect` and `xstate` is still the old major.

## 2. Bump one line at a time

For each line that is behind:

1. Replace the pin everywhere it appears. Effect packages move together; `rg -l '4\.0\.0-rc\.<old>' --glob '**/package.json'` finds them.
2. If the package has a `minimumReleaseAgeExclude` entry, replace the entry instead of adding one.
3. Check peer ranges before installing: `pnpm view alchemy@<pin> peerDependencies`. Alchemy pins exact Drizzle versions and a minimum Effect; follow them.
4. `pnpm install`, then `pnpm peers check`. Compare against the warnings on `origin/main`; only new warnings count.
5. Refresh the source mirrors with `./scripts/vendor-agent-sources.sh --refresh` and update the Ref column in `.agent_sources/README.md`. Agents read the mirrors as truth, so a stale mirror teaches old APIs.
6. Read what changed upstream: `git -C .agent_sources/github.com/<owner>/<repo> log --oneline <old-tag>..<new-tag>` when the old tag is fetchable, or the package's CHANGELOG. Grep our code for every API those commits touch.
7. Run `pnpm turbo run check test build --force` and check its exit code.

Commit each line separately, so a regression bisects to one library.

## 3. Learn from repos on the same versions

Some public repos run the same prereleases. They hit the breaking changes first and show idioms the docs do not have yet.

Find them with Sourcegraph. The stream API needs a browser user agent:

```sh
q='patterntype:regexp file:package.json "alchemy":\s*"[\^~]?2\.0\.0-beta count:1000'
curl -s -A 'Mozilla/5.0' -H 'Accept: text/event-stream' \
  "https://sourcegraph.com/.api/search/stream?display=500&q=$(node -p 'encodeURIComponent(process.argv[1])' "$q")"
```

Run it once per line: `"effect":\s*"[\^~]?4\.0\.0-(beta|rc)`, `"xstate":\s*"[\^~]?6\.0\.0-alpha`, and `"@xstate/effect"`. The repos that appear in more than one result are the closest to us. `gh search code` misses most of these, because it splits on the hyphens in version strings.

For each candidate:

1. Ask DeepWiki (the `deepwiki` MCP server) a narrow question, such as "How does this repo bind a Durable Object to an Alchemy Worker?" Treat the answer as a pointer to files, not as fact.
2. Read those files in the repo's source at the commit that uses our version. Adopt a pattern only after reading the code, and only if it is simpler than ours or fixes something we get wrong.
3. Record what you adopted, and what you rejected with the reason, in `.brain/`. Link the repo and commit.

Do not copy a pattern because a popular repo uses it. Stars show attention, not correctness.

## 4. Garden

Look for tech debt and patterns that should not spread: duplicated logic, a second way to do something that already has a paved path, `unknown` passed inward, dead exports, tests that assert nothing.

For each one:

1. Write the lint rule or test that fails on it first. Put a real-`oxlint` fixture test beside the other rule tests in `packages/core/test/`. Break the rule once to watch the test fail.
2. Then fix every existing instance, so the rule starts at zero findings.
3. If some findings have to stay for now, record them as a baseline that can only shrink. Never raise a baseline.
4. Delete code that nothing uses. Git keeps it.

When a pattern cannot be caught by lint, fix it in the codebase so the wrong version is hard to write. Only fall back to prose in `AGENTS.md` or a skill when neither works.

## Report

End with a short report:

- each pin moved, from and to;
- upstream changes that affected us;
- repos studied, and what was adopted or rejected;
- lint rules added, and the findings each one removed;
- anything left undone.

Vendoring apps copy these changes, so a report that says what to mirror saves them work.
