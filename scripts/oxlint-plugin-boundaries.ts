import { existsSync } from "node:fs";
import path from "node:path";

import { definePlugin, defineRule } from "@oxlint/plugins";
import type { ESTree } from "@oxlint/plugins";

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

const browserContractModules = new Set([
  "packages/capability/rpc-group",
  "packages/core/contracts",
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
  /^apps\/[^/]+\/src\/features\/.+/u.test(filename);

const isBrowserZone = (filename: string) =>
  isFeature(filename) || /^apps\/[^/]+\/src\/client\/.+/u.test(filename);

const isStringModule = (node: ESTree.Expression): string | null => {
  // oxlint-disable-next-line anti-slop/no-runtime-typeof -- ESTree Literal also represents numbers and booleans, so module sources need a string boundary check.
  if (node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }

  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    const value = node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw;

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
  context: Parameters<Parameters<typeof defineRule>[0]["create"]>[0],
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
      /^apps\/[^/]+\/src\/capabilities(?:\/|$)/u.test(target))
  );
};

const browserServerModule = (filename: string, specifier: string) => {
  const normalized = specifier.toLowerCase();
  const target = normalizeWorkspacePath(filename, specifier);

  return (
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

const memberName = (node: ESTree.Node): string | null => {
  if (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier"
  ) {
    return node.property.name;
  }

  return null;
};

const rootIdentifier = (node: ESTree.Node): string | null => {
  let current = node;

  while (current.type === "MemberExpression") {
    current = current.object;
  }

  if (current.type === "Identifier") {
    return current.name;
  }

  return null;
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

const noCrossLayerImports = defineRule({
  create(context) {
    const filename = workspacePath(context.filename);

    const report = (node: ESTree.Node, source: ESTree.Expression) => {
      const specifier = isStringModule(source);

      if (specifier !== null) {
        importModule(context, filename, node, specifier);
      }
    };

    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require"
        ) {
          const [argument] = node.arguments;

          if (argument !== undefined && argument.type !== "SpreadElement") {
            report(node, argument);
          }
        }
      },
      ExportAllDeclaration(node) {
        report(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) {
          report(node, node.source);
        }
      },
      ImportDeclaration(node) {
        report(node, node.source);
      },
      ImportExpression(node) {
        report(node, node.source);
      },
      TSImportType(node) {
        report(node, node.source);
      },
    };
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

    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "require"
        ) {
          const [argument] = node.arguments;

          if (argument !== undefined && argument.type !== "SpreadElement") {
            report(node, argument);
          }
        }
      },
      ExportAllDeclaration(node) {
        report(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) {
          report(node, node.source);
        }
      },
      ImportDeclaration(node) {
        report(node, node.source);
      },
      ImportExpression(node) {
        report(node, node.source);
      },
      TSImportType(node) {
        report(node, node.source);
      },
    };
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

    const directClients = new Set(clientNames);

    const report = (node: ESTree.Node) => {
      context.report({ messageId: "featureTransport", node });
    };

    return {
      CallExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          (node.callee.name === "fetch" ||
            clientFactories.has(node.callee.name))
        ) {
          report(node);

          return;
        }

        const root = rootIdentifier(node.callee);

        if (root !== null && directClients.has(root)) {
          report(node);
        }
      },
      ImportDeclaration(node) {
        for (const specifier of node.specifiers) {
          const name = importedName(specifier);

          if (name !== null && (clientNames.has(name) || name === "fetch")) {
            if (clientNames.has(name)) {
              directClients.add(specifier.local.name);
            }

            report(specifier);
          }

          if (
            specifier.type === "ImportNamespaceSpecifier" &&
            /(?:^|\/)(?:atomrpc|fetchhttpclient|http|httpclient|rpc)$/iu.test(
              node.source.value
            )
          ) {
            directClients.add(specifier.local.name);
            report(specifier);
          }
        }
      },
      MemberExpression(node) {
        if (
          memberName(node) === "fetch" &&
          node.object.type === "Identifier" &&
          new Set(["globalThis", "self", "window"]).has(node.object.name)
        ) {
          report(node);
        }
      },
      NewExpression(node) {
        if (
          node.callee.type === "Identifier" &&
          directClients.has(node.callee.name)
        ) {
          report(node);
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

export default definePlugin({
  meta: { name: "rat-stack-boundaries" },
  rules: {
    "no-browser-server-imports": noBrowserServerImports,
    "no-cross-layer-imports": noCrossLayerImports,
    "no-feature-transport": noFeatureTransport,
  },
});
