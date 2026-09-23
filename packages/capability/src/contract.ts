import { Data, Schema } from "effect";
import type { Effect } from "effect";

import { ApprovalDenied } from "./approval-denied.js";
import type { Approval } from "./approval.js";

export interface Annotations {
  readonly readOnly: boolean;
  readonly destructive: boolean;
  readonly idempotent: boolean;
  readonly openWorld: boolean;
}

export type PlainSchema = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export type InputSchema = Schema.Struct<Record<string, PlainSchema>>;

export type ApprovalRequirement<NeedsApproval extends boolean> =
  NeedsApproval extends false ? never : Approval;

export type FailureSchemaOf<
  Failure extends PlainSchema,
  NeedsApproval extends boolean,
> = NeedsApproval extends false
  ? Failure
  : Schema.Union<readonly [Failure, typeof ApprovalDenied]>;

export interface Contract<
  Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  NeedsApproval extends boolean = false,
> {
  readonly _tag: "Contract";
  readonly name: Name;
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  readonly failure: Failure;
  readonly annotations: Annotations;
  readonly needsApproval: NeedsApproval;
}

export type AnyContract = Contract<
  string,
  InputSchema,
  PlainSchema,
  PlainSchema,
  boolean
>;

export interface Capability<
  ContractType extends AnyContract,
  Requirements = never,
> {
  readonly _tag: "Capability";
  readonly contract: ContractType;
  readonly handler: (
    input: ContractType["input"]["Type"]
  ) => Effect.Effect<
    ContractType["output"]["Type"],
    FailureOf<ContractType>["Type"],
    Requirements | ApprovalRequirement<ContractType["needsApproval"]>
  >;
}

export interface AnyCapability {
  readonly _tag: "Capability";
  readonly contract: AnyContract;
  readonly handler: (input: never) => Effect.Effect<unknown, unknown, unknown>;
}

export type ContractOf<Value> = Value extends {
  readonly contract: infer ContractType;
}
  ? ContractType
  : Value extends { readonly _tag: "Contract" }
    ? Value
    : never;

export type NameOf<Value> =
  ContractOf<Value> extends {
    readonly name: infer Name extends string;
  }
    ? Name
    : never;

export type InputOf<Value> =
  ContractOf<Value> extends {
    readonly input: infer Input extends InputSchema;
  }
    ? Input
    : never;

export type OutputOf<Value> =
  ContractOf<Value> extends {
    readonly output: infer Output extends PlainSchema;
  }
    ? Output
    : never;

export type ContractFailureOf<Value> =
  ContractOf<Value> extends {
    readonly failure: infer Failure extends PlainSchema;
  }
    ? Failure
    : never;

export type FailureOf<Value> =
  ContractOf<Value> extends {
    readonly failure: infer Failure extends PlainSchema;
    readonly needsApproval: infer NeedsApproval extends boolean;
  }
    ? FailureSchemaOf<Failure, NeedsApproval>
    : never;

export type RequirementsOf<Value> = Value extends readonly AnyCapability[]
  ? CapabilityRequirementsOf<Value[number]>
  : CapabilityRequirementsOf<Value>;

type CapabilityRequirementsOf<Value> =
  Value extends Capability<infer ContractType, infer Requirements>
    ? Requirements | ApprovalRequirement<ContractType["needsApproval"]>
    : never;

export interface DefineContractOptions<
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  NeedsApproval extends boolean = false,
> {
  readonly description: string;
  readonly input: Input;
  readonly output: Output;
  readonly failure: Failure;
  readonly annotations?: Partial<Annotations> | undefined;
  readonly needsApproval?: NeedsApproval | undefined;
}

const defaultAnnotations: Annotations = {
  destructive: false,
  idempotent: false,
  openWorld: false,
  readOnly: false,
};

class ContractRecord extends Data.TaggedClass("Contract")<
  Omit<AnyContract, "_tag">
> {}

export function defineContract<
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure>
): Contract<Name, Input, Output, Failure>;
export function defineContract<
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure, true> & {
    readonly needsApproval: true;
  }
): Contract<Name, Input, Output, Failure, true>;
export function defineContract<
  const Name extends string,
  Input extends InputSchema,
  Output extends PlainSchema,
  Failure extends PlainSchema,
  const NeedsApproval extends boolean,
>(
  name: Name,
  options: DefineContractOptions<Input, Output, Failure, NeedsApproval>
): Contract<Name, Input, Output, Failure, NeedsApproval>;
export function defineContract(
  name: string,
  options: DefineContractOptions<InputSchema, PlainSchema, PlainSchema, boolean>
): AnyContract {
  return new ContractRecord({
    annotations: { ...defaultAnnotations, ...options.annotations },
    description: options.description,
    failure: options.failure,
    input: options.input,
    name,
    needsApproval: options.needsApproval ?? false,
    output: options.output,
  });
}

export const failureSchemaOf = <
  Failure extends PlainSchema,
  const NeedsApproval extends boolean,
>(contract: {
  readonly failure: Failure;
  readonly needsApproval: NeedsApproval;
}): FailureSchemaOf<Failure, NeedsApproval> => {
  const schema = contract.needsApproval
    ? Schema.Union([contract.failure, ApprovalDenied])
    : contract.failure;

  // SAFETY: the runtime branch preserves the exact schema members represented by the literal `NeedsApproval` type supplied by the contract.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return schema as FailureSchemaOf<Failure, NeedsApproval>;
};
