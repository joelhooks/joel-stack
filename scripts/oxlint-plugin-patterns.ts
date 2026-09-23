import path from "node:path";

import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

const repoRoot = path.resolve(import.meta.dirname, "..");

const workspacePath = (filename: string) => {
  const relative = path
    .relative(repoRoot, path.resolve(filename))
    .split(path.sep)
    .join("/");

  const match = /(?:^|\/)(?<workspace>(?:apps|packages)\/.+)$/u.exec(relative);

  return match?.groups?.workspace ?? relative;
};

const isRuntimeSource = (filename: string) =>
  /^(?:apps|packages)\/[^/]+\/src\/.+/u.test(filename) &&
  !filename.endsWith(".svelte");

const isEffectCall = (node: ESTree.Node, member: string) =>
  node.type === "CallExpression" &&
  node.callee.type === "MemberExpression" &&
  node.callee.object.type === "Identifier" &&
  node.callee.object.name === "Effect" &&
  node.callee.property.type === "Identifier" &&
  node.callee.property.name === member;

const returnsCapturedHandle = (node: ESTree.Node) => {
  if (node.type !== "CallExpression" || !isEffectCall(node, "sync")) {
    return false;
  }

  const [thunk] = node.arguments;

  return (
    thunk !== undefined &&
    thunk.type === "ArrowFunctionExpression" &&
    thunk.body.type === "Identifier"
  );
};

const acquireReleaseConstructsInAcquireBody = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        if (!isEffectCall(node, "acquireRelease")) {
          return;
        }

        const [acquire] = node.arguments;

        if (
          acquire !== undefined &&
          acquire.type !== "SpreadElement" &&
          (isEffectCall(acquire, "succeed") || returnsCapturedHandle(acquire))
        ) {
          context.report({ messageId: "eagerAcquire", node: acquire });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Construct a resource inside the Effect.acquireRelease acquire Effect, not before it.",
    },
    messages: {
      eagerAcquire:
        "Build the resource inside acquire (Effect.sync, Effect.tryPromise, or another lazy Effect). Effect.succeed(handle) or Effect.sync(() => handle) creates it before acquire runs, so an interruption in between leaks it.",
    },
    type: "problem",
  },
});

const noModuleLevelMutableState = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename))) {
      return {};
    }

    const check = (node: ESTree.Node) => {
      if (node.type === "VariableDeclaration" && node.kind !== "const") {
        context.report({ messageId: "moduleState", node });
      }
    };

    return {
      Program(program) {
        for (const statement of program.body) {
          check(statement);

          if (
            statement.type === "ExportNamedDeclaration" &&
            statement.declaration !== null
          ) {
            check(statement.declaration);
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description: "Keep state out of module-level let and var bindings.",
    },
    messages: {
      moduleState:
        "Module-level let and var are shared by every request a Worker isolate or server process handles. Keep state in a Ref inside a Layer, a Durable Object, or the database.",
    },
    type: "problem",
  },
});

const camelCase = (name: string) =>
  name
    .split(/[^A-Za-z0-9]+/u)
    .filter((part) => part !== "")
    .map((part, index) =>
      index === 0
        ? `${part.charAt(0).toLowerCase()}${part.slice(1)}`
        : `${part.charAt(0).toUpperCase()}${part.slice(1)}`
    )
    .join("");

const contractName = (node: ESTree.Expression): string | null => {
  if (node.type !== "CallExpression") {
    return null;
  }

  const { callee } = node;

  const isDefineContract =
    (callee.type === "Identifier" && callee.name === "defineContract") ||
    (callee.type === "MemberExpression" &&
      callee.property.type === "Identifier" &&
      callee.property.name === "defineContract");

  const [first] = node.arguments;

  if (
    !isDefineContract ||
    first === undefined ||
    first.type !== "Literal" ||
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers and booleans, so the contract name needs a string check.
    typeof first.value !== "string"
  ) {
    return null;
  }

  return first.value;
};

const contractBindingMatchesName = defineRule({
  create(context) {
    return {
      VariableDeclarator(node) {
        if (node.id.type !== "Identifier" || node.init === null) {
          return;
        }

        const name = contractName(node.init);

        if (name === null) {
          return;
        }

        const expected = camelCase(name);

        if (
          node.id.name !== expected &&
          node.id.name !== `${expected}Contract`
        ) {
          context.report({
            data: { expected, name },
            messageId: "binding",
            node: node.id,
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Name a defineContract binding after the contract, so a search for the name finds it.",
    },
    messages: {
      binding:
        'Name this binding {{expected}}Contract or {{expected}}, to match the contract name "{{name}}".',
    },
    type: "suggestion",
  },
});

export default definePlugin({
  meta: { name: "rat-stack-patterns" },
  rules: {
    "acquire-release-constructs-in-acquire-body":
      acquireReleaseConstructsInAcquireBody,
    "contract-binding-matches-name": contractBindingMatchesName,
    "no-module-level-mutable-state": noModuleLevelMutableState,
  },
});
