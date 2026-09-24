import { existsSync } from "node:fs";
import { isBuiltin } from "node:module";
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

type PropertyNode = NodeOfType<"Property">;

type StaticKeyValue = NodeOfType<"Literal">["value"] | null;

const repoRoot = path.resolve(import.meta.dirname, "..");

const clientNames = new Set([
  "AtomRpc",
  "FetchHttpClient",
  "HttpClient",
  "RpcClient",
]);

const clientFactories = new Set([
  "createHttpClient",
  "createRpcClient",
  "makeHttpClient",
  "makeRpcClient",
]);

const surfaceConstructorNames = new Set([
  "HttpApi",
  "HttpApiEndpoint",
  "HttpApiGroup",
  "Rpc",
  "RpcGroup",
  "Tool",
  "Toolkit",
]);

const browserContractModules = new Set([
  "packages/capability/rpc-group",
  "packages/core/contracts",
  "packages/devtools/contracts",
]);

const workspacePath = (filename: string) => {
  const relative = path
    .relative(repoRoot, path.resolve(filename))
    .split(path.sep)
    .join("/");

  const match = /(?:^|\/)(?<workspace>(?:apps|packages)\/.+)$/u.exec(relative);

  return match?.groups?.workspace ?? relative;
};

const isWithin = (filename: string, directory: string) =>
  filename === directory || filename.startsWith(`${directory}/`);

const isPackage = (filename: string) => isWithin(filename, "packages");

const isCapabilityPackage = (filename: string) =>
  isWithin(filename, "packages/capability");

const isInfraApp = (filename: string) => isWithin(filename, "apps/infra");

const isFeature = (filename: string) =>
  /^apps\/[^/]+\/src\/(?:dev\/)?features\/.+/u.test(filename);

const isBrowserZone = (filename: string) =>
  isFeature(filename) ||
  /^apps\/[^/]+\/src\/(?:dev\/)?client\/.+/u.test(filename);

const unwrapExpression = (node: ESTree.Expression): ESTree.Expression => {
  if (
    node.type === "ParenthesizedExpression" ||
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

const isStringModule = (node: ESTree.Expression): string | null => {
  const expression = unwrapExpression(node);

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers and booleans, so module sources need a string boundary check.
  if (expression.type === "Literal" && typeof expression.value === "string") {
    return expression.value;
  }

  if (
    expression.type === "TemplateLiteral" &&
    expression.expressions.length === 0
  ) {
    const value =
      expression.quasis[0]?.value.cooked ?? expression.quasis[0]?.value.raw;

    return value ?? null;
  }

  return null;
};

const normalizeWorkspacePath = (
  filename: string,
  specifier: string
): string | null => {
  if (specifier.startsWith(".")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(filename), specifier)
    );
  }

  if (specifier.startsWith("apps/") || specifier.startsWith("packages/")) {
    return path.posix.normalize(specifier);
  }

  if (specifier.startsWith("/")) {
    return workspacePath(specifier);
  }

  const workspacePackage = /^@[^/]+\/(?<name>[^/]+)(?:\/(?<suffix>.*))?$/u.exec(
    specifier
  );

  if (workspacePackage === null) {
    return null;
  }

  const name = workspacePackage.groups?.name;

  if (name === undefined) {
    return null;
  }

  const suffix = workspacePackage.groups?.suffix ?? "";
  const appPackage = path.posix.join("apps", name, suffix);
  const libraryPackage = path.posix.join("packages", name, suffix);

  if (existsSync(path.join(repoRoot, "apps", name))) {
    return appPackage;
  }

  if (existsSync(path.join(repoRoot, "packages", name))) {
    return libraryPackage;
  }

  return null;
};

const importModule = (
  context: RuleContext,
  filename: string,
  node: ESTree.Node,
  specifier: string
) => {
  const target = normalizeWorkspacePath(filename, specifier);

  if (target !== null && isPackage(filename) && isWithin(target, "apps")) {
    context.report({ messageId: "packageApp", node });
  }

  if (
    target !== null &&
    isCapabilityPackage(filename) &&
    isWithin(target, "packages/core")
  ) {
    context.report({ messageId: "capabilityDomain", node });
  }

  if (
    target !== null &&
    !isInfraApp(filename) &&
    isWithin(target, "apps/infra")
  ) {
    context.report({ messageId: "infraOwner", node });
  }
};

