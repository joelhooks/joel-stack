# Vision

This repo is an **agentic scaffold** for a TypeScript Effect app: CLI, XState lifecycles, Alchemy infrastructure, and varlock config. It began life as ts-cli-template. It is Joel's opinionated default for starting new work: why in the law files, an enforceable fence in the stack and hooks, so agents write good TypeScript because the cheap path is the honest path.

Public GitHub is a **steal the ideas** surface, not a product to support. Clones that become a real app should replace this vision with that product's intent. Until then, this thesis is the why.

**Scope:** `joelhooks/rat-stack` — the template repo and the shape a clone inherits on day one.

**Audience:** Joel, agents working in a clone, and anyone reading the public tree for ideas. Not paying users. Not a support queue.

## Who we serve

- Primary: Joel and the agents that start work from this scaffold
- Secondary: readers who steal the pattern (workspaces, source mirrors, fence that makes `--no-verify` fail loud)
- Not for: ghostwriting, growth automation, "thin npm init with extra steps," or a general TypeScript tutorial brand

## Why it exists

Agents will take the shortest path. A skeleton without law and gates produces sludge. A pile of prose without a fence is documentation. This scaffold exists so starting a CLI already includes:

1. Why — `VISION.md` and `AGENTS.md`
2. Fence — pins, `pnpm check`, lefthook, and harness hooks that block hook bypass
3. Context — vendored Effect / effect-solutions / XState sources for source-first edits

The stack is the load-bearing floor. The agent surface is the product.

## Outcomes

- A new CLI clone starts as a pnpm + Turborepo workspace with a real Effect CLI, not a single-folder lie
- Agents hit a loud failure when they cheat (`git … --no-verify`, skipped checks) instead of a silent green
- Why and fence stay split: prose explains; CI, lefthook, and agent hooks enforce
- Good TypeScript is the default path: strict TS, typed Effect errors, XState for real lifecycles
- Product-specific corpora (tokens, x-algorithm, customer data) stay out of the shared template

## Current priorities

1. Keep the scaffold honest: fence wins; cheating is uncomfortable and obvious
2. Keep pins and vendor refs matched to the stack actually used
3. Keep the example CLI small; the scaffold is the product, not `stats`

## Actors

- Beneficiary: Joel starting a CLI (and agents in that clone)
- Builders: anyone editing the template
- External systems: GitHub template clone, CI, Pi / Cursor / Claude hook runtimes
- Not an audience: people expecting support, compatibility, or a framework

## Merge by default

- Tests and checks that encode the existing fence
- Docs that sharpen why vs fence without adding a second product promise
- Small example-CLI fixes that keep the vertical slice working
- Pin bumps that stay exact and reviewed as stack changes

## Needs sign-off

- Weakening lefthook, CI, or `--no-verify` blocks
- Replacing pnpm / turbo / Effect / XState as the default floor
- Adding product-specific vendor corpora to the shared template
- Turning the public repo into a supported starter product

## Will not do for now

- Support SLAs or "works on every agent harness"
- Vendoring x-algorithm or other app-specific source
- Generating publishable copy as part of the template
- Bun or npm as the install story
- A gut-me-on-day-one scaffold with no fence

## Decision boundaries

- Safe by default: changes that keep why in VISION/AGENTS and the fence enforceable
- Needs owner sign-off: new promises, toolchain swaps, or making the fence optional
- Evidence expected: `pnpm check` / `pnpm test` green; hook policy tests that still block `git commit --no-verify`

## Amendment policy

This document changes when the scaffold thesis is wrong, not when a clone's product is different. Agents may propose amendments with receipts. Joel approves. A clone that is now a real product should write its own `VISION.md` instead of stretching this one.
