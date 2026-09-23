import * as Rpc from "effect/unstable/rpc/Rpc";
import * as RpcGroup from "effect/unstable/rpc/RpcGroup";

import { failureSchemaOf } from "./contract.js";
import type {
  AnyContract,
  FailureOf,
  InputOf,
  NameOf,
  OutputOf,
} from "./contract.js";

export type RpcOf<Value> = ReturnType<
  typeof Rpc.make<
    NameOf<Value>,
    InputOf<Value>,
    OutputOf<Value>,
    FailureOf<Value>
  >
>;

export type RpcsOf<Values extends readonly unknown[]> = {
  readonly [K in keyof Values]: RpcOf<Values[K]>;
};

export interface RpcGroupProjection<Contracts extends readonly AnyContract[]> {
  readonly group: RpcGroup.RpcGroup<RpcsOf<Contracts>[number]>;
}

const rpcFor = (contract: AnyContract) =>
  Rpc.make(contract.name, {
    error: failureSchemaOf(contract),
    payload: contract.input,
    success: contract.output,
  });

export const toRpcGroup = <const Contracts extends readonly AnyContract[]>(
  contracts: Contracts
): RpcGroupProjection<Contracts> => {
  const rpcGroup: unknown = RpcGroup.make(...contracts.map(rpcFor));

  // SAFETY: each RPC is built from the matching contract's name and schemas, which is exactly the mapped tuple represented by RpcsOf<Contracts>.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const group = rpcGroup as RpcGroup.RpcGroup<RpcsOf<Contracts>[number]>;

  return { group };
};