const browserCapabilityModule = (filename: string, specifier: string) => {
  const target = normalizeWorkspacePath(filename, specifier);

  if (
    specifier.startsWith("@") &&
    target !== null &&
    browserContractModules.has(target)
  ) {
    return false;
  }

  return (
    target !== null &&
    (isWithin(target, "packages/capability") ||
      isWithin(target, "packages/core") ||
      isWithin(target, "packages/devtools") ||
      /^apps\/[^/]+\/src\/capabilities(?:\/|$)/u.test(target))
  );
};

const browserServerModule = (filename: string, specifier: string) => {
  const normalized = specifier.toLowerCase();
  const target = normalizeWorkspacePath(filename, specifier);

  return (
    isBuiltin(specifier) ||
    normalized.startsWith("node:") ||
    /^alchemy(?:\/|$)/u.test(normalized) ||
    normalized === "cloudflare:workers" ||
    normalized === "@effect/platform-node" ||
    normalized.startsWith("@effect/platform-node/") ||
    normalized === "server-only" ||
    normalized.startsWith("server-only/") ||
    normalized.includes("/httpserver") ||
    /(?:^|\/)server(?:\/|$)/u.test(normalized) ||
    /\.server(?:\.[^/]*)?$/u.test(normalized) ||
    (target !== null && isWithin(target, "apps/infra"))
  );
};

const staticPropertyKeyName = (node: PropertyNode): string | undefined => {
  if (!node.computed && node.key.type === "Identifier") {
    return node.key.name;
  }

  let value: StaticKeyValue = null;

  if (node.computed && node.key.type === "Literal") {
    const { value: literalValue } = node.key;
    value = literalValue;
  }

  if (
    node.computed &&
    node.key.type === "TemplateLiteral" &&
    node.key.expressions.length === 0
  ) {
    const [firstQuasi] = node.key.quasis;
    value = firstQuasi?.value.cooked ?? firstQuasi?.value.raw ?? null;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers and booleans, so object keys need a string check.
  return typeof value === "string" ? value : undefined;
};

const staticPropertyName = (node: ESTree.MemberExpression) => {
  if (!node.computed && node.property.type === "Identifier") {
    return node.property.name;
  }

  let value: StaticKeyValue = null;

  if (node.computed && node.property.type === "Literal") {
    const { value: literalValue } = node.property;
    value = literalValue;
  }

  if (
    node.computed &&
    node.property.type === "TemplateLiteral" &&
    node.property.expressions.length === 0
  ) {
    const [firstQuasi] = node.property.quasis;
    value = firstQuasi?.value.cooked ?? firstQuasi?.value.raw ?? null;
  }

  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers, booleans, and regexes, so a computed key needs a string check.
  return typeof value === "string" ? value : undefined;
};

const rootIdentifierNode = (node: ESTree.Node): IdentifierNode | null => {
  let current = node;

  while (current.type === "MemberExpression") {
    current = current.object;
  }

  return current.type === "Identifier" ? current : null;
};

const importedName = (
  node: ESTree.ImportDeclaration["specifiers"][number]
): string | null => {
  if (node.type !== "ImportSpecifier") {
    return null;
  }

  if (node.imported.type === "Identifier") {
    return node.imported.name;
  }

  return node.imported.value;
};

const variableOf = (name: string, scope: Scope | null): Variable | undefined =>
  scope === null
    ? undefined
    : (scope.set.get(name) ?? variableOf(name, scope.upper));

const isStableVariable = (variable: Variable) =>
  variable.references.every(
    (reference) => !reference.isWrite() || reference.init
  );

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
      const module = isStringModule(target.source);

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

    const module = isStringModule(argument);

    return module === null ? null : { module, name: null };
  };

  const importBindingIdentity = (
    definition: Definition
  ): ImportIdentity | null => {
    if (
      definition.type !== "ImportBinding" ||
      definition.node.parent.type !== "ImportDeclaration"
    ) {
      return null;
    }

    const module = isStringModule(definition.node.parent.source);

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
      (namespace.name !== null &&
        !surfaceConstructorNames.has(namespace.name)) ||
      imported === undefined
    ) {
      return null;
    }

    const module =
      namespace.name === null
        ? namespace.module
        : `${namespace.module}/${namespace.name}`;

    return { module, name: imported };
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

    return object !== null &&
      (object.name === null || surfaceConstructorNames.has(object.name)) &&
      name !== undefined
      ? {
          module:
            object.name === null
              ? object.module
              : `${object.module}/${object.name}`,
          name,
        }
      : null;
  }

  return null;
};

