// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off
// See to-toolkit.ts: a projection over a heterogeneous list erases error and
// requirement types at the boundary and recovers them for callers.
//
// Projection: Capabilities -> two MCP tools, `search` and `execute`.
//
// Instead of one tool per capability, the model gets a catalog it can search
// and a sandbox in which its own program calls `tools.<name>(input)`. Every
// call still goes through the capability's schemas and handler, so the
// sandbox adds a surface, not a bypass. After Cloudflare Code Mode and Kody.
import type { Layer } from "effect";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

import { defineCapability, failureSchemaOf } from "./capability.js";
import type {
  AnyCapability,
  ApprovalRequirement,
  FailureSchemaOf,
} from "./capability.js";
import { searchCatalog, toCatalog, toTypeScript } from "./catalog.js";
import type { Catalog } from "./catalog.js";
import { Sandbox, SandboxError, invokeFailure } from "./sandbox-service.js";
import type { Invoke, InvokeOutcome } from "./sandbox-service.js";
import type { RequirementsOf } from "./to-toolkit.js";

export const SearchMatch = Schema.Struct({
  description: Schema.String,
  name: Schema.String,
  score: Schema.Finite,
  signature: Schema.String,
});

export const SearchResult = Schema.Struct({
  matches: Schema.Array(SearchMatch),
  total: Schema.Int,
});

export const ExecuteInput = Schema.Struct({
  code: Schema.String,
});

export const ExecuteResult = Schema.Struct({
  logs: Schema.Array(Schema.String),
  result: Schema.Json,
});

const search = Tool.make("search", {
  description:
    "Find capabilities by intent. Returns each match's TypeScript signature for the `tools` object available to `execute`. Call this before `execute` when unsure what exists.",
  parameters: Schema.Struct({
    limit: Schema.optional(Schema.Int),
    query: Schema.String,
  }),
  success: SearchResult,
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Idempotent, true);

const executeDescription = (declarations: string): string =>
  [
    "Run a JavaScript program against the capabilities. The program is the body of an async function with `tools` in scope; `return` a JSON value to get it back, and `console.log` is captured into `logs`. Each `tools.<name>(input)` call is validated against that capability's input schema, runs on the host, and resolves with its output or rejects with its declared failure.",
    "",
    "The `tools` object:",
    "",
    "```ts",
    declarations.trimEnd(),
    "```",
  ].join("\n");

export interface CodeModeOptions {
  readonly searchLimit?: number | undefined;
}

type NeedsApprovalOf<Caps extends readonly AnyCapability[]> =
  true extends Caps[number]["needsApproval"] ? true : false;

export interface CodeModeProjection<Caps extends readonly AnyCapability[]> {
  readonly catalog: Catalog;
  /** The `.d.ts` shown to the model and usable for editor tooling. */
  readonly declarations: string;
  readonly toolkit: Toolkit.Toolkit<{
    readonly search: typeof search;
    readonly execute: Tool.Tool<
      "execute",
      {
        readonly parameters: Schema.Struct<{ readonly code: Schema.String }>;
        readonly success: typeof ExecuteResult;
        readonly failure: FailureSchemaOf<
          typeof SandboxError,
          NeedsApprovalOf<Caps>
        >;
        readonly failureMode: "error";
      }
    >;
  }>;
  readonly layer: Layer.Layer<
    Tool.HandlersFor<CodeModeProjection<Caps>["toolkit"]["tools"]>,
    never,
    RequirementsOf<Caps> | ApprovalRequirement<NeedsApprovalOf<Caps>> | Sandbox
  >;
}

/**
 * Turns a capability tuple into one ordinary `execute` Capability. The caller
 * can project it beside its public capabilities through MCP and HTTP while the
 * default `toCodeMode` projection keeps its compact search/execute toolkit.
 */
export const toExecuteCapability = <
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  capabilities: Caps
) => {
  const catalog = toCatalog(capabilities);
  const declarations = toTypeScript(catalog);

  const byName = new Map(
    capabilities.map((capability) => [capability.name, capability] as const)
  );

  const hasApproval = capabilities.some((item) => item.needsApproval);
  // SAFETY: Caps preserves the literal approval flag for the generated
  // capability, and `some` over the same array computes exactly that flag.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const needsApproval = hasApproval as NeedsApprovalOf<Caps>;

  const capability = defineCapability("execute", {
    annotations: {
      destructive: capabilities.some((item) => item.annotations.destructive),
      openWorld: capabilities.some((item) => item.annotations.openWorld),
      readOnly: capabilities.every((item) => item.annotations.readOnly),
    },
    description: executeDescription(declarations),
    failure: SandboxError,
    handler: Effect.fn("CodeMode.execute")(function* execute({ code }) {
      const context = yield* Effect.context<
        RequirementsOf<Caps> | ApprovalRequirement<NeedsApprovalOf<Caps>>
      >();

      const sandbox = yield* Sandbox;

      const invoke: Invoke = (name, input) => {
        const item = byName.get(name);

        if (item === undefined) {
          return Effect.succeed(
            invokeFailure("UnknownCapability", `No capability named ${name}`)
          );
        }

        // SAFETY: `AnyCapability` erased this capability's requirements to
        // `unknown`; they are a subset of `RequirementsOf<Caps>`, which
        // `context` carries. The input is decoded by its schema first.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const run = item.handler as (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters
          input: unknown
        ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

        const encodeOutput = Schema.encodeUnknownEffect(item.output);
        const encodeFailure = Schema.encodeUnknownEffect(failureSchemaOf(item));

        return Schema.decodeUnknownEffect(item.input)(input).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.succeed(invokeFailure("InvalidInput", error.message)),
            onSuccess: (decoded) =>
              run(decoded).pipe(
                Effect.provideContext(context),
                Effect.matchEffect({
                  onFailure: (error) =>
                    encodeFailure(error).pipe(
                      Effect.map((encoded): InvokeOutcome => ({
                        error: encoded,
                        ok: false,
                      })),
                      Effect.orElseSucceed(() =>
                        invokeFailure("UnencodableFailure", String(error))
                      )
                    ),
                  onSuccess: (output) =>
                    encodeOutput(output).pipe(
                      Effect.map((value): InvokeOutcome => ({
                        ok: true,
                        value,
                      })),
                      Effect.orElseSucceed(() =>
                        invokeFailure("UnencodableOutput", String(output))
                      )
                    ),
                })
              ),
          })
        );
      };

      const run = yield* sandbox.run(code, invoke);

      return {
        logs: run.logs,
        // SAFETY: every Sandbox implementation must JSON-round-trip a
        // successful result before crossing this boundary.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        result: run.result as typeof ExecuteResult.Type.result,
      };
    }),
    input: ExecuteInput,
    needsApproval,
    output: ExecuteResult,
  });

  return { capability, catalog, declarations } as const;
};

