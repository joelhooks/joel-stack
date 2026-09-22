# Vision

rat-stack is the smallest honest example of an app and its cloud as one typed program. Effect owns the hard parts, Alchemy infers the infrastructure from the code, and the fence makes the cheap path the honest path, so an agent can build it and you can still trust it.

It is an agentic scaffold for a TypeScript Effect app with a CLI, XState lifecycles, Alchemy infrastructure, and varlock config. This repo is the example the content points at. It is not a course or a wiki. Learning material lives elsewhere. Skills here teach vocabulary and where to look: name it, ask for it, check the result.

Public GitHub is a steal-the-ideas surface, not a supported product. Clones that become real apps should replace this vision with their own intent. Until then, this is the why.

Scope: `joelhooks/rat-stack`, the template repo and the shape a clone inherits on day one.

Audience: Joel, the agents that start work from this scaffold, engineers who work through agents and want to trust what an agent built, and readers looking for ideas. The pattern includes workspaces, source mirrors, and a fence that makes `--no-verify` fail loudly. This is not a support queue, compatibility promise, ghostwriting service, growth automation, thin npm init, or TypeScript tutorial brand.

Status: `ratstack.sh` is deployed. This repository is the only instantiated clone so far. Effect is pinned to a release candidate, XState and `@xstate/effect` to alphas, and Alchemy to a beta, so their APIs can drift.

## Why it exists

Agents take the shortest path. A skeleton without law and gates produces sludge. A pile of prose without a fence is documentation. This scaffold gives a new CLI:

1. Why. `VISION.md` and `AGENTS.md` explain the point.
2. Fence. Pins, `pnpm check`, lefthook, and harness hooks block hook bypass.
3. Context. Vendored Effect, effect-solutions, and XState sources support source-first edits.

The stack is the load-bearing floor. The agent surface is the product. Sam Goodwin's devtools-fm argument sets the bar: the whole cloud becomes a library, limited by the accounts you have, and the type system should guarantee that the infrastructure is correct.

## Outcomes

- A new CLI clone starts as a pnpm and Turborepo workspace with a real Effect CLI.
- Agents hit a loud failure when they cheat, including `git … --no-verify` and skipped checks.
- Prose explains the why. CI, lefthook, and agent hooks enforce the fence.
- Success means someone can ask an agent for an Effect-shaped, Alchemy-shaped solution and catch it when the agent gets it wrong.
- Product-specific corpora, including tokens, x-algorithm, and customer data, stay out of the shared template.

## Current priorities

1. Keep the scaffold honest. The fence wins, and cheating stays uncomfortable and obvious.
2. Hold advocacy and judgment together. Teach the judgment and let Alchemy win on merit.
3. Keep pins and vendor references matched to the stack. Keep the example small. Cloudflare is the on-ramp, not the frame, and a second cloud vendor is not the answer.
4. Direction, not a claim about today's tests: import a stack, deploy in `beforeAll`, hit real infrastructure, destroy in `afterAll`, and run the same path for each pull request. The fake `Sandbox` in `apps/mischief` tests is a known gap.
5. Next honest step: a database `Layer` behind a binding, such as Hyperdrive with Drizzle. Commenting out the binding should make application code a type error. This needs sign-off and is not built.

## Questions this repo answers in code

- Does the type system protect infrastructure correctness? Removing a binding should make typecheck fail. Not yet proven in this repo.
- Does importing `apps/infra/alchemy.run.ts` stay pure? It should deploy nothing. Not yet proven by a test.
- Where does a correction to an agent live? Lauren Tan's fence ladder puts code first, then lint and CI, then rules and skills, with the style guide last. The `--no-verify` rung is proven today by `packages/core/test/vcs-command-policy.test.ts`.

## Merge by default

- Tests and checks that encode the existing fence
- Docs that sharpen why and fence without adding a second product promise
- Small example-CLI fixes that keep the vertical slice working
- Pin bumps that stay exact and reviewed as stack changes

## Needs sign-off

- Weakening lefthook, CI, or `--no-verify` blocks
- Replacing pnpm, Turborepo, Effect, or XState as the default floor
- Adding product-specific vendor corpora to the shared template
- Turning the public repo into a supported starter product
- Adding the database binding candidate described above

## Will not do for now

- Support SLAs or a promise that it works on every agent harness
- Vendoring x-algorithm or other app-specific source
- Generating publishable copy as part of the template
- Bun or npm as the install story
- A gut-me-on-day-one scaffold with no fence

## Decision boundaries

- Safe by default: changes that keep the why in VISION and AGENTS and the fence enforceable
- Needs owner sign-off: new promises, toolchain swaps, or making the fence optional
- Evidence expected: `pnpm check` and `pnpm test` green, plus hook policy tests that still block `git commit --no-verify`

## Amendment policy

This document changes when the scaffold thesis is wrong, not when a clone's product is different. Agents may propose amendments with receipts. Joel approves. A clone that is now a real product should write its own `VISION.md` instead of stretching this one.