type TransportKind = "client" | "factory";

const transportKindForName = (name: string): TransportKind | null => {
  if (clientNames.has(name)) {
    return "client";
  }

  if (clientFactories.has(name)) {
    return "factory";
  }

  return null;
};

const isTransportNamespace = (module: string) =>
  /(?:^|\/)(?:atomrpc|fetchhttpclient|http|httpapi|httpclient|rpc|rpcclient)$/iu.test(
    module
  );

const transportKindForExpression = (
  expression: ESTree.Expression,
  scope: Scope | null,
  context: RuleContext
): TransportKind | null => {
  const identity = importIdentity(expression, scope, context);

  if (identity === null) {
    return null;
  }

  if (identity.name !== null) {
    return transportKindForName(identity.name);
  }

  return isTransportNamespace(identity.module) ? "client" : null;
};

const isTypeOnlyDefinition = (definition: Definition) => {
  if (
    definition.node.type === "TSInterfaceDeclaration" ||
    definition.node.type === "TSTypeAliasDeclaration"
  ) {
    return true;
  }

  if (
    definition.type === "ImportBinding" &&
    definition.node.parent.type === "ImportDeclaration" &&
    (definition.node.parent.importKind === "type" ||
      (definition.node.type === "ImportSpecifier" &&
        definition.node.importKind === "type"))
  ) {
    return true;
  }

  return (
    definition.node.type === "VariableDeclarator" &&
    definition.node.parent.type === "VariableDeclaration" &&
    definition.node.parent.declare === true
  );
};

const isDeclaredLocally = (name: string, scope: Scope | null): boolean =>
  scope !== null &&
  ((scope.set
    .get(name)
    ?.defs.some((definition) => !isTypeOnlyDefinition(definition)) ??
    false) ||
    isDeclaredLocally(name, scope.upper));

const isReference = (node: ESTree.Node, scope: Scope | null): boolean =>
  scope !== null &&
  (scope.references.some((reference) => reference.identifier === node) ||
    scope.through.some((reference) => reference.identifier === node) ||
    isReference(node, scope.upper));

const isTypePosition = (node: ESTree.Node): boolean => {
  let current = node;

  while (true) {
    const { parent } = current;

    if (parent === null) {
      return false;
    }

    if (
      parent.type === "TSTypeAnnotation" ||
      parent.type === "TSTypeReference" ||
      parent.type === "TSQualifiedName" ||
      parent.type === "TSTypeQuery" ||
      parent.type === "TSImportType" ||
      parent.type === "TSInterfaceDeclaration" ||
      parent.type === "TSTypeAliasDeclaration"
    ) {
      return true;
    }

    current = parent;
  }
};

const globalObjects = new Set(["global", "globalThis", "self", "window"]);

const resolvesGlobalObject = (
  expression: ESTree.Expression,
  scope: Scope | null,
  context: RuleContext,
  seen = new Set<Definition["node"]>()
): boolean => {
  const value = unwrapExpression(expression);

  if (value.type !== "Identifier") {
    return false;
  }

  const variable = variableOf(value.name, scope);
  const definition = variable?.defs[0];

  if (definition === undefined) {
    return globalObjects.has(value.name);
  }

  if (seen.has(definition.node)) {
    return false;
  }

  seen.add(definition.node);

  return (
    definition.type === "Variable" &&
    definition.node.type === "VariableDeclarator" &&
    definition.node.id.type === "Identifier" &&
    definition.node.init !== null &&
    isStableVariable(variable) &&
    resolvesGlobalObject(
      definition.node.init,
      context.sourceCode.getScope(definition.node),
      context,
      seen
    )
  );
};

