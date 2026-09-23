// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off
// A projection over a heterogeneous list of capabilities erases each one's
// error and requirement types at the boundary and recovers them for callers
// through `ToolsOf` / `RequirementsOf`. The three diagnostics above cannot
// distinguish that boundary from a leak, so they are off for this file only.
// Projection: Capabilities -> effect/unstable/ai Toolkit (the MCP surface).
//
// Each capability becomes one Tool with the same name, schemas, and
// annotations. The handlers layer captures the capabilities' requirements once
// at layer build time, so the Toolkit's own handler requirements stay `never`
// and `McpServer.toolkit(toolkit)` composes with the same layers the CLI uses.
import type { Layer } from "effect";
import { Effect } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

import { failureSchemaOf } from "./capability.js";
import type {
  AnyCapability,
  FailureOf,
  InputOf,
  InputSchema,
  NameOf,
  OutputOf,
  PlainSchema,
  RequirementsOf as CapabilityRequirementsOf,
} from "./capability.js";

const toolFor = <
  Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
>(
  name: Name,
  description: string,
  input: Input,
  output: Output,
  failure: Failure,
  needsApproval: boolean
) =>
  Tool.make(name, {
    description,
    failure,
    needsApproval,
    parameters: input,
    success: output,
  });

export type ToolOf<C> = ReturnType<
  typeof toolFor<NameOf<C>, InputOf<C>, OutputOf<C>, FailureOf<C>>
>;

export type ToolsOf<Caps extends readonly AnyCapability[]> = {
  readonly [C in Caps[number] as NameOf<C>]: ToolOf<C>;
};

export type RequirementsOf<Caps extends readonly AnyCapability[]> =
  CapabilityRequirementsOf<Caps[number]>;

export interface ToolkitProjection<Caps extends readonly AnyCapability[]> {
  readonly toolkit: Toolkit.Toolkit<ToolsOf<Caps>>;
  /** Handlers for every tool; requires whatever the capabilities require. */
  readonly layer: Layer.Layer<
    Tool.HandlersFor<ToolsOf<Caps>>,
    never,
    RequirementsOf<Caps>
  >;
}

const toTool = (capability: AnyCapability) =>
  toolFor(
    capability.name,
    capability.description,
    capability.input,
    capability.output,
    failureSchemaOf(capability),
    capability.needsApproval
  )
    .annotate(Tool.Readonly, capability.annotations.readOnly)
    .annotate(Tool.Destructive, capability.annotations.destructive)
    .annotate(Tool.Idempotent, capability.annotations.idempotent)
    .annotate(Tool.OpenWorld, capability.annotations.openWorld);

export const toToolkit = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
): ToolkitProjection<Caps> => {
  const made: unknown = Toolkit.make(...capabilities.map(toTool));
  // SAFETY: `Toolkit.make` is variadic over a tuple of tools; the tuple type
  // is recovered by `ToolsOf<Caps>`, which `map` over the runtime array
  // cannot carry. One cast at this boundary keeps every caller fully typed.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const toolkit = made as Toolkit.Toolkit<ToolsOf<Caps>>;

  const layer = toolkit.toLayer(
    Effect.gen(function* buildHandlers() {
      const context = yield* Effect.context<RequirementsOf<Caps>>();

      const handlers: Record<
        string,
        // The toolkit decodes each tool's parameters before calling; this
        // record erases them because a loop cannot name each capability.
        // oxlint-disable-next-line anti-slop/no-unknown-parameters
        (parameters: unknown) => Effect.Effect<unknown, unknown>
      > = {};

      for (const capability of capabilities) {
        // SAFETY: `Any` erased this capability's requirements to `unknown`;
        // they are a subset of `RequirementsOf<Caps>`, which `context` carries.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const run = capability.handler as (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters
          input: unknown
        ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

        handlers[capability.name] = (parameters) =>
          run(parameters).pipe(Effect.provideContext(context));
      }

      // SAFETY: same boundary as the toolkit cast: the record is keyed by the
      // capabilities' names, which is exactly `HandlersFrom<ToolsOf<Caps>>`.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
      return handlers as unknown as Toolkit.HandlersFrom<ToolsOf<Caps>>;
    })
  );

  return { layer, toolkit };
};
