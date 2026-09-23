import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { ActorNotFound } from "./actor-not-found.js";
import { OutcomeSchema } from "./call-log.js";
import { CallNotFound } from "./call-not-found.js";
import { ChangeSchema, PathNotFound } from "./json.js";
import { UnknownCapability } from "./unknown-capability.js";

export { ActorNotFound } from "./actor-not-found.js";

export { CallNotFound } from "./call-not-found.js";

export { PathNotFound } from "./json.js";

export { UnknownCapability } from "./unknown-capability.js";

const readOnly = { idempotent: true, readOnly: true } as const;

const ContractSummary = Schema.Struct({
  annotations: Schema.Struct({
    destructive: Schema.Boolean,
    idempotent: Schema.Boolean,
    openWorld: Schema.Boolean,
    readOnly: Schema.Boolean,
  }),
  description: Schema.String,
  name: Schema.String,
  needsApproval: Schema.Boolean,
});

export const InvokeResultSchema = Schema.Union([
  Schema.Struct({ ok: Schema.Literal(true), value: Schema.Json }),
  Schema.Struct({ error: Schema.Json, ok: Schema.Literal(false) }),
]);

export type InvokeResult = typeof InvokeResultSchema.Type;

const HistoryBounds = {
  firstIndex: Schema.Int.annotate({
    description: "Oldest index still retained; older entries were evicted.",
  }),
  nextIndex: Schema.Int.annotate({
    description: "Index the next recorded entry will get.",
  }),
};

const Index = Schema.Int.annotate({
  description: "Absolute call index, as returned by rat_list_calls.",
});

const PathField = Schema.optional(
  Schema.String.annotate({
    description:
      "Dot path anchored at 'root', e.g. 'root.input', 'root.outcome.output.matches.0'. Defaults to 'root'.",
  })
);

const ExpandField = Schema.optional(
  Schema.Boolean.annotate({
    description:
      "Return the literal value. By default long strings, long arrays, and deep records are summarized.",
  })
);

export const ratListContracts = defineContract("rat_list_contracts", {
  annotations: readOnly,
  description:
    "List every capability in this runtime: name, description, approval, and annotations. Call rat_describe_contract for its schemas.",
  failure: Schema.Never,
  input: Schema.Struct({
    query: Schema.optional(
      Schema.String.annotate({
        description:
          "Keep contracts whose name or description contains this text, ignoring case.",
      })
    ),
  }),
  output: Schema.Struct({ contracts: Schema.Array(ContractSummary) }),
});

export const ratDescribeContract = defineContract("rat_describe_contract", {
  annotations: readOnly,
  description:
    "Describe one capability's input, output, and failure as JSON Schema, so a valid rat_call input can be built without reading source.",
  failure: UnknownCapability,
  input: Schema.Struct({ name: Schema.String }),
  output: Schema.Struct({
    contract: ContractSummary,
    failure: Schema.Json,
    input: Schema.Json,
    output: Schema.Json,
  }),
});

export const ratListCalls = defineContract("rat_list_calls", {
  annotations: readOnly,
  description:
    "List recorded capability calls in order, summarized. Filter by capability and outcome; page forward with sinceIndex; set fromEnd for the latest calls first ('what just happened').",
  failure: Schema.Never,
  input: Schema.Struct({
    capability: Schema.optional(Schema.String),
    fromEnd: Schema.optional(Schema.Boolean),
    limit: Schema.optional(
      Schema.Int.check(Schema.isBetween({ maximum: 500, minimum: 1 }))
    ),
    outcome: Schema.optional(Schema.Literals(["Succeeded", "Failed", "Died"])),
    sinceIndex: Schema.optional(Schema.Int),
  }),
  output: Schema.Struct({
    ...HistoryBounds,
    entries: Schema.Array(Schema.Json),
    matched: Schema.Int,
  }),
});

export const ratCountCalls = defineContract("rat_count_calls", {
  annotations: readOnly,
  description:
    "Count recorded calls by capability and outcome, without payloads. The cheap first call before paging history.",
  failure: Schema.Never,
  input: Schema.Struct({
    capability: Schema.optional(
      Schema.String.annotate({ description: "Count only this capability." })
    ),
  }),
  output: Schema.Struct({
    ...HistoryBounds,
    counts: Schema.Array(
      Schema.Struct({
        capability: Schema.String,
        died: Schema.Int,
        failed: Schema.Int,
        succeeded: Schema.Int,
        total: Schema.Int,
      })
    ),
  }),
});

