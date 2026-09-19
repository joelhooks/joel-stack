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
  ],
  // Lifted from statelyai/xstate: an Effect returned from an inline `enq`
  // callback is created and discarded, and inline Effect logic in `enq.spawn`
  // is invisible to RequirementsFrom. Declare both in setupEffect instead.
  jsPlugins: ["./scripts/oxlint-plugin-xstate-effect.ts"],
  options: {
    typeAware: true,
  },
  rules: {
    // Effect Schema.TaggedError(...) looks like a throw to unicorn.
    "unicorn/throw-new-error": "off",
    "xstate-effect/no-inline-effect": "error",
  },
});
