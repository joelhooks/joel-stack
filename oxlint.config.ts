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
  options: {
    typeAware: true,
  },
  rules: {
    // Effect Schema.TaggedError(...) looks like a throw to unicorn.
    "unicorn/throw-new-error": "off",
  },
});
