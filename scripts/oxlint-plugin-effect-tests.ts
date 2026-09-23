import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const TEST_FILE_PATTERN = /\.(?:test|spec)\.[cm]?[jt]sx?$/u;

const EFFECT_RUNTIME_METHODS = new Set([
  "runCallback",
  "runCallbackWith",
  "runFork",
  "runForkWith",
  "runPromise",
  "runPromiseExit",
  "runPromiseExitWith",
  "runPromiseWith",
  "runSync",
  "runSyncExit",
  "runSyncExitWith",
  "runSyncWith",
]);

const manualRunnerName = (callee: ESTree.Node): string | undefined => {
  if (
    callee.type !== "MemberExpression" ||
    callee.object.type !== "Identifier" ||
    callee.property.type !== "Identifier"
  ) {
    return undefined;
  }

  const object = callee.object.name;
  const method = callee.property.name;

  if (object === "Effect" && EFFECT_RUNTIME_METHODS.has(method)) {
    return `Effect.${method}`;
  }

  if (object === "ManagedRuntime" && method === "make") {
    return "ManagedRuntime.make";
  }

  return undefined;
};

const noManualEffectRuntimeInTests = defineRule({
  create(context) {
    if (!TEST_FILE_PATTERN.test(context.filename)) {
      return {};
    }

    return {
      CallExpression(node) {
        if (manualRunnerName(node.callee) !== undefined) {
          context.report({ messageId: "manualRunner", node: node.callee });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Disallow manually creating or running Effect runtimes in tests; use @effect/vitest.",
    },
    messages: {
      manualRunner:
        "Do not run Effects by hand in tests. Use @effect/vitest: it.effect(...) or it.layer(layer)(...).",
    },
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "effect-tests" },
  rules: { "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests },
});
