// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- This projection erases each capability's schema and requirement types while building the heterogeneous RpcGroup and recovers them at its public boundary.
import type { Layer } from "effect";
import { Effect } from "effect";
import type * as Rpc from "effect/unstable/rpc/Rpc";
import type * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import type { AnyCapability, ContractOf, RequirementsOf } from "./contract.js";
import { toRpcGroup } from "./to-rpc-group.js";
import type { RpcsOf } from "./to-rpc-group.js";

export type ContractsOf<Caps extends readonly AnyCapability[]> = {
  readonly [K in keyof Caps]: ContractOf<Caps[K]>;
};

export interface RpcProjection<Caps extends readonly AnyCapability[]> {
  readonly group: RpcGroup.RpcGroup<RpcsOf<ContractsOf<Caps>>[number]>;
  readonly layer: Layer.Layer<
    Rpc.ToHandler<RpcsOf<ContractsOf<Caps>>[number]>,
    never,
    RequirementsOf<Caps>
  >;
}

export const toRpc = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
): RpcProjection<Caps> => {
  const contracts = capabilities.map((capability) => capability.contract);
  // SAFETY: mapping preserves the capability order and each implementation exposes its exact contract.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const contractTuple = contracts as ContractsOf<Caps>;
  const { group } = toRpcGroup(contractTuple);

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

        handlers[capability.contract.name] = (payload) =>
          run(payload).pipe(Effect.provideContext(context));
      }

      // SAFETY: the loop uses each capability contract's exact name, and its handler dispatches through that contract's schema-backed RPC definition.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- This heterogeneous projection recovers the mapped handlers after the runtime name-indexed loop.
      return handlers as unknown as RpcGroup.HandlersFrom<
        RpcsOf<ContractsOf<Caps>>[number]
      >;
    })
  );

  // SAFETY: the group contains exactly the RPCs derived from the capability contracts, and the handlers capture but do not provide their requirements.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const layer = built as RpcProjection<Caps>["layer"];

  return { group, layer };
};
