// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- See to-toolkit.ts: a projection over a heterogeneous list erases error and requirement types at the boundary and recovers them for callers.
import type { Layer } from "effect";
import { Effect, Schema } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

import { searchCatalog, toCatalog, toTypeScript } from "./catalog.js";
import type { Catalog } from "./catalog.js";
import { defineContract, failureSchemaOf } from "./contract.js";
import type {
  AnyCapability,
  ApprovalRequirement,
  ContractOf,
  FailureSchemaOf,
} from "./contract.js";
import { implement } from "./implement.js";
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

const executeIntro =
  "Run a JavaScript program against the capabilities. The program is the body of an async function with `tools` in scope; `return` a JSON value to get it back, and `console.log` is captured into `logs`. Each `tools.<name>(input)` call is validated against that capability's input schema, runs on the host, and resolves with its output or rejects with its declared failure.";

const executeDescription = (
  declarations: string,
  placement: DeclarationPlacement
): string =>
  placement === "search"
    ? [
        executeIntro,
        "",
        "Call `search` first to get the TypeScript signature of each capability on the `tools` object.",
      ].join("\n")
    : [
        executeIntro,
        "",
        "The `tools` object:",
        "",
        "```ts",
        declarations.trimEnd(),
        "```",
      ].join("\n");

export type DeclarationPlacement = "inline" | "search";

export interface ExecuteOptions {
  readonly declarations?: DeclarationPlacement | undefined;
}

export interface CodeModeOptions extends ExecuteOptions {
  readonly searchLimit?: number | undefined;
}

type NeedsApprovalOf<Caps extends readonly AnyCapability[]> =
  true extends ContractOf<Caps[number]>["needsApproval"] ? true : false;

export interface CodeModeProjection<Caps extends readonly AnyCapability[]> {
  readonly catalog: Catalog;
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

export const invokerFor = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
): Effect.Effect<Invoke, never, RequirementsOf<Caps>> =>
  Effect.gen(function* buildInvoker() {
    const context = yield* Effect.context<RequirementsOf<Caps>>();

    const byName = new Map(
      capabilities.map(
        (capability) => [capability.contract.name, capability] as const
      )
    );

    const invoke: Invoke = (name, input) => {
      const item = byName.get(name);

      if (item === undefined) {
        return Effect.succeed(
          invokeFailure("UnknownCapability", `No capability named ${name}`)
        );
      }

      // SAFETY: `AnyCapability` erased this capability's requirements to `unknown`; they are a subset of `RequirementsOf<Caps>`, which `context` carries. The input is decoded by its schema first.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      const run = item.handler as (
        // oxlint-disable-next-line anti-slop/no-unknown-parameters
        input: unknown
      ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

      const encodeOutput = Schema.encodeUnknownEffect(item.contract.output);

      const encodeFailure = Schema.encodeUnknownEffect(
        failureSchemaOf(item.contract)
      );

      return Schema.decodeUnknownEffect(item.contract.input)(input).pipe(
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

    return invoke;
  });

export const toExecuteCapability = <
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  capabilities: Caps,
  options?: ExecuteOptions
) => {
  const catalog = toCatalog(capabilities);
  const declarations = toTypeScript(catalog);

  const hasApproval = capabilities.some((item) => item.contract.needsApproval);
  // SAFETY: Caps preserves the literal approval flag for the generated capability, and `some` over the same array computes exactly that flag.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const needsApproval = hasApproval as NeedsApprovalOf<Caps>;

  const executeContract = defineContract("execute", {
    annotations: {
      destructive: capabilities.some(
        (item) => item.contract.annotations.destructive
      ),
      openWorld: capabilities.some(
        (item) => item.contract.annotations.openWorld
      ),
      readOnly: capabilities.every(
        (item) => item.contract.annotations.readOnly
      ),
    },
    description: executeDescription(
      declarations,
      options?.declarations ?? "inline"
    ),
    failure: SandboxError,
    input: ExecuteInput,
    needsApproval,
    output: ExecuteResult,
  });

  const capability = implement(
    executeContract,
    Effect.fn("CodeMode.execute")(function* execute({ code }) {
      const invoke = yield* invokerFor(capabilities);

      const sandbox = yield* Sandbox;

      const run = yield* sandbox.run(code, invoke);

      return {
        logs: run.logs,
        // SAFETY: every Sandbox implementation must JSON-round-trip a successful result before crossing this boundary.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        result: run.result as typeof ExecuteResult.Type.result,
      };
    })
  );

  return { capability, catalog, declarations } as const;
};

export const toCodeMode = <
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  capabilities: Caps,
  options?: CodeModeOptions
): CodeModeProjection<Caps> => {
  const executeProjection = toExecuteCapability(capabilities, options);
  const { catalog, declarations } = executeProjection;
  const searchLimit = options?.searchLimit ?? 5;

  const execute = Tool.make("execute", {
    description: executeProjection.capability.contract.description,
    failure: failureSchemaOf(executeProjection.capability.contract),
    needsApproval: executeProjection.capability.contract.needsApproval,
    parameters: ExecuteInput,
    success: ExecuteResult,
  })
    .annotate(
      Tool.Readonly,
      capabilities.every(
        (capability) => capability.contract.annotations.readOnly
      )
    )
    .annotate(
      Tool.Destructive,
      capabilities.some(
        (capability) => capability.contract.annotations.destructive
      )
    )
    .annotate(
      Tool.OpenWorld,
      capabilities.some(
        (capability) => capability.contract.annotations.openWorld
      )
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
