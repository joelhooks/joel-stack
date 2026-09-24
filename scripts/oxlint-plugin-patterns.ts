// @effect-diagnostics nodeBuiltinImport:off -- This Oxlint plugin runs as Node tooling and reads repository files directly.
import path from "node:path";

import { definePlugin, defineRule } from "@oxlint/plugins";
import type {
  Context,
  Definition,
  ESTree,
  Scope,
  Variable,
} from "@oxlint/plugins";

type RuleContext = Context;

type NodeOfType<Type extends ESTree.Node["type"]> = Extract<
  ESTree.Node,
  { type: Type }
>;

type IdentifierNode = NodeOfType<"Identifier">;

type AssignmentPatternNode = ESTree.AssignmentPattern;

type ReturnStatementNode = NodeOfType<"ReturnStatement">;

type FunctionThunk = ESTree.ArrowFunctionExpression | ESTree.Function;

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

const unwrapExpression = (node: ESTree.Expression): ESTree.Expression => {
  if (
    node.type === "ParenthesizedExpression" ||
    node.type === "ChainExpression" ||
    node.type === "TSAsExpression" ||
    node.type === "TSNonNullExpression" ||
    node.type === "TSSatisfiesExpression" ||
    node.type === "TSInstantiationExpression" ||
    node.type === "TSTypeAssertion"
  ) {
    return unwrapExpression(node.expression);
  }

  return node;
};

const staticPropertyName = (node: ESTree.MemberExpression): string | null => {
  if (!node.computed) {
    return node.property.type === "Identifier" ? node.property.name : null;
  }

  if (node.property.type === "Literal") {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers, booleans, and regexes, so computed API names need a string check.
    return typeof node.property.value === "string" ? node.property.value : null;
  }

  if (
    node.property.type === "TemplateLiteral" &&
    node.property.expressions.length === 0
  ) {
    const [firstQuasi] = node.property.quasis;

    return firstQuasi?.value.cooked ?? firstQuasi?.value.raw ?? null;
  }

  return null;
};

const staticPropertyKeyName = (
  node: ESTree.ObjectProperty | ESTree.BindingProperty
): string | null => {
  if (!node.computed && node.key.type === "Identifier") {
    return node.key.name;
  }

  if (node.key.type === "Literal") {
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers and booleans, so destructuring keys need a string check.
    return typeof node.key.value === "string" ? node.key.value : null;
  }

  if (
    node.key.type === "TemplateLiteral" &&
    node.key.expressions.length === 0
  ) {
    const [firstQuasi] = node.key.quasis;

    return firstQuasi?.value.cooked ?? firstQuasi?.value.raw ?? null;
  }

  return null;
};

const stringValue = (node: ESTree.Expression): string | null => {
  const expression = unwrapExpression(node);

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers and booleans, so contract names need a string check.
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }

  if (
    expression.type === "TemplateLiteral" &&
    expression.expressions.length === 0
  ) {
    return (
      expression.quasis[0]?.value.cooked ??
      expression.quasis[0]?.value.raw ??
      null
    );
  }

  return null;
};

const variableOf = (name: string, scope: Scope | null): Variable | undefined =>
  scope === null
    ? undefined
    : (scope.set.get(name) ?? variableOf(name, scope.upper));

const declarationOf = (
  name: string,
  scope: Scope | null
): Definition | undefined => variableOf(name, scope)?.defs[0];

const isStableVariable = (variable: Variable) =>
  variable.references.every(
    (reference) => !reference.isWrite() || reference.init
  );

const importedName = (node: ESTree.ImportSpecifier) =>
  node.imported.type === "Identifier"
    ? node.imported.name
    : node.imported.value;

interface ImportIdentity {
  readonly module: string;
  readonly name: string | null;
}

