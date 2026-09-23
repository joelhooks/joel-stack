// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- A projection over a heterogeneous list of capabilities erases each one's error and requirement types at the boundary and recovers them for callers through `ToolsOf` / `RequirementsOf`. The three diagnostics above cannot distinguish that boundary from a leak, so they are off for this file only.
import type { Layer } from "effect";
import { Effect } from "effect";
import { Tool, Toolkit } from "effect/unstable/ai";

import { failureSchemaOf } from "./contract.js";
import type {
  AnyCapability,
  FailureOf,
  InputOf,
  InputSchema,
  NameOf,
  OutputOf,
  PlainSchema,
  RequirementsOf as CapabilityRequirementsOf,
} from "./contract.js";

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
  readonly layer: Layer.Layer<
    Tool.HandlersFor<ToolsOf<Caps>>,
    never,
    RequirementsOf<Caps>
  >;
}

const toTool = ({ contract }: AnyCapability) =>
  toolFor(
    contract.name,
    contract.description,
    contract.input,
    contract.output,
    failureSchemaOf(contract),
    contract.needsApproval
  )
    .annotate(Tool.Readonly, contract.annotations.readOnly)
    .annotate(Tool.Destructive, contract.annotations.destructive)
    .annotate(Tool.Idempotent, contract.annotations.idempotent)
    .annotate(Tool.OpenWorld, contract.annotations.openWorld);

export const toToolkit = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
): ToolkitProjection<Caps> => {
  const made: unknown = Toolkit.make(...capabilities.map(toTool));
  // SAFETY: `Toolkit.make` is variadic over a tuple of tools; the tuple type is recovered by `ToolsOf<Caps>`, which `map` over the runtime array cannot carry. One cast at this boundary keeps every caller fully typed.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const toolkit = made as Toolkit.Toolkit<ToolsOf<Caps>>;

  const layer = toolkit.toLayer(
    Effect.gen(function* buildHandlers() {
      const context = yield* Effect.context<RequirementsOf<Caps>>();

      const handlers: Record<
        string,
        // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The toolkit decodes each tool's parameters before calling; this record erases them because a loop cannot name each capability.
        (parameters: unknown) => Effect.Effect<unknown, unknown>
      > = {};

      for (const capability of capabilities) {
        // SAFETY: `Any` erased this capability's requirements to `unknown`; they are a subset of `RequirementsOf<Caps>`, which `context` carries.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const run = capability.handler as (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters
          input: unknown
        ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

        handlers[capability.contract.name] = (parameters) =>
          run(parameters).pipe(Effect.provideContext(context));
      }

      // SAFETY: same boundary as the toolkit cast: the record is keyed by the capabilities' names, which is exactly `HandlersFrom<ToolsOf<Caps>>`.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
      return handlers as unknown as Toolkit.HandlersFrom<ToolsOf<Caps>>;
    })
  );

  return { layer, toolkit };
};
