import { defineConfig } from "oxlint";
import core from "ultracite/oxlint/core";

export default defineConfig({
  extends: [core],
  ignorePatterns: [
    ...(core.ignorePatterns ?? []),
    ".agent_sources/**",
    ".agent-sources/**",
    "**/dist/**",
    "node_modules/**",
    ".pi/**",
    ".cursor/**",
    ".claude/**",
    "scripts/hooks/**",
    // Vendored rules; see tools/oxlint/anti-slop/UPSTREAM.md.
    "tools/oxlint/anti-slop/**",
  ],
  // Lifted from statelyai/xstate: an Effect returned from an inline `enq`
  // callback is created and discarded, and inline Effect logic in `enq.spawn`
  // is invisible to RequirementsFrom. Declare both in setupEffect instead.
  jsPlugins: [
    "./scripts/oxlint-plugin-xstate-effect.ts",
    // Adapted from t3code: tests run Effects through @effect/vitest, never by
    // hand, so every test gets a Scope, the TestClock, and layer memoization.
    "./scripts/oxlint-plugin-effect-tests.ts",
    // dmmulroy/anti-slop: reject code that throws away evidence at a boundary
    // or hides a weak contract behind a broad type. The Effect group adds
    // Effect-specific policy on top.
    { name: "anti-slop", specifier: "./tools/oxlint/anti-slop/index.ts" },
    {
      name: "anti-slop-effect",
      specifier: "./tools/oxlint/anti-slop/effect/index.ts",
    },
  ],
  options: {
    typeAware: true,
  },
  rules: {
    "anti-slop-effect/no-manual-effect-error-tag": "error",
    "anti-slop-effect/prefer-effect-match": "error",
    "anti-slop/no-known-value-widening": "error",
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-object-parameters": "error",
    "anti-slop/no-reduce-accumulator-copy": "error",
    "anti-slop/no-reflect-apply": "error",
    "anti-slop/no-unknown-type-aliases": "error",
    "anti-slop/no-widen-then-assert": "error",
    "anti-slop/require-readable-spacing": "error",
    "effect-tests/no-manual-effect-runtime-in-tests": "error",
    "oxc/no-accumulating-spread": "error",
    // Effect Schema.TaggedError(...) looks like a throw to unicorn.
    "unicorn/throw-new-error": "off",
    "xstate-effect/no-inline-effect": "error",
  },
});
