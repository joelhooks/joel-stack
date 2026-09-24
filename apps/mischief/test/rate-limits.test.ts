import { expect, it } from "@effect/vitest";

import { rateLimitNamespaceIds } from "../src/rate-limits.js";

it("preserves the production namespace IDs", () => {
  expect(rateLimitNamespaceIds("prod")).toEqual({
    API_PER_IP: 1001,
    EXECUTE_GLOBAL: 1002,
    EXECUTE_PER_IP: 1003,
  });
});

it("assigns deterministic, distinct non-production namespace blocks", () => {
  const liveJoel = rateLimitNamespaceIds("live_joel");
  const liveJoelAgain = rateLimitNamespaceIds("live_joel");
  const preview = rateLimitNamespaceIds("preview-123");
  const ids = [...Object.values(liveJoel), ...Object.values(preview)];

  expect(liveJoelAgain).toEqual(liveJoel);
  expect(new Set(ids).size).toBe(ids.length);
  expect(ids.every((id) => id > 1003 && id < 2 ** 31)).toBe(true);
});
