# Vision

rat-stack is the reference for how we build: an app and its cloud as one typed program. Effect owns the hard parts, Alchemy infers the infrastructure from the code, and the fence raises the floor, so an agent can build it reliably with high-trust.

The goal is to **build the best Effect + Alchemy application that we can**, as close to a perfect Effect application as we can get. Every change here moves toward that, and projects that grow out of rat-stack move toward it too. In practice:

- New code takes the rat-stack path: a shared contract, a typed service, a provider adapter, and an outcome you can observe.
- Existing code is finished that way when someone touches it, and the old version is deleted.
- Debt only shrinks. Plain async code moves onto Effect, and lint exemptions get retired, never added.
- The fence (lint, types, the Effect language service, CI) makes the easy path the right one.
- Where a platform behaves differently from a test fake, test against the real thing. [Worker init runs twice](https://ratstack.sh/lore/init-runs-twice) is what happens when you don't.

We and our agents use it to understand what we are building. Real projects take it in the way they take a library: vendor it, keep the bins they need, and pull the rest.

It is also the working code behind a YouTube series by [Joel Hooks](https://www.youtube.com/@JoelHooks) on Alchemy and Effect. Every claim made on camera points at something that runs here. The series arc lives with the content research. `ratstack.sh` is the teaching surface.

**Public GitHub is a steal-the-ideas surface, not a supported product**.

Any project that grows out of rat-stack writes its own vision.

Scope: `joelhooks/rat-stack`, the reference repo, and the shape a project inherits when it vendors or clones it.

Audience: The agents that work from this reference, engineers who work through agents and want to trust what an agent built, and people watching the series who want the working code. This is not a support queue, compatibility promise, ghostwriting service, growth automation, thin npm init, or TypeScript tutorial dressed up as a template excited to go out on a Saturday night.

Status: `ratstack.sh` is deployed. Effect is pinned to a release candidate, XState and `@xstate/effect` to alphas, and Alchemy to a beta, so their APIs can drift.

It's all fuckin' pre-release. It's fine. Keep track 🙏

## Why it exists

Agents will take the shortest path. Lazy mfers.

A skeleton without commandments chiseled in stone produces a ball of mud. A pile of prose without a strong fence is legacy documentation.

This reference gives a project:

1. Why. `VISION.md` and `AGENTS.md` explain the point.
2. Fence. Pins, `pnpm check`, lefthook, and harness hooks block hook bypass.
3. Context. Vendored Effect, effect-solutions, XState, and Alchemy sources support source-first edits.

The stack is the fundamental floor. The foundation. [Sam Goodwin's argument](https://www.youtube.com/watch?v=MtKHzAH6uXM&t=1790s) sets the bar: the whole cloud becomes a library, limited by the accounts you have, and the type system should guarantee that the infrastructure is correct.

## Pieces, trust, floor, and range

Four ideas hold this together.

**Pieces.** Alchemy Layers as literally composable SaaS (next section). Each one is a product you can provide, swap, or pull out.

**Trust.** [Lauren Tan ships thousands of agent-written PRs](https://x.com/poteto/status/2102050467505430555) because she trusts the environment her agents work in. She ranks five places a correction can live, hardest first: the codebase, static analysis (lint, compiler, CI), rules, skills, and the style guide. The hard rungs make a bad pattern impossible to write. Her team built Dune, an agent-friendly framework, on one principle: agents love taking shortcuts, so "what if we designed a framework such that the shortcut, the easy path, is the right path for agents?" Dune enforces process boundaries through the import graph and keeps a single paved path for each blessed pattern. Her point is that the framework itself matters less than owning one. rat-stack is ours. Alchemy puts infrastructure on the compiler rung: remove a binding and the code that uses it stops compiling. rat-stack's fence is the rest of the ladder, built in.

**Floor.** [Theo Browne](https://www.youtube.com/watch?v=iBrAWpjXNxs&t=349s): "raising the floor is way more beneficial than raising the ceiling." [He gave the same advice about videos](https://www.youtube.com/watch?v=q9GCu3hiNjw&t=707s) on Joel's channel: "raise the baseline so that you average higher... the floor is the hardest part to get right." A higher floor also makes failure cheaper: "it'll also make it hurt less when the video you put a lot of effort into bombs." The floor is the worst thing that happens on a normal run. His math is about long runs. A step that fails 5% of the time every ten minutes fails about 70% of the time over four hours. Cut that 5% to 3% and the four-hour failure rate drops to about 50%. Small cuts to the failure rate multiply how long the work can run. [At CascadiaJS](https://www.youtube.com/watch?v=TV6f2weVgCI&t=135s) he also said failure got cheap: "experimentation is now significantly cheaper... it costs pennies." Theo applies the floor to models. We apply it to the environment. Types, the fence, and cartridges that pull out cleanly raise the floor for every agent working here. That floor is what makes long-running agent loops worth leaving unattended.

**Range.** At [CascadiaJS 2026](https://www.youtube.com/watch?v=TV6f2weVgCI) Theo closed with "build bigger." A month later [he refined it](https://www.youtube.com/watch?v=xUnRQ9vLXxo&t=798s): "bigger is probably the wrong word... It's time to think wider." He means range, how much ground your software covers. A team could never match AWS's range without thousands of engineers. Now "you can build a database platform into your product in a day or two." He also says to architect products so users can build the features you are missing. And in his words, "wider prompting requires higher floors." He names the bottleneck too: "building is now like a thirty minute process... but the deploying hasn't went down at all." Composable Layers that carry their own infrastructure are our answer to that gap. If it compiles, it deploys.

Theo's case for ambition is to prompt further. Lauren's method is to build the environment. We take the ambition from him and the method from her.

## Layers are composable SaaS

With Alchemy, an Effect Layer can declare the cloud resources it needs. Providing the Layer provisions them on the next deploy. Sam calls this "SaaS as NPM." We build on it:

- A service tag is the product's API.
- A Layer is one vendor's implementation, and it carries its own infrastructure.
- `Layer.provide` is that vendor's private supply chain. Swapping vendors is a one-line change.
- Typed errors are the SLA, written in the type.

Alchemy spans providers. One stack can run Cloudflare next to PlanetScale, and that range is part of the point.

## The house rule: a clean playground

The house rule is a clean, organized playground where real work gets done. It sets no limit on size. Picture clear, labeled bins on shelves that push in and pull out like game cartridges. Anything good can go in if it passes the cartridge test:

- **Labeled.** One package, one job, named for that job.
- **Push in.** Adding it takes one package plus one `Layer.provide` or Stack line.
- **Pull out.** Removing it takes deleting that package and that line, and `pnpm turbo run check test build` still passes.
- **Self-contained.** It declares its own resources and bindings. Nothing spills into other bins.
- **EZ to trash.** It can be tossed in the garbage without affecting anything else.

Everything built here is real.

## Outcomes

- A project that vendors or clones rat-stack starts with a pnpm and Turborepo workspace, a real Effect CLI, and a trust fence.
- Agents hit a loud failure when they cheat, including `git … --no-verify` and skipped checks. Consider adding hooks to your harness to stop them cold.
- Prose explains the why. CI, lefthook, and agent hooks enforce the fence.
- Someone can ask an agent for an Effect-shaped, Alchemy-shaped solution and catch it when the agent gets it wrong.
- Product-specific corpora, tokens, and customer data stay out of the shared reference.

## Current priorities

1. Electrify the trust fence. Fuckin agent cheaters stay uncomfortable and obvious. They will feel shame and we will thwart them.
2. Hold advocacy and judgment together. Teach the judgment and let Alchemy win on merit.
3. Prove the claims in code, cheapest first:
   1. Importing `apps/infra/alchemy.run.ts` deploys nothing, and removing a binding is a type error.
   2. A database service tag with two vendor Layers, Cloudflare D1 and Hyperdrive in front of PlanetScale Postgres, with Drizzle inside each vendor. D1 is the free bin. PlanetScale has no free tier, and its cheapest database is single-node Postgres. The tag sits above Drizzle, so swapping vendors stays one line.
4. Test against real infrastructure: import a stack, deploy in `beforeAll`, hit real resources, destroy in `afterAll`, and run the same path for each pull request.
5. Coming: the generic agent front door in `apps/mischief` (REST, MCP, A2A, code-mode sandbox, rate limits) becomes its own cartridge that a project provides instead of inherits.

## Questions this repo answers in code

- Does the type system protect infrastructure correctness? Removing a binding should make typecheck fail. Not yet proven in this repo.
- Does importing `apps/infra/alchemy.run.ts` stay pure? It should deploy nothing. Not yet proven by a test.
- Can a vendor be swapped by changing one line? `packages/database` has one `DatabaseVendor` with D1 and Hyperdrive Postgres Layers, both tested. No test swaps them yet.
- Where does a correction to an agent live? Lauren Tan's fence ladder puts code first, then lint and CI, then rules and skills, with the style guide last. The `--no-verify` rung is proven today by `packages/core/test/vcs-command-policy.test.ts`.

## Open questions

- Does `ratstack.sh` stay in this repo? For now it does: the [lore wiki](https://ratstack.sh/lore/) is built from `.brain/resources/lore/`, and it cites only public sources.

## Merge by default

- Tests and checks that encode the existing fence
- Docs that sharpen why and fence without adding a second product promise
- Cartridges that pass the cartridge test and are real
- Pin bumps that stay exact and reviewed as stack changes

## Needs sign-off

- Weakening lefthook, CI, or `--no-verify` blocks
- Replacing pnpm, Turborepo, Effect, or XState as the default floor
- Adding product-specific vendor corpora to the shared reference
- Turning the public repo into a supported starter product
- Deploys and anything under `apps/infra`

## Will not do for now

- Support SLAs or a promise that it works on every agent harness
- Vendoring x-algorithm or other app-specific source
- Generating publishable copy as part of the reference
- Toy examples that exist only to demonstrate a pattern
- Bun or npm as the install story
- A gut-me-on-day-one scaffold with no fence

## Decision boundaries

- Safe by default: changes that keep the why in VISION and AGENTS, the fence enforceable, and every bin removable
- Needs owner sign-off: new promises, toolchain swaps, or making the fence optional
- Evidence expected: `pnpm check` and `pnpm test` green, plus hook policy tests that still block `git commit --no-verify`

## Amendment policy

This document changes when the thesis is wrong, not when a downstream project's product is different. Agents may propose amendments with receipts. Joel approves. A project that grows out of rat-stack writes its own `VISION.md` instead of stretching this one.