const importIdentity = (
  expression: ESTree.Expression,
  scope: Scope | null,
  context: RuleContext,
  seen = new Set<Definition["node"]>()
): ImportIdentity | null => {
  const requireFunction = (
    candidate: ESTree.Expression,
    candidateScope: Scope | null,
    visited = new Set<Definition["node"]>()
  ): boolean => {
    const requireBinding = (name: string, bindingScope: Scope | null) => {
      const variable = variableOf(name, bindingScope);

      if (variable === undefined) {
        return name === "require";
      }

      const [definition] = variable.defs;

      if (
        definition?.type !== "Variable" ||
        definition.node.type !== "VariableDeclarator" ||
        definition.node.init === null ||
        !isStableVariable(variable) ||
        visited.has(definition.node)
      ) {
        return false;
      }

      visited.add(definition.node);

      const declarationScope = context.sourceCode.getScope(definition.node);

      if (definition.node.id.type === "ObjectPattern") {
        const initializer = unwrapExpression(definition.node.init);

        return (
          initializer.type === "Identifier" &&
          initializer.name === "module" &&
          variableOf("module", declarationScope) === undefined &&
          definition.node.id.properties.some(
            (property) =>
              property.type === "Property" &&
              property.value.type === "Identifier" &&
              property.value.name === name &&
              staticPropertyKeyName(property) === "require"
          )
        );
      }

      if (definition.node.id.type !== "Identifier") {
        return false;
      }

      return requireFunction(definition.node.init, declarationScope, visited);
    };

    const target = unwrapExpression(candidate);

    if (target.type === "Identifier") {
      return requireBinding(target.name, candidateScope);
    }

    if (target.type === "MemberExpression") {
      return (
        staticPropertyName(target) === "require" &&
        target.object.type === "Identifier" &&
        target.object.name === "module" &&
        variableOf("module", candidateScope) === undefined
      );
    }

    if (target.type === "CallExpression") {
      const identity = importIdentity(
        target.callee,
        candidateScope,
        context,
        visited
      );

      return (
        identity?.name === "createRequire" &&
        (identity.module === "module" || identity.module === "node:module")
      );
    }

    return false;
  };

  const loadedModuleIdentity = (
    candidate: ESTree.Expression,
    candidateScope: Scope | null
  ): ImportIdentity | null => {
    const target = unwrapExpression(candidate);

    if (target.type === "AwaitExpression") {
      return loadedModuleIdentity(target.argument, candidateScope);
    }

    if (target.type === "ImportExpression") {
      const module = stringValue(target.source);

      return module === null ? null : { module, name: null };
    }

    if (target.type !== "CallExpression") {
      return null;
    }

    const [argument] = target.arguments;

    if (
      argument === undefined ||
      argument.type === "SpreadElement" ||
      !requireFunction(target.callee, candidateScope)
    ) {
      return null;
    }

    const module = stringValue(argument);

    return module === null ? null : { module, name: null };
  };

  const importBindingIdentity = (
    definition: Definition
  ): ImportIdentity | null => {
    const { parent } = definition.node;

    if (
      definition.type !== "ImportBinding" ||
      parent?.type !== "ImportDeclaration"
    ) {
      return null;
    }

    const module = stringValue(parent.source);

    if (module === null) {
      return null;
    }

    return {
      module,
      name:
        definition.node.type === "ImportSpecifier"
          ? importedName(definition.node)
          : null,
    };
  };

  const importIdentityForPattern = (
    name: string,
    pattern: ESTree.ObjectPattern,
    initializer: ESTree.Expression,
    patternScope: Scope | null
  ): ImportIdentity | null => {
    const property = pattern.properties.find(
      (item) =>
        item.type === "Property" &&
        item.value.type === "Identifier" &&
        item.value.name === name
    );

    if (property?.type !== "Property") {
      return null;
    }

    const imported = staticPropertyKeyName(property);
    const namespace = importIdentity(initializer, patternScope, context, seen);

    if (
      namespace === null ||
      (namespace.name !== null && namespace.name !== "Effect") ||
      imported === null
    ) {
      return null;
    }

    return {
      module:
        namespace.name === null
          ? namespace.module
          : `${namespace.module}/${namespace.name}`,
      name: imported,
    };
  };

  const importIdentityForVariable = (
    name: string,
    variable: Variable
  ): ImportIdentity | null => {
    const [definition] = variable.defs;

    if (definition === undefined || seen.has(definition.node)) {
      return null;
    }

    seen.add(definition.node);

    const imported = importBindingIdentity(definition);

    if (imported !== null) {
      return imported;
    }

    if (
      definition.type !== "Variable" ||
      definition.node.type !== "VariableDeclarator" ||
      !isStableVariable(variable) ||
      definition.node.init === null
    ) {
      return null;
    }

    const initializer = definition.node.init;
    const declarationScope = context.sourceCode.getScope(definition.node);

    if (definition.node.id.type === "ObjectPattern") {
      return importIdentityForPattern(
        name,
        definition.node.id,
        initializer,
        declarationScope
      );
    }

    return importIdentity(initializer, declarationScope, context, seen);
  };

  const loadedModule = loadedModuleIdentity(expression, scope);

  if (loadedModule !== null) {
    return loadedModule;
  }

  const value = unwrapExpression(expression);

  if (value.type === "Identifier") {
    const variable = variableOf(value.name, scope);

    return variable === undefined
      ? null
      : importIdentityForVariable(value.name, variable);
  }

  if (value.type === "MemberExpression") {
    const object = importIdentity(value.object, scope, context, seen);
    const name = staticPropertyName(value);

    if (
      object === null ||
      (object.name !== null && object.name !== "Effect") ||
      name === null
    ) {
      return null;
    }

    return { module: object.module, name };
  }

  return null;
};

