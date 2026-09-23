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
      isWithin(target, "packages/devtools") ||
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

const noHandRolledSurface = defineRule({
  create(context) {
    if (isCapabilityPackage(workspacePath(context.filename))) {
      return {};
    }

    return {
      CallExpression(node) {
        const { callee } = node;

        if (
          callee.type !== "MemberExpression" ||
          callee.object.type !== "Identifier" ||
          callee.property.type !== "Identifier"
        ) {
          return;
        }

        const methods = surfaceConstructors.get(callee.object.name);

        if (methods?.has(callee.property.name) === true) {
          context.report({
            data: { call: `${callee.object.name}.${callee.property.name}` },
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

    return {
      MemberExpression(node) {
        if (
          node.object.type === "Identifier" &&
          browserGlobals.has(node.object.name)
        ) {
          context.report({
            data: { name: node.object.name },
            messageId: "browserGlobal",
            node: node.object,
          });
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
  /^packages\/auth\/(?:src\/)?devtools(?:\.[jt]s)?$/u.test(target);

const devFolderOf = (target: string) =>
  /^(?<folder>apps\/[^/]+\/src\/dev)(?:\/|$)/u.exec(target)?.groups?.folder;

const mayUseDevtools = (filename: string) =>
  isWithin(filename, "packages/devtools") ||
  isWithin(filename, "packages/auth") ||
  isWithin(filename, "apps/cli") ||
  /(?:^|\/)test\//u.test(filename) ||
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
        !/(?:^|\/)test\//u.test(filename)
      ) {
        context.report({ data: { folder }, messageId: "devFolder", node });
      }
    };

    return {
      ExportAllDeclaration(node) {
        check(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source !== null) {
          check(node, node.source);
        }
      },
      ImportDeclaration(node) {
        check(node, node.source);
      },
      ImportExpression(node) {
        check(node, node.source);
      },
    };
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
