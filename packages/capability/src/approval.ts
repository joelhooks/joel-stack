import { Context, Effect, Layer } from "effect";

import { ApprovalDenied } from "./approval-denied.js";

export { ApprovalDenied } from "./approval-denied.js";

export interface ApprovalService {
  readonly approve: (
    capabilityName: string,
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Every capability's decoded input passes through one gate, so its type is erased here; an implementation that shows it to a human encodes it.
    input: unknown
  ) => Effect.Effect<void, ApprovalDenied>;
}

export class Approval extends Context.Service<Approval, ApprovalService>()(
  "@rat-stack/capability/Approval"
) {
  static readonly denyAll = Layer.succeed(
    Approval,
    Approval.of({
      approve: (capabilityName) =>
        Effect.fail(
          new ApprovalDenied({
            capabilityName,
            reason: "Approval is required",
          })
        ),
    })
  );

  static readonly allowAll = Layer.succeed(
    Approval,
    Approval.of({
      approve: () => Effect.void,
    })
  );
}