const isRequireFunction = (
  expression: ESTree.Expression,
  scope: Scope,
  context: RuleContext,
  seen = new Set<Definition["node"]>()
): boolean => {
  const isRequireBinding = (name: string, bindingScope: Scope): boolean => {
    const variable = variableOf(name, bindingScope);

    if (name === "require" && variable === undefined) {
      return true;
    }

    const [definition] = variable?.defs ?? [];

    if (
      variable === undefined ||
      definition === undefined ||
      definition.type !== "Variable" ||
      definition.node.type !== "VariableDeclarator" ||
      definition.node.init === null ||
      !isStableVariable(variable) ||
      seen.has(definition.node)
    ) {
      return false;
    }

    seen.add(definition.node);

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

    return isRequireFunction(
      definition.node.init,
      declarationScope,
      context,
      seen
    );
  };

  const value = unwrapExpression(expression);

  if (value.type === "CallExpression") {
    const identity = importIdentity(value.callee, scope, context);

    return (
      identity?.name === "createRequire" &&
      (identity.module === "module" || identity.module === "node:module")
    );
  }

  if (value.type === "Identifier") {
    return isRequireBinding(value.name, scope);
  }

  return (
    value.type === "MemberExpression" &&
    staticPropertyName(value) === "require" &&
    value.object.type === "Identifier" &&
    value.object.name === "module" &&
    !isDeclaredLocally(value.object.name, scope)
  );
};

const moduleSourceVisitors = (
  context: RuleContext,
  report: (node: ESTree.Node, source: ESTree.Expression) => void
) => ({
  CallExpression(node: ESTree.CallExpression) {
    const [argument] = node.arguments;

    if (
      argument !== undefined &&
      argument.type !== "SpreadElement" &&
      isRequireFunction(node.callee, context.sourceCode.getScope(node), context)
    ) {
      report(node, argument);
    }
  },
  ExportAllDeclaration(node: ESTree.ExportAllDeclaration) {
    report(node, node.source);
  },
  ExportNamedDeclaration(node: ESTree.ExportNamedDeclaration) {
    if (node.source !== null) {
      report(node, node.source);
    }
  },
  ImportDeclaration(node: ESTree.ImportDeclaration) {
    report(node, node.source);
  },
  ImportExpression(node: ESTree.ImportExpression) {
    report(node, node.source);
  },
  TSImportEqualsDeclaration(node: ESTree.TSImportEqualsDeclaration) {
    if (node.moduleReference.type === "TSExternalModuleReference") {
      report(node, node.moduleReference.expression);
    }
  },
  TSImportType(node: ESTree.TSImportType) {
    report(node, node.source);
  },
});

const noCrossLayerImports = defineRule({
  create(context) {
    const filename = workspacePath(context.filename);

    const report = (node: ESTree.Node, source: ESTree.Expression) => {
      const specifier = isStringModule(source);

      if (specifier !== null) {
        importModule(context, filename, node, specifier);
      }
    };

    return moduleSourceVisitors(context, report);
  },
  meta: {
    docs: {
      description:
        "Keep package, capability, and infrastructure imports inside their owning layers.",
    },
    messages: {
      capabilityDomain:
        "packages/capability cannot import packages/core domain code.",
      infraOwner:
        "apps/infra owns its Stack wiring; import a capability or service contract instead.",
      packageApp: "Packages cannot import application code.",
    },
    type: "problem",
  },
});

const noBrowserServerImports = defineRule({
  create(context) {
    const filename = workspacePath(context.filename);

    if (!isBrowserZone(filename)) {
      return {};
    }

    const report = (node: ESTree.Node, source: ESTree.Expression) => {
      const specifier = isStringModule(source);

      if (specifier !== null) {
        if (browserServerModule(filename, specifier)) {
          context.report({ messageId: "serverImport", node });
        }

        if (browserCapabilityModule(filename, specifier)) {
          context.report({ messageId: "capabilityImport", node });
        }
      }
    };

    return moduleSourceVisitors(context, report);
  },
  meta: {
    docs: {
      description:
        "Keep Node, Alchemy, Worker, infrastructure, and server-only modules out of browser zones.",
    },
    messages: {
      capabilityImport:
        "Feature and client modules can import only browser-safe contract entry points; capability handlers and other domain implementation modules stay server-side.",
      serverImport:
        "Feature and client modules cannot import Node, Alchemy, Worker, infra, or server-only modules.",
    },
    type: "problem",
  },
});