const isEffectCall = (
  node: ESTree.Node,
  member: string,
  context: RuleContext
) => {
  const expression = node.type === "CallExpression" ? node : null;

  if (expression === null) {
    return false;
  }

  const callee = unwrapExpression(expression.callee);
  const scope = context.sourceCode.getScope(expression);

  if (callee.type === "Identifier") {
    const identity = importIdentity(callee, scope, context);

    return (
      identity !== null &&
      (identity.module === "effect" || identity.module.startsWith("effect/")) &&
      identity.name === member
    );
  }

  if (
    callee.type !== "MemberExpression" ||
    staticPropertyName(callee) !== member
  ) {
    return false;
  }

  const identity = importIdentity(callee.object, scope, context);

  return (
    identity !== null &&
    (identity.module === "effect" || identity.module.startsWith("effect/")) &&
    (identity.name === "Effect" || identity.name === null)
  );
};

const isNodeWithin = (node: ESTree.Node, ancestor: ESTree.Node) => {
  let current: ESTree.Node | null = node;

  while (current !== null) {
    if (current === ancestor) {
      return true;
    }

    current = current.parent;
  }

  return false;
};

const isCapturedValue = (
  expression: ESTree.Expression,
  thunk: FunctionThunk,
  context: RuleContext,
  seen = new Set<Definition["node"]>()
): boolean => {
  const value = unwrapExpression(expression);

  if (value.type === "Identifier") {
    const definition = declarationOf(
      value.name,
      context.sourceCode.getScope(value)
    );

    if (definition === undefined) {
      return true;
    }

    if (seen.has(definition.node)) {
      return false;
    }

    seen.add(definition.node);

    if (!isNodeWithin(definition.node, thunk)) {
      return true;
    }

    if (definition.node.type === "VariableDeclarator") {
      return definition.node.init === null
        ? false
        : isCapturedValue(definition.node.init, thunk, context, seen);
    }

    const defaultedParameter = thunk.params.find(
      (parameter): parameter is AssignmentPatternNode =>
        parameter.type === "AssignmentPattern" &&
        parameter.left.type === "Identifier" &&
        parameter.left.name === value.name
    );

    return defaultedParameter === undefined
      ? false
      : isCapturedValue(defaultedParameter.right, thunk, context, seen);
  }

  if (value.type === "ThisExpression") {
    return true;
  }

  if (value.type === "MemberExpression") {
    if (value.object.type === "ThisExpression") {
      return true;
    }

    return isCapturedValue(value.object, thunk, context, seen);
  }

  return false;
};

const returnsCapturedHandle = (node: ESTree.Node, context: RuleContext) => {
  if (node.type !== "CallExpression") {
    return false;
  }

  const expression = unwrapExpression(node);

  if (
    expression.type !== "CallExpression" ||
    !isEffectCall(expression, "sync", context)
  ) {
    return false;
  }

  const [argument] = expression.arguments;

  const thunk =
    argument === undefined || argument.type === "SpreadElement"
      ? null
      : unwrapExpression(argument);

  if (
    thunk === null ||
    (thunk.type !== "ArrowFunctionExpression" &&
      thunk.type !== "FunctionExpression") ||
    thunk.body === null
  ) {
    return false;
  }

  if (thunk.body.type !== "BlockStatement") {
    return isCapturedValue(thunk.body, thunk, context);
  }

  const returns = thunk.body.body.filter(
    (statement): statement is ReturnStatementNode =>
      statement.type === "ReturnStatement"
  );

  const [returned] = returns;

  return (
    returns.length === 1 &&
    returned !== undefined &&
    returned.argument !== null &&
    isCapturedValue(returned.argument, thunk, context)
  );
};

