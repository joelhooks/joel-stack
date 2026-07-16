# Source mirrors

`.agent-sources/<name>` holds authoritative upstream source for agents to inspect during source-first work.

Mirrors are committed, maintained, squashed Git subtrees. They are not untracked clones, submodules, copied snapshots, runtime dependencies, or build inputs.

## Add a mirror

Choose an upstream URL and a ref or commit that matches the dependency being studied, then add the subtree:

```sh
git subtree add \
  --prefix=.agent-sources/<name> \
  <upstream-url> \
  <ref> \
  --squash
```

Record the upstream URL, selected ref or commit, and refresh command in the inventory below.

## Refresh a mirror

```sh
git subtree pull \
  --prefix=.agent-sources/<name> \
  <upstream-url> \
  <ref> \
  --squash
```

Review the subtree diff like dependency code. Do not make project changes inside a mirror or install its dependencies.

## Inventory

No upstream mirrors ship in the base template. Add the full Effect source at `.agent-sources/effect` before source-backed Effect work needs cross-file APIs, tests, examples, or package layout. Use `https://github.com/Effect-TS/effect.git` and record the ref that matches the pinned beta.