export const ratGetCall = defineContract("rat_get_call", {
  annotations: readOnly,
  description:
    "Read one recorded call, or one path inside it, such as 'root.outcome.output'.",
  failure: Schema.Union([CallNotFound, PathNotFound]),
  input: Schema.Struct({ expand: ExpandField, index: Index, path: PathField }),
  output: Schema.Struct({ value: Schema.Json }),
});

export const ratCall = defineContract("rat_call", {
  annotations: { destructive: true, openWorld: true },
  description:
    "Call a capability by name. The input is decoded by that capability's contract first, approval-gated capabilities stay gated, and the call is recorded like any other.",
  failure: Schema.Never,
  input: Schema.Struct({
    as: Schema.optional(
      Schema.Json.annotate({
        description:
          "Identity to run the call as, decoded by the runtime's runAs schema, such as a test person's id from rat_test_person. Omit to use the runtime's own identity.",
      })
    ),
    capability: Schema.String,
    input: Schema.Json,
  }),
  output: Schema.Struct({ result: InvokeResultSchema }),
});

export const ratReplayCall = defineContract("rat_replay_call", {
  annotations: { destructive: true, openWorld: true },
  description:
    "Run a recorded call's input again, as the same identity, and diff the new result against the recorded one, path by path.",
  failure: CallNotFound,
  input: Schema.Struct({ index: Index }),
  output: Schema.Struct({
    changes: Schema.Array(ChangeSchema),
    recorded: OutcomeSchema,
    replayed: InvokeResultSchema,
  }),
});

export const ratDiffCalls = defineContract("rat_diff_calls", {
  annotations: readOnly,
  description: "Diff two recorded calls' inputs and outcomes, path by path.",
  failure: CallNotFound,
  input: Schema.Struct({ from: Index, to: Index }),
  output: Schema.Struct({ changes: Schema.Array(ChangeSchema) }),
});

const LatestActor = Schema.Struct({
  actorId: Schema.String,
  lastIndex: Schema.Int,
  machine: Schema.String,
  rootId: Schema.String,
  state: Schema.Json,
  status: Schema.String,
  transitions: Schema.Int,
});

export const ratListActors = defineContract("rat_list_actors", {
  annotations: readOnly,
  description:
    "List the state machine actors this runtime has run, each with its latest state value, status, and transition count. Filter by machine name.",
  failure: Schema.Never,
  input: Schema.Struct({
    machine: Schema.optional(
      Schema.String.annotate({ description: "Only actors of this machine." })
    ),
  }),
  output: Schema.Struct({
    ...HistoryBounds,
    actors: Schema.Array(LatestActor),
  }),
});

export const ratListTransitions = defineContract("rat_list_transitions", {
  annotations: readOnly,
  description:
    "List state machine transitions in order, summarized: the event, the resulting state value, status, and context. Filter by actor or machine; set fromEnd for the latest first.",
  failure: Schema.Never,
  input: Schema.Struct({
    actorId: Schema.optional(Schema.String),
    fromEnd: Schema.optional(Schema.Boolean),
    limit: Schema.optional(
      Schema.Int.check(Schema.isBetween({ maximum: 500, minimum: 1 }))
    ),
    machine: Schema.optional(Schema.String),
    sinceIndex: Schema.optional(Schema.Int),
  }),
  output: Schema.Struct({
    ...HistoryBounds,
    entries: Schema.Array(Schema.Json),
    matched: Schema.Int,
  }),
});

export const ratGetActor = defineContract("rat_get_actor", {
  annotations: readOnly,
  description:
    "Read one actor's latest entry, or one path inside it, such as 'root.context' or 'root.state'.",
  failure: Schema.Union([ActorNotFound, PathNotFound]),
  input: Schema.Struct({
    actorId: Schema.String,
    expand: ExpandField,
    path: PathField,
  }),
  output: Schema.Struct({ value: Schema.Json }),
});

export const devtoolsContracts = [
  ratListContracts,
  ratDescribeContract,
  ratListCalls,
  ratCountCalls,
  ratGetCall,
  ratCall,
  ratReplayCall,
  ratDiffCalls,
  ratListActors,
  ratListTransitions,
  ratGetActor,
] as const;
