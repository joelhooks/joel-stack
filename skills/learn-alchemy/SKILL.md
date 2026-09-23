---
name: learn-alchemy
description: Learn how Alchemy 2 turns an Effect program into a planned Cloudflare deployment.
---

# Learn Alchemy

Alchemy 2 is Effect-native infrastructure as code. It lets one program declare resources, bindings, deployment state, and the Worker that uses them.

Cloudflare is this repo's on-ramp, not the frame. Learn the vocabulary here so an agent can write the infrastructure and you can check what it plans to change.

Sam Goodwin describes an Effect as a promise with more information: its return value, errors, and requirements. His Alchemy shorthand is "if it compiles, it should deploy and run." Treat that as a useful feedback loop, not a promise that cloud APIs cannot fail.

## The vocabulary

- **Stack** groups one infrastructure program and its outputs. Rat-stack exports `Alchemy.Stack("RatStack", ...)` in `apps/infra/alchemy.run.ts`.
- **Provider** supplies the cloud API implementation. `Cloudflare.providers()` appears in the Stack options in `apps/infra/alchemy.run.ts`.
- **State** records the resources that a Stack already owns. Rat-stack uses `Cloudflare.state()` in `apps/infra/alchemy.run.ts`.
- **Resource** is a declared cloud object such as a Zone, DNS record, DNSSEC setting, or Worker. Each gets a stable logical name in `apps/infra/alchemy.run.ts`.
- **Binding** is a typed runtime value attached to a Worker. Rat-stack declares the `CODE_SANDBOX` WorkerLoader and three RateLimit bindings in `apps/mischief/src/worker.ts`.
- **Plan** is the graph diff before a provider changes anything. Read it with the `plan` script in `apps/infra/package.json`.
- **Stage** names an isolated deployment state. Rat-stack's production stage is `prod`; the unflagged default is `live_$USER`.
- **Profile** holds provider credentials for the Alchemy CLI. This repo uses an Alchemy profile, not environment variables, for Cloudflare authentication.
- **Adopt** means take ownership of an existing resource explicitly. The existing `ratstack.sh` Zone and its DNSSEC setting use `adopt(true)` in `apps/infra/alchemy.run.ts`.
- **Dev** is local workerd execution with `ALCHEMY_DEV=true`. Rat-stack uses it to skip the production Zone and DNS resources in `apps/infra/alchemy.run.ts`.

## Trace one deploy

Read `apps/infra/alchemy.run.ts` from top to bottom.

1. The file imports Alchemy, the Cloudflare provider, Effect, and the `Mischief` Worker from `apps/mischief/src/worker.ts`.
2. `Alchemy.Stack` creates the program. `Effect.gen` gives it a place to yield resources and return outputs.
3. `Cloudflare.providers()` supplies Cloudflare operations. `Cloudflare.state()` lets Alchemy compare this run with prior state.
4. `ALCHEMY_DEV` guards resources that should not be touched by local development.
5. The Zone is named `RatstackZone` and adopted because `ratstack.sh` already exists. A Zone normally retains on destroy, and this Stack does not opt into deleting it.
6. The DNS-AID SVCB and TXT records point agent discovery at the deployed site. They use the adopted Zone's `zoneId`.
7. `Cloudflare.DNS.Dnssec` keeps DNSSEC active. It is adopted for the same reason as the Zone.
8. `Mischief` declares the Worker with `ratstack.sh` as its custom domain, `www.ratstack.sh` as a redirect, and port 1337 for dev.
9. The Worker construction yields its WorkerLoader and RateLimit bindings. `Effect.provide(Cloudflare.Workers.RateLimitBinding)` supplies the RateLimit client layer.
10. The Stack returns `mischiefUrl`, an output derived from the Worker resource.

The core shape is small:

```ts
export default Alchemy.Stack(
  "RatStack",
  { providers: Cloudflare.providers(), state: Cloudflare.state() },
  Effect.gen(function* stack() {
    const dev = yield* Alchemy.ALCHEMY_DEV;
    if (!dev) {
      // Zone, DNS, and DNSSEC resources
    }
    const mischief = yield* Mischief;
    return { mischiefUrl: mischief.url };
  })
);
```

What to notice: the Stack is an Effect. Importing it describes work. The CLI runs it during a plan or deploy.

### Follow the Worker bindings

`apps/mischief/src/worker.ts` exports `class Mischief extends Cloudflare.Worker<Mischief>()(...) {}` with `main: import.meta.url`, so Alchemy bundles the default Worker export. Its construction Effect yields bindings before it returns the `fetch` implementation. Alchemy populates `Cloudflare.WorkerEnvironment` dynamically; this repo keeps the expected binding shape in local types at that boundary.

```ts
yield * Cloudflare.WorkerLoader("CODE_SANDBOX");
yield *
  Cloudflare.RateLimit("EXECUTE_GLOBAL", rateLimitDeclarations.EXECUTE_GLOBAL);
const environment = yield * Cloudflare.WorkerEnvironment;
const bindings = environment as RateLimitBindings & {
  readonly CODE_SANDBOX: WorkerLoaderBinding;
};
```