const acquireReleaseConstructsInAcquireBody = defineRule({
  create(context) {
    return {
      CallExpression(node) {
        if (!isEffectCall(node, "acquireRelease", context)) {
          return;
        }

        const [acquire] = node.arguments;

        if (acquire === undefined || acquire.type === "SpreadElement") {
          return;
        }

        const expression = unwrapExpression(acquire);

        if (
          isEffectCall(expression, "succeed", context) ||
          returnsCapturedHandle(expression, context)
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

const isModuleScopedVar = (node: ESTree.Node) => {
  let current = node.parent;

  while (current !== null && current.type !== "Program") {
    if (
      current.type === "ArrowFunctionExpression" ||
      current.type === "FunctionDeclaration" ||
      current.type === "FunctionExpression" ||
      current.type === "StaticBlock" ||
      current.type === "TSDeclareFunction" ||
      current.type === "TSModuleBlock"
    ) {
      return false;
    }

    current = current.parent;
  }

  return current?.type === "Program";
};

const noModuleLevelMutableState = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename))) {
      return {};
    }

    return {
      VariableDeclaration(node) {
        if (node.kind !== "let" && node.kind !== "var") {
          return;
        }

        const scope = context.sourceCode.getScope(node);

        const moduleScoped =
          node.kind === "let"
            ? scope.type === "module" || scope.type === "global"
            : isModuleScopedVar(node);

        if (moduleScoped) {
          context.report({ messageId: "moduleState", node });
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

const resolvesToName = (
  expression: ESTree.Expression,
  expected: string,
  scope: Scope | null,
  context: RuleContext
): boolean => {
  const identity = importIdentity(expression, scope, context);

  return (
    identity?.name === expected &&
    /^@[^/]+\/capability(?:\/contract)?$/u.test(identity.module)
  );
};

const contractName = (
  node: ESTree.Expression,
  scope: Scope | null,
  context: RuleContext
): string | null => {
  const expression = unwrapExpression(node);

  if (expression.type !== "CallExpression") {
    return null;
  }

  if (!resolvesToName(expression.callee, "defineContract", scope, context)) {
    return null;
  }

  const [first] = expression.arguments;

  return first === undefined || first.type === "SpreadElement"
    ? null
    : stringValue(first);
};

const contractBindingMatchesName = defineRule({
  create(context) {
    const check = (
      identifier: IdentifierNode,
      expression: ESTree.Expression
    ) => {
      const name = contractName(
        expression,
        context.sourceCode.getScope(identifier),
        context
      );

      if (name === null) {
        return;
      }

      const expected = camelCase(name);

      if (
        identifier.name !== expected &&
        identifier.name !== `${expected}Contract`
      ) {
        context.report({
          data: { expected, name },
          messageId: "binding",
          node: identifier,
        });
      }
    };

    return {
      AssignmentExpression(node) {
        if (node.left.type !== "Identifier") {
          return;
        }

        const definition = declarationOf(
          node.left.name,
          context.sourceCode.getScope(node.left)
        );

        if (
          definition?.type === "Variable" &&
          definition.node.type === "VariableDeclarator"
        ) {
          check(node.left, node.right);
        }
      },
      VariableDeclarator(node) {
        if (node.id.type === "Identifier" && node.init !== null) {
          check(node.id, node.init);
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

const isCapabilityWatcherModule = (module: string) =>
  /^@[^/]+\/capability(?:\/actor-watch)?$/u.test(module);

const callTarget = (node: ESTree.CallExpression) => {
  const callee = unwrapExpression(node.callee);

  if (callee.type !== "MemberExpression") {
    return { expression: callee, method: null };
  }

  const method = staticPropertyName(callee);

  return method === "call" || method === "apply"
    ? { expression: unwrapExpression(callee.object), method }
    : { expression: callee, method: null };
};

const callTargetIdentity = (
  node: ESTree.CallExpression,
  context: RuleContext
): ImportIdentity | null =>
  importIdentity(
    callTarget(node).expression,
    context.sourceCode.getScope(node),
    context
  );

const callArgument = (
  node: ESTree.CallExpression,
  index: number
): ESTree.Expression | null => {
  const { method } = callTarget(node);

  if (method === "call") {
    const argument = node.arguments[index + 1];

    return argument === undefined || argument.type === "SpreadElement"
      ? null
      : argument;
  }

  if (method === "apply") {
    const [, argumentList] = node.arguments;

    if (argumentList?.type !== "ArrayExpression") {
      return null;
    }

    const argument = argumentList.elements[index];

    return argument === null ||
      argument === undefined ||
      argument.type === "SpreadElement"
      ? null
      : argument;
  }

  const argument = node.arguments[index];

  return argument === undefined || argument.type === "SpreadElement"
    ? null
    : argument;
};

const isTransparentWrapper = (parent: ESTree.Node, child: ESTree.Node) => {
  if (parent.type === "AwaitExpression" || parent.type === "YieldExpression") {
    return parent.argument === child;
  }

  return (
    (parent.type === "ChainExpression" ||
      parent.type === "ParenthesizedExpression" ||
      parent.type === "TSAsExpression" ||
      parent.type === "TSNonNullExpression" ||
      parent.type === "TSSatisfiesExpression" ||
      parent.type === "TSTypeAssertion" ||
      parent.type === "TSInstantiationExpression") &&
    parent.expression === child
  );
};

const expressionForVariable = (
  node: ESTree.CallExpression,
  context: RuleContext
): ESTree.VariableDeclarator | null => {
  let current: ESTree.Node = node;
  let ancestor: ESTree.Node | null = current.parent;

  while (ancestor !== null) {
    if (isTransparentWrapper(ancestor, current)) {
      current = ancestor;
      ancestor = current.parent;
      continue;
    }

    if (ancestor.type === "VariableDeclarator" && ancestor.init === current) {
      return ancestor;
    }

    if (
      ancestor.type === "AssignmentExpression" &&
      ancestor.right === current &&
      ancestor.left.type === "Identifier"
    ) {
      const definition = declarationOf(
        ancestor.left.name,
        context.sourceCode.getScope(ancestor.left)
      );

      return definition?.node.type === "VariableDeclarator"
        ? definition.node
        : null;
    }

    return null;
  }

  return null;
};

const variableBinding = (
  identifier: IdentifierNode,
  context: RuleContext,
  seen = new Set<Definition["node"]>()
): ESTree.VariableDeclarator | null => {
  const variable = variableOf(
    identifier.name,
    context.sourceCode.getScope(identifier)
  );

  const definition = variable?.defs[0];

  if (
    definition?.type !== "Variable" ||
    definition.node.type !== "VariableDeclarator" ||
    seen.has(definition.node)
  ) {
    return null;
  }

  seen.add(definition.node);

  const initializer =
    definition.node.init === null
      ? null
      : unwrapExpression(definition.node.init);

  if (
    initializer?.type === "Identifier" &&
    variable !== undefined &&
    isStableVariable(variable)
  ) {
    return variableBinding(initializer, context, seen) ?? definition.node;
  }

  return definition.node;
};

const watchEffectActors = defineRule({
  create(context) {
    if (!isRuntimeSource(workspacePath(context.filename))) {
      return {};
    }

    const started: {
      readonly binding: ESTree.VariableDeclarator | null;
      readonly node: ESTree.CallExpression;
    }[] = [];

    const watchedBindings = new Set<ESTree.VariableDeclarator>();
    const watchedCalls = new Set<ESTree.CallExpression>();

    const bindingIsStable = (
      binding: ESTree.VariableDeclarator,
      actor: ESTree.CallExpression
    ) => {
      if (binding.id.type !== "Identifier") {
        return false;
      }

      const variable = variableOf(
        binding.id.name,
        context.sourceCode.getScope(binding)
      );

      return (
        variable !== undefined &&
        variable.references.every(
          (reference) =>
            !reference.isWrite() ||
            reference.init ||
            (reference.writeExpr !== null &&
              isNodeWithin(actor, reference.writeExpr))
        )
      );
    };

    return {
      CallExpression(node) {
        const identity = callTargetIdentity(node, context);

        if (
          identity?.module === "@xstate/effect" &&
          identity.name === "createEffectActor"
        ) {
          started.push({ binding: expressionForVariable(node, context), node });
        }

        if (
          identity === null ||
          !isCapabilityWatcherModule(identity.module) ||
          identity.name !== "watchActor"
        ) {
          return;
        }

        const argument = callArgument(node, 1);

        if (argument === null) {
          return;
        }

        const actor = unwrapExpression(argument);

        if (actor.type === "Identifier") {
          const binding = variableBinding(actor, context);

          if (binding !== null) {
            watchedBindings.add(binding);
          }

          return;
        }

        if (actor.type === "CallExpression") {
          watchedCalls.add(actor);
        }
      },
      "Program:exit"() {
        for (const actor of started) {
          const watched =
            actor.binding === null
              ? watchedCalls.has(actor.node)
              : watchedBindings.has(actor.binding) &&
                bindingIsStable(actor.binding, actor.node);

          if (!watched) {
            context.report({ messageId: "unwatched", node: actor.node });
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Hand every Effect-backed actor to watchActor so devtools can inspect it.",
    },
    messages: {
      unwatched:
        'Call watchActor("<machine>", actor) from @rat-stack/capability/actor-watch after createEffectActor. It is a no-op until devtools provides a watcher, and without it rat_list_actors cannot see this machine.',
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
    "watch-effect-actors": watchEffectActors,
  },
});
