// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- This projection erases each capability's schema and requirement types while building the heterogeneous RpcGroup and recovers them at its public boundary.
import type { Layer } from "effect";
import { Effect } from "effect";
import { Rpc, RpcGroup } from "effect/unstable/rpc";

import { failureSchemaOf } from "./capability.js";
import type {
  AnyCapability,
  FailureOf,
  InputOf,
  NameOf,
  OutputOf,
} from "./capability.js";
import type { RequirementsOf } from "./to-toolkit.js";

export type RpcOf<C> = ReturnType<
  typeof Rpc.make<NameOf<C>, InputOf<C>, OutputOf<C>, FailureOf<C>>
>;

export type RpcsOf<Caps extends readonly AnyCapability[]> = {
  readonly [K in keyof Caps]: RpcOf<Caps[K]>;
};

export interface RpcProjection<Caps extends readonly AnyCapability[]> {
  readonly group: RpcGroup.RpcGroup<RpcsOf<Caps>[number]>;
  readonly layer: Layer.Layer<
    Rpc.ToHandler<RpcsOf<Caps>[number]>,
    never,
    RequirementsOf<Caps>
  >;
}

const rpcFor = (capability: AnyCapability) =>
  Rpc.make(capability.name, {
    error: failureSchemaOf(capability),
    payload: capability.input,
    success: capability.output,
  });

export const toRpc = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
): RpcProjection<Caps> => {
  const rpcGroup: unknown = RpcGroup.make(...capabilities.map(rpcFor));
  // SAFETY: each runtime RPC is built from the matching capability's name and schemas, which is exactly the mapped tuple represented by RpcsOf<Caps>.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const group = rpcGroup as RpcGroup.RpcGroup<RpcsOf<Caps>[number]>;

  const built = group.toLayer(
    Effect.gen(function* buildHandlers() {
      const context = yield* Effect.context<RequirementsOf<Caps>>();

      const handlers: Record<
        string,
        (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- RpcGroup invokes this only after decoding the RPC payload schema.
          payload: unknown
        ) => Effect.Effect<unknown, unknown>
      > = {};

      for (const capability of capabilities) {
        // SAFETY: the server decodes this RPC's payload schema before dispatch, and the capability's requirements are included in RequirementsOf<Caps>.
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion
        const run = capability.handler as (
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- RpcGroup invokes this only after decoding the RPC payload schema.
          input: unknown
        ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

        handlers[capability.name] = (payload) =>
          run(payload).pipe(Effect.provideContext(context));
      }

      // SAFETY: the loop uses each capability's exact name and its handler dispatches through that capability's schema-backed RPC definition.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This heterogeneous projection recovers the mapped handlers after the runtime name-indexed loop.
      return handlers as unknown as RpcGroup.HandlersFrom<RpcsOf<Caps>[number]>;
    })
  );

  // SAFETY: the group contains exactly the RPCs derived from Caps, and the handlers capture but do not provide its requirements.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const layer = built as RpcProjection<Caps>["layer"];

  return { group, layer };
};
