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

import type { AnyCapability } from "./capability.js";
import { searchCatalog, toCatalog, toTypeScript } from "./catalog.js";
import type { Catalog } from "./catalog.js";
import { Sandbox, SandboxError } from "./sandbox.js";
import type { Invoke, InvokeOutcome } from "./sandbox.js";
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
        readonly failure: typeof SandboxError;
        readonly failureMode: "error";
      }
    >;
  }>;
  readonly layer: Layer.Layer<
    Tool.HandlersFor<CodeModeProjection<Caps>["toolkit"]["tools"]>,
    never,
    RequirementsOf<Caps> | Sandbox
  >;
}

const failure = (tag: string, message: string): InvokeOutcome => ({
  error: { _tag: tag, message },
  ok: false,
});

export const toCodeMode = <
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  capabilities: Caps,
  options?: CodeModeOptions
): CodeModeProjection<Caps> => {
  const catalog = toCatalog(capabilities);
  const declarations = toTypeScript(catalog);
  const searchLimit = options?.searchLimit ?? 5;
  const byName = new Map(
    capabilities.map((capability) => [capability.name, capability] as const)
  );

  const execute = Tool.make("execute", {
    description: executeDescription(declarations),
    failure: SandboxError,
    parameters: Schema.Struct({ code: Schema.String }),
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
      const context = yield* Effect.context<RequirementsOf<Caps>>();
      const sandbox = yield* Sandbox;

      const invoke: Invoke = (name, input) => {
        const capability = byName.get(name);
        if (capability === undefined) {
          return Effect.succeed(
            failure("UnknownCapability", `No capability named ${name}`)
          );
        }
        // `AnyCapability` erased this capability's requirements to `unknown`;
        // they are a subset of `RequirementsOf<Caps>`, which `context` carries.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const run = capability.handler as (
          input: unknown
        ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;
        const encodeOutput = Schema.encodeUnknownEffect(capability.output);
        const encodeFailure = Schema.encodeUnknownEffect(capability.failure);
        return Schema.decodeUnknownEffect(capability.input)(input).pipe(
          Effect.matchEffect({
            onFailure: (error) =>
              Effect.succeed(failure("InvalidInput", error.message)),
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
                        failure("UnencodableFailure", String(error))
                      )
                    ),
                  onSuccess: (output) =>
                    encodeOutput(output).pipe(
                      Effect.map((value): InvokeOutcome => ({
                        ok: true,
                        value,
                      })),
                      Effect.orElseSucceed(() =>
                        failure("UnencodableOutput", String(output))
                      )
                    ),
                })
              ),
          })
        );
      };

      return toolkit.of({
        execute: ({ code }) =>
          sandbox.run(code, invoke).pipe(
            Effect.map((run) => ({
              logs: run.logs,
              // The child produced this with JSON.stringify, so it is JSON.
              // oxlint-disable-next-line typescript/no-unsafe-type-assertion
              result: run.result as typeof ExecuteResult.Type.result,
            }))
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
