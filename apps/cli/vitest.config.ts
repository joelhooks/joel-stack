import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The e2e tests spawn the built CLI as a child process. The first cold
    // spawn on a CI runner has grown past vitest's 5 s default (548 ms, then
    // 3.1 s, then 5.0 s across three runs) as the CLI gained surfaces.
    testTimeout: 30_000,
  },
});