const noFeatureTransport = defineRule({
  create(context) {
    const filename = workspacePath(context.filename);

    if (!isFeature(filename)) {
      return {};
    }

    const report = (node: ESTree.Node) => {
      context.report({ messageId: "featureTransport", node });
    };

    const isGlobalFetch = (node: ESTree.Node, scope: Scope | null) =>
      node.type === "Identifier" &&
      node.name === "fetch" &&
      !isDeclaredLocally("fetch", scope);

    return {
      CallExpression(node) {
        const scope = context.sourceCode.getScope(node);
        const callee = unwrapExpression(node.callee);
        const root = rootIdentifierNode(callee);
        const [moduleArgument] = node.arguments;

        const rootScope =
          root === null ? null : context.sourceCode.getScope(root);

        if (
          isGlobalFetch(callee, scope) ||
          isGlobalFetch(root ?? node, rootScope) ||
          transportKindForExpression(callee, scope, context) !== null ||
          (root !== null &&
            transportKindForExpression(root, rootScope, context) !== null) ||
          (moduleArgument !== undefined &&
            moduleArgument.type !== "SpreadElement" &&
            isTransportNamespace(isStringModule(moduleArgument) ?? "") &&
            isRequireFunction(node.callee, scope, context))
        ) {
          report(node);
        }
      },
      Identifier(node) {
        const scope = context.sourceCode.getScope(node);
        const { parent } = node;

        if (
          node.name !== "fetch" ||
          !isReference(node, scope) ||
          isDeclaredLocally("fetch", scope) ||
          (parent.type === "MemberExpression" &&
            (parent.object === node ||
              (parent.property === node && !parent.computed))) ||
          (parent.type === "CallExpression" && parent.callee === node)
        ) {
          return;
        }

        report(node);
      },
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          const name = importedName(specifier);

          if (name !== null && (clientNames.has(name) || name === "fetch")) {
            report(specifier);
          }

          if (
            specifier.type === "ImportNamespaceSpecifier" &&
            isTransportNamespace(node.source.value)
          ) {
            report(specifier);
          }
        }
      },
      ImportExpression(node) {
        const source = isStringModule(node.source);

        if (source !== null && isTransportNamespace(source)) {
          report(node);
        }
      },
      MemberExpression(node) {
        const property = staticPropertyName(node);
        const scope = context.sourceCode.getScope(node);

        if (
          property === "fetch" &&
          resolvesGlobalObject(node.object, scope, context)
        ) {
          report(node);

          return;
        }

        if (
          node.object.type === "Identifier" &&
          node.object.name === "fetch" &&
          !isDeclaredLocally("fetch", scope) &&
          !(
            node.parent.type === "CallExpression" && node.parent.callee === node
          )
        ) {
          report(node);
        }
      },
      NewExpression(node) {
        const scope = context.sourceCode.getScope(node);
        const root = rootIdentifierNode(node.callee);

        if (
          (node.callee.type === "Identifier" &&
            node.callee.name === "HttpClient") ||
          transportKindForExpression(node.callee, scope, context) !== null ||
          (root !== null &&
            transportKindForExpression(
              root,
              context.sourceCode.getScope(root),
              context
            ) !== null)
        ) {
          report(node);
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== "ObjectPattern" ||
          node.init === null ||
          !resolvesGlobalObject(
            node.init,
            context.sourceCode.getScope(node),
            context
          )
        ) {
          return;
        }

        for (const property of node.id.properties) {
          if (
            property.type === "Property" &&
            staticPropertyKeyName(property) === "fetch"
          ) {
            report(property.key);
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Keep feature views on their client module instead of constructing transport or making requests.",
    },
    messages: {
      featureTransport:
        "Features read atoms and call named commands from apps/web/src/client; do not use fetch or construct transport clients here.",
    },
    type: "problem",
  },
});

const surfaceConstructors = new Map<string, ReadonlySet<string>>([
  ["HttpApi", new Set(["make"])],
  [
    "HttpApiEndpoint",
    new Set([
      "del",
      "delete",
      "get",
      "head",
      "make",
      "options",
      "patch",
      "post",
      "put",
    ]),
  ],
  ["HttpApiGroup", new Set(["make"])],
  ["Rpc", new Set(["make"])],
  ["RpcGroup", new Set(["make"])],
  ["Tool", new Set(["make"])],
  ["Toolkit", new Set(["make"])],
]);

const surfaceConstructorName = (
  expression: ESTree.Expression,
  scope: Scope,
  context: RuleContext
): string | null => {
  const object = unwrapExpression(expression);

  if (object.type === "MemberExpression") {
    const name = staticPropertyName(object);

    return name !== null && surfaceConstructors.has(name) ? name : null;
  }

  if (object.type !== "Identifier") {
    return null;
  }

  const identity = importIdentity(object, scope, context);

  if (identity === null) {
    return null;
  }

  if (identity.name !== null && surfaceConstructors.has(identity.name)) {
    return identity.name;
  }

  const moduleName = identity.module.split("/").at(-1);

  return moduleName !== undefined && surfaceConstructors.has(moduleName)
    ? moduleName
    : null;
};

const surfaceCallName = (
  expression: ESTree.Expression,
  scope: Scope,
  context: RuleContext
): string | null => {
  const callee = unwrapExpression(expression);

  if (callee.type === "MemberExpression") {
    const method = staticPropertyName(callee);
    const constructor = surfaceConstructorName(callee.object, scope, context);

    return method !== null &&
      constructor !== null &&
      surfaceConstructors.get(constructor)?.has(method) === true
      ? `${constructor}.${method}`
      : null;
  }

  if (callee.type !== "Identifier") {
    return null;
  }

  const identity = importIdentity(callee, scope, context);
  const moduleName = identity?.module.split("/").at(-1);

  return identity?.name !== null &&
    identity?.name !== undefined &&
    moduleName !== undefined &&
    surfaceConstructors.get(moduleName)?.has(identity.name) === true
    ? `${moduleName}.${identity.name}`
    : null;
};

const noHandRolledSurface = defineRule({
  create(context) {
    if (isCapabilityPackage(workspacePath(context.filename))) {
      return {};
    }

    return {
      CallExpression(node) {
        let callee = unwrapExpression(node.callee);

        if (
          callee.type === "MemberExpression" &&
          ["apply", "call"].includes(staticPropertyName(callee) ?? "")
        ) {
          callee = unwrapExpression(callee.object);
        }

        const call = surfaceCallName(
          callee,
          context.sourceCode.getScope(node),
          context
        );

        if (call !== null) {
          context.report({
            data: { call },
            messageId: "handRolled",
            node,
          });
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Build RPC, HTTP, and MCP surfaces from contracts through packages/capability projections.",
    },
    messages: {
      handRolled:
        "{{call}} hand-rolls a surface. Define a contract with defineContract, implement it, and project it with toRpcGroup, toRpc, toHttpApi, or toToolkit so every surface shares one definition.",
    },
    type: "problem",
  },
});

const browserGlobals = new Set([
  "document",
  "localStorage",
  "navigator",
  "sessionStorage",
  "window",
]);

const isServerSource = (filename: string) =>
  /^(?:apps|packages)\/[^/]+\/src\/.+/u.test(filename) &&
  !isBrowserZone(filename);

const noBrowserGlobalsOnServer = defineRule({
  create(context) {
    if (!isServerSource(workspacePath(context.filename))) {
      return {};
    }

    const report = (node: ESTree.Node, name: string) => {
      context.report({
        data: { name },
        messageId: "browserGlobal",
        node,
      });
    };

    return {
      Identifier(node) {
        if (
          !browserGlobals.has(node.name) ||
          isTypePosition(node) ||
          !isReference(node, context.sourceCode.getScope(node)) ||
          isDeclaredLocally(node.name, context.sourceCode.getScope(node))
        ) {
          return;
        }

        const { parent } = node;

        if (
          (parent.type === "MemberExpression" &&
            (parent.object === node ||
              (parent.property === node && !parent.computed))) ||
          (parent.type === "Property" &&
            parent.key === node &&
            !parent.computed &&
            !parent.shorthand) ||
          (parent.type === "UnaryExpression" && parent.operator === "typeof")
        ) {
          return;
        }

        report(node, node.name);
      },
      MemberExpression(node) {
        const scope = context.sourceCode.getScope(node);

        if (
          node.object.type === "Identifier" &&
          browserGlobals.has(node.object.name) &&
          !isDeclaredLocally(node.object.name, scope)
        ) {
          report(node.object, node.object.name);

          return;
        }

        const property = staticPropertyName(node);

        if (
          property !== undefined &&
          browserGlobals.has(property) &&
          resolvesGlobalObject(node.object, scope, context)
        ) {
          report(node.property, property);
        }
      },
      VariableDeclarator(node) {
        if (
          node.id.type !== "ObjectPattern" ||
          node.init === null ||
          !resolvesGlobalObject(
            node.init,
            context.sourceCode.getScope(node),
            context
          )
        ) {
          return;
        }

        for (const property of node.id.properties) {
          if (property.type !== "Property") {
            continue;
          }

          const name = staticPropertyKeyName(property);

          if (name !== undefined && browserGlobals.has(name)) {
            report(property.key, name);
          }
        }
      },
    };
  },
  meta: {
    docs: {
      description:
        "Keep browser-only globals in apps/*/src/client and apps/*/src/features.",
    },
    messages: {
      browserGlobal:
        "{{name}} exists only in a browser. Server, Worker, and package code runs without it; move this into apps/*/src/client or apps/*/src/features.",
    },
    type: "problem",
  },
});

const isDevtoolsModule = (target: string) =>
  isWithin(target, "packages/devtools") ||
  /^packages\/auth\/(?:(?:src|dist)\/)?devtools(?:\/|\.|$)/u.test(target);

const devFolderOf = (target: string) =>
  /^(?<folder>apps\/[^/]+\/src\/dev)(?:\/|$)/u.exec(target)?.groups?.folder;

const isTestSource = (filename: string) =>
  /^(?:apps|packages)\/[^/]+\/test(?:\/|$)/u.test(filename);

const mayUseDevtools = (filename: string) =>
  isWithin(filename, "packages/devtools") ||
  isWithin(filename, "apps/cli") ||
  isTestSource(filename) ||
  devFolderOf(filename) !== undefined;

const noDevtoolsInProduction = defineRule({
  create(context) {
    const filename = workspacePath(context.filename);

    const check = (node: ESTree.Node, source: ESTree.Expression) => {
      const specifier = isStringModule(source);

      const target =
        specifier === null ? null : normalizeWorkspacePath(filename, specifier);

      if (target === null) {
        return;
      }

      if (isDevtoolsModule(target) && !mayUseDevtools(filename)) {
        context.report({ messageId: "devtools", node });
      }

      const folder = devFolderOf(target);

      if (
        folder !== undefined &&
        !isWithin(filename, folder) &&
        !isTestSource(filename)
      ) {
        context.report({ data: { folder }, messageId: "devFolder", node });
      }
    };

    return moduleSourceVisitors(context, check);
  },
  meta: {
    docs: {
      description:
        "Keep devtools and test people out of anything a production entry can reach.",
    },
    messages: {
      devFolder:
        "Only modules inside {{folder}} may import it. The dev composition is an entry of its own; production code must not reach it.",
      devtools:
        "Devtools and test people (@rat-stack/devtools, @rat-stack/auth/devtools) belong in apps/*/src/dev/**, apps/cli, or tests. rat_call and rat_test_person bypass per-request auth and create accounts with a fixed password, so a production composition must never include them.",
    },
    type: "problem",
  },
});

export default definePlugin({
  meta: { name: "rat-stack-boundaries" },
  rules: {
    "no-browser-globals-on-server": noBrowserGlobalsOnServer,
    "no-browser-server-imports": noBrowserServerImports,
    "no-cross-layer-imports": noCrossLayerImports,
    "no-devtools-in-production": noDevtoolsInProduction,
    "no-feature-transport": noFeatureTransport,
    "no-hand-rolled-surface": noHandRolledSurface,
  },
});