`apps/mischief/src/rate-limits.ts` keeps the three native binding names and their numeric namespace IDs together. `rateLimitsFrom` calls the native `.limit({ key })` method and turns a failed runtime call into a defect instead of failing open.

`apps/mischief/src/sandbox-worker-loader.ts` consumes the `CODE_SANDBOX` binding. It loads a fresh Dynamic Worker with limits and `globalOutbound: null`, so the code-mode Worker can compute and call declared capabilities without reaching the network.

The constructor pattern is the useful seam. Sam calls it another word for a Layer: declare dependencies in the Effect, use them, then return the implementation. His React analogy is practical here. Dependencies are the hooks at the top. The returned Worker is the component.

What to notice: comment out a binding and the consumer no longer has the runtime value it expects. The infrastructure and application code fail together instead of drifting apart.

## Plan, then deploy

The scripts live in `apps/infra/package.json`:

```sh
pnpm infra:plan
pnpm infra:deploy
pnpm infra:dev
pnpm infra:destroy
```

Run the plan first. It shows `create`, `update`, `adopt`, and `noop` actions before a provider is changed. Review replacements, domains, DNS, bindings, and stage before approving a deploy.

Production is stage `prod`. Pass `--stage prod` to the Alchemy CLI. An unflagged deploy defaults to `live_$USER`, which can create a second Worker instead of updating production. Never run an indiscriminate stage destroy. Name the stage explicitly and read its plan first.

Alchemy v2 keeps plan-time outputs boxed until deployment while still letting resources reference one another. Sam explains that this is intentionally close to Pulumi's output model: the engine can see the graph before it acts. The point is not to remove plans. The point is to get plans without hand-written await chains and accidental concurrency.

## Why not wrangler.toml or Terraform

Wrangler is a good Cloudflare-specific tool. This repo needs one Effect program that declares the Zone, DNS records, DNSSEC, Worker, and the bindings consumed by the Worker, so Alchemy is the chosen boundary.

Terraform would keep infrastructure and the Effect Worker in separate languages and graphs. Alchemy can infer the Worker binding wiring from the same construction code that consumes it, while still showing a plan first.

This is not a universal winner. Keep an existing tool when it already owns the state and the team knows its review path. Choose Alchemy here because the typed application and the cloud graph are one lesson.

## Gotchas from this repo

- The Worker bundle uses Alchemy's Rolldown path, and Node's type stripping is outside the normal TypeScript program. A red `pnpm typecheck` does not stop Alchemy from producing a deploy plan or bundle. Run `pnpm turbo run check test build` first and inspect the failing task. Do not use a deploy to bypass a red gate.
- Cloudflare API changes have broken Alchemy releases before. Check the pinned version in `apps/infra/package.json` and the generated pins page before changing it.
- The repo pins Alchemy to a beta and Effect to a release candidate. Alpha and beta APIs drift. Read the current pins and vendored source before copying an example from elsewhere.
- Cloudflare rejected string rate-limit namespace IDs during a deploy even though the local type allowed them. `apps/mischief/src/rate-limits.ts` uses numeric IDs and documents the boundary.
- `adopt(true)` is a safety decision, not decoration. Without it, Alchemy refuses to take over an existing Zone. Keep adoption narrow and never assume a resource is safe to destroy.
- Profiles carry Cloudflare credentials. Do not add provider tokens to `.env`, source files, or Worker bindings just to make the CLI convenient.

## Try it

1. Run `pnpm infra:plan` and read every action. Do not approve a deploy. Identify which resources are `noop` and which would change.
2. On a throwaway branch, add one temporary RateLimit binding in `apps/mischief/src/worker.ts`, consume it, and run the Worker typecheck. Remove it after seeing how the declaration and consumer stay aligned. Do not deploy it.
3. Run `pnpm infra:dev`. Alchemy starts the Worker in local workerd, using the `dev` port from `apps/mischief/src/worker.ts`; the `ALCHEMY_DEV` branch skips the production Zone and DNS resources.

## Read before changing

1. Read `AGENTS.md` for pins, commands, boundaries, and the validation fence.
2. Read `VISION.md` for why the scaffold keeps infrastructure and application contracts explicit.
3. Read `apps/infra/alchemy.run.ts` for the Stack and the cloud footprint.
4. Read `apps/infra/package.json` for plan, deploy, dev, and destroy scripts.
5. Read `apps/mischief/src/worker.ts` for Worker construction and binding consumers.
6. Read `apps/mischief/src/rate-limits.ts` for native rate-limit types and limits.
7. Read `apps/mischief/src/sandbox-worker-loader.ts` for the fresh-isolate sandbox boundary.
8. Read `.brain/projects/ratstack-sh/deploy-ratstack-sh.svx` for real deployment history and failures.
9. Read `.brain/projects/ratstack-sh/research-alchemy-effect-worker.svx` for the Worker shape and local-dev research.

Know enough to name the resource, ask the agent for a plan, and check the diff. The agent can write the Effect. You own the review.
