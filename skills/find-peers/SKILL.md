---
name: find-peers
description: Find public repos on the same bleeding-edge versions as rat-stack, add new ones to the roster, and learn from them. Run it every week or two, and after every bump.
---

# Find peers

A peer is a public repo that pins at least two of the same prerelease lines we do. Peers hit breaking changes first and write idioms before the docs do.

## Run

```sh
pnpm find-peers
```

The script reads our prerelease pins from the workspace `package.json` files, searches Sourcegraph once per line, and prints a table of repos ranked by how many lines they share. Scoped packages that move with their parent, such as `@effect/vitest` with `effect`, count once. A repo missing from `.brain/resources/peers.svx` is marked `new`. It takes about twenty seconds. Pass `--min 1` to see repos that share only one line.

## Update the roster

Add each `new` repo to the table in `.brain/resources/peers.svx`, with today's date and its shared lines, and update the lines note at the top if our pins moved. Never remove a row; a peer that fell behind still shows how it got there.

## Learn from the new ones

Pick at most three new peers, the ones closest to what we are building next. For each:

1. Ask DeepWiki (the `deepwiki` MCP server) one narrow question tied to current work, such as "How does this repo bind a Durable Object to an Alchemy Worker?" Treat the answer as a pointer to files.
2. Read those files at the commit that uses our versions. Adopt a pattern only after reading the code, and only when it is simpler than ours or fixes something we do wrong.
3. Record adoptions and rejections, with the reason, in `.brain/resources/same-version-repos.svx`, and link that entry from the peer's Studied column.

Stars show attention, not correctness. Do not copy a pattern because a popular repo uses it.

## Report

List the new peers, what you studied, and anything adopted. Commit the roster and notes together.
