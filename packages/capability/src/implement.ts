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