export const toCodeMode = <
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  capabilities: Caps,
  options?: CodeModeOptions
): CodeModeProjection<Caps> => {
  const executeProjection = toExecuteCapability(capabilities);
  const { catalog, declarations } = executeProjection;
  const searchLimit = options?.searchLimit ?? 5;

  const execute = Tool.make("execute", {
    description: executeProjection.capability.description,
    failure: failureSchemaOf(executeProjection.capability),
    needsApproval: executeProjection.capability.needsApproval,
    parameters: ExecuteInput,
    success: ExecuteResult,
  })
    .annotate(
      Tool.Readonly,
      capabilities.every((capability) => capability.annotations.readOnly)
    )
    .annotate(
      Tool.Destructive,
      capabilities.some((capability) => capability.annotations.destructive)
    )
    .annotate(
      Tool.OpenWorld,
      capabilities.some((capability) => capability.annotations.openWorld)
    );

  const toolkit = Toolkit.make(search, execute);

  const layer = toolkit.toLayer(
    Effect.gen(function* buildCodeModeHandlers() {
      const context = yield* Effect.context<
        RequirementsOf<Caps> | ApprovalRequirement<NeedsApprovalOf<Caps>>
      >();

      const sandbox = yield* Sandbox;

      return toolkit.of({
        execute: (input) =>
          executeProjection.capability
            .handler(input)
            .pipe(
              Effect.provideService(Sandbox, sandbox),
              Effect.provideContext(context)
            ),
        search: ({ limit, query }) => {
          const matches = searchCatalog(catalog, query, limit ?? searchLimit);

          return Effect.succeed({
            matches,
            total: catalog.capabilities.length,
          });
        },
      });
    })
  );

  return { catalog, declarations, layer, toolkit };
};
