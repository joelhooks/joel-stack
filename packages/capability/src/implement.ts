import { Data, Effect } from "effect";

import { Approval } from "./approval.js";
import type {
  AnyCapability,
  AnyContract,
  Capability,
  InputOf,
  OutputOf,
  ContractFailureOf,
} from "./contract.js";

class CapabilityRecord extends Data.TaggedClass("Capability")<
  Omit<AnyCapability, "_tag">
> {}

export const implement = <
  ContractType extends AnyContract,
  Requirements = never,
>(
  contract: ContractType,
  handler: (
    input: InputOf<ContractType>["Type"]
  ) => Effect.Effect<
    OutputOf<ContractType>["Type"],
    ContractFailureOf<ContractType>["Type"],
    Requirements
  >
): Capability<ContractType, Requirements> => {
  const implementationHandler = (input: never) =>
    contract.needsApproval
      ? Effect.gen(function* approvedHandler() {
          const approval = yield* Approval;
          yield* approval.approve(contract.name, input);

          return yield* handler(input);
        })
      : handler(input);

  const capability = new CapabilityRecord({
    contract,
    handler: implementationHandler,
  });

  // SAFETY: the runtime branch uses the same literal approval flag stored on the contract type and adds only the corresponding Approval requirement and ApprovalDenied failure.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- The heterogeneous record erases its handler channels until the public generic type is restored.
  return capability as unknown as Capability<ContractType, Requirements>;
};

export type Around = <A, E, R>(
  contract: AnyContract,
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- The handler's decoded input, erased across a heterogeneous list; a wrapper re-encodes it through `contract.input`.
  input: unknown,
  run: Effect.Effect<A, E, R>
) => Effect.Effect<A, E, R>;

export const aroundHandlers = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps,
  around: Around
): Caps => {
  const wrapped = capabilities.map(
    ({ contract, handler }) =>
      new CapabilityRecord({
        contract,
        handler: (input: never) =>
          // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- The erased handler of a heterogeneous list; `Around` preserves whatever channels it has.
          around(contract, input, handler(input)),
      })
  );

  // SAFETY: each element keeps its contract, and `Around` is parametric in the success, failure, and requirement channels, so every handler keeps its exact type.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions -- The mapped runtime array cannot carry the tuple type of `Caps`.
  return wrapped as unknown as Caps;
};
