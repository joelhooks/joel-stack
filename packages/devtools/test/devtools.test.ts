import { describe, expect, it } from "@effect/vitest";
import {
  Approval,
  defineContract,
  implement,
  toToolkit,
} from "@rat-stack/capability";
import { Clock, Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { Tool } from "effect/unstable/ai";

import {
  CallLog,
  CallNotFound,
  OutcomeSchema,
  PathNotFound,
  SideSchema,
  UnknownCapability,
  devtools,
  summarize,
} from "../src/index.js";
import type { InvokeResult } from "../src/index.js";

class NotFound extends Schema.TaggedError<NotFound>()("NotFound", {
  id: Schema.String,
}) {}

const echo = implement(
  defineContract("echo", {
    annotations: { idempotent: true, readOnly: true },
    description: "Repeat text",
    failure: Schema.Never,
    input: Schema.Struct({ text: Schema.String }),
    output: Schema.Struct({ text: Schema.String }),
  }),
  ({ text }) => Effect.succeed({ text })
);

const lookup = implement(
  defineContract("lookup", {
    description: "Find a record by id",
    failure: NotFound,
    input: Schema.Struct({ id: Schema.String }),
    output: Schema.Struct({ name: Schema.String }),
  }),
  ({ id }) =>
    id === "known"
      ? Effect.succeed({ name: "Known" })
      : Effect.fail(new NotFound({ id }))
);

const boom = implement(
  defineContract("boom", {
    description: "Always dies",
    failure: Schema.Never,
    input: Schema.Struct({}),
    output: Schema.Struct({}),
  }),
  () => Effect.die("kaboom")
);

const now = implement(
  defineContract("now", {
    description: "Read the clock",
    failure: Schema.Never,
    input: Schema.Struct({}),
    output: Schema.Struct({ millis: Schema.Int }),
  }),
  () => Clock.currentTimeMillis.pipe(Effect.map((millis) => ({ millis })))
);

const gated = implement(
  defineContract("gated", {
    description: "Needs approval",
    failure: Schema.Never,
    input: Schema.Struct({}),
    needsApproval: true,
    output: Schema.Struct({ done: Schema.Boolean }),
  }),
  () => Effect.succeed({ done: true })
);

const app = [echo, lookup, boom, now, gated] as const;

const setup = devtools(app);

const tools = setup.pipe(
  Effect.map(({ tools: devtoolsTools }) => {
    const [
      listContracts,
      describeContract,
      listCalls,
      countCalls,
      getCall,
      call,
      replayCall,
      diffCalls,
    ] = devtoolsTools;

    return {
      call,
      countCalls,
      describeContract,
      diffCalls,
      getCall,
      listCalls,
      listContracts,
      replayCall,
    };
  })
);

const Tagged = Schema.Struct({ _tag: Schema.String });

const errorTagOf = (result: InvokeResult) =>
  result.ok ? undefined : Schema.decodeUnknownSync(Tagged)(result.error)._tag;

const runTraffic = Effect.gen(function* runTraffic() {
  const { recorded } = yield* setup;
  const [recordedEcho, recordedLookup, recordedBoom] = recorded;

  yield* recordedEcho.handler({ text: "one" });
  yield* Effect.flip(recordedLookup.handler({ id: "missing" }));
  yield* Effect.exit(recordedBoom.handler({}));
  yield* recordedEcho.handler({ text: "two" });

  return recorded;
});

const withLog = (capacity?: number) =>
  Layer.mergeAll(CallLog.layer(capacity), Approval.allowAll);

describe("devtools", () => {
  it.effect("records successes, declared failures, and defects in order", () =>
    Effect.gen(function* recordsOutcomes() {
      yield* runTraffic;
      const { entries, nextIndex } = yield* (yield* CallLog).snapshot;

      expect(nextIndex).toBe(4);
      expect(entries.map((entry) => entry.capability)).toEqual([
        "echo",
        "lookup",
        "boom",
        "echo",
      ]);
      expect(entries.map((entry) => entry.outcome._tag)).toEqual([
        "Succeeded",
        "Failed",
        "Died",
        "Succeeded",
      ]);
      expect(entries[0]?.input).toEqual({ text: "one" });
      const failed = entries[1]?.outcome;

      const failure =
        failed !== undefined && OutcomeSchema.guards.Failed(failed)
          ? yield* Schema.decodeUnknownEffect(NotFound)(failed.failure)
          : undefined;

      expect(failure).toEqual(new NotFound({ id: "missing" }));
    }).pipe(Effect.provide(withLog()))
  );

  it.effect("evicts the oldest calls past its capacity", () =>
    Effect.gen(function* evicts() {
      yield* runTraffic;
      const { countCalls } = yield* tools;
      const counted = yield* countCalls.handler({});
      const echoOnly = yield* countCalls.handler({ capability: "echo" });

      expect(counted.firstIndex).toBe(2);
      expect(counted.nextIndex).toBe(4);
      expect(counted.counts).toEqual([
        { capability: "boom", died: 1, failed: 0, succeeded: 0, total: 1 },
        { capability: "echo", died: 0, failed: 0, succeeded: 1, total: 1 },
      ]);
      expect(echoOnly.counts.map((count) => count.capability)).toEqual([
        "echo",
      ]);
    }).pipe(Effect.provide(withLog(2)))
  );

  it.effect(
    "lists calls filtered by capability and outcome, from either end",
    () =>
      Effect.gen(function* listsCalls() {
        yield* runTraffic;
        const { listCalls } = yield* tools;

        const echoes = yield* listCalls.handler({ capability: "echo" });
        const failed = yield* listCalls.handler({ outcome: "Failed" });
        const latest = yield* listCalls.handler({ fromEnd: true, limit: 1 });
        const later = yield* listCalls.handler({ sinceIndex: 2 });

        expect(echoes.matched).toBe(2);
        expect(failed.entries).toMatchObject([
          { capability: "lookup", index: 1 },
        ]);
        expect(latest.entries).toMatchObject([{ index: 3 }]);
        expect(later.entries).toMatchObject([{ index: 2 }, { index: 3 }]);
      }).pipe(Effect.provide(withLog()))
  );

  it.effect("reads a call by path and names the keys when a path misses", () =>
    Effect.gen(function* readsPaths() {
      yield* runTraffic;
      const { getCall } = yield* tools;

      const input = yield* getCall.handler({ index: 0, path: "root.input" });

      const missing = yield* Effect.flip(
        getCall.handler({ index: 0, path: "root.nope" })
      );

      const gone = yield* Effect.flip(getCall.handler({ index: 99 }));

      expect(input.value).toEqual({ text: "one" });
      expect(Schema.is(PathNotFound)(missing)).toBe(true);
      expect(missing).toMatchObject({ resolved: "root" });
      expect(Schema.is(CallNotFound)(gone)).toBe(true);
    }).pipe(Effect.provide(withLog()))
  );

  it.effect("dispatches a call through its contract and records it", () =>
    Effect.gen(function* dispatches() {
      const { call, listCalls } = yield* tools;

      const good = yield* call.handler({
        capability: "echo",
        input: { text: "hi" },
      });

      const bad = yield* call.handler({
        capability: "echo",
        input: { text: 1 },
      });

      const unknown = yield* call.handler({ capability: "nope", input: {} });
      const history = yield* listCalls.handler({});

      expect(good.result).toEqual({ ok: true, value: { text: "hi" } });
      expect(errorTagOf(bad.result)).toBe("InvalidInput");
      expect(errorTagOf(unknown.result)).toBe("UnknownCapability");
      expect(history.matched).toBe(1);
    }).pipe(Effect.provide(withLog()))
  );

  it.effect("keeps approval-gated capabilities gated", () =>
    Effect.gen(function* keepsGates() {
      const { call } = yield* tools;
      const denied = yield* call.handler({ capability: "gated", input: {} });

      expect(errorTagOf(denied.result)).toBe("ApprovalDenied");
    }).pipe(Effect.provide(Layer.mergeAll(CallLog.layer(), Approval.denyAll)))
  );

  it.effect(
    "replays a call and diffs the new result against the recorded one",
    () =>
      Effect.gen(function* replays() {
        const { call, replayCall } = yield* tools;

        yield* call.handler({ capability: "now", input: {} });
        yield* TestClock.adjust("5 seconds");
        const replay = yield* replayCall.handler({ index: 0 });

        expect(replay.changes).toEqual([
          {
            after: SideSchema.cases.Present.make({ value: 5000 }),
            before: SideSchema.cases.Present.make({ value: 0 }),
            path: "root.value.millis",
          },
        ]);
      }).pipe(Effect.provide(withLog()))
  );

  it.effect("diffs two recorded calls", () =>
    Effect.gen(function* diffs() {
      yield* runTraffic;
      const { diffCalls } = yield* tools;
      const { changes } = yield* diffCalls.handler({ from: 0, to: 3 });

      expect(changes.map((change) => change.path)).toEqual([
        "root.input.text",
        "root.result.value.text",
      ]);
    }).pipe(Effect.provide(withLog()))
  );

  it.effect(
    "describes contracts as JSON Schema and rejects unknown names",
    () =>
      Effect.gen(function* describes() {
        const { describeContract, listContracts } = yield* tools;

        const listed = yield* listContracts.handler({});
        const queried = yield* listContracts.handler({ query: "CLOCK" });
        const described = yield* describeContract.handler({ name: "echo" });

        const unknown = yield* Effect.flip(
          describeContract.handler({ name: "nope" })
        );

        expect(listed.contracts.map((contract) => contract.name)).toEqual([
          "echo",
          "lookup",
          "boom",
          "now",
          "gated",
        ]);
        expect(queried.contracts.map((contract) => contract.name)).toEqual([
          "now",
        ]);
        expect(described.input).toMatchObject({
          properties: { text: { type: "string" } },
        });
        expect(Schema.is(UnknownCapability)(unknown)).toBe(true);
      }).pipe(Effect.provide(withLog()))
  );

  it.effect("projects devtools as MCP tools beside the app's own", () =>
    Effect.gen(function* projects() {
      const { capabilities } = yield* setup;

      expect(Object.keys(toToolkit(capabilities).toolkit.tools)).toEqual([
        "echo",
        "lookup",
        "boom",
        "now",
        "gated",
        "rat_list_contracts",
        "rat_describe_contract",
        "rat_list_calls",
        "rat_count_calls",
        "rat_get_call",
        "rat_call",
        "rat_replay_call",
        "rat_diff_calls",
      ]);
    }).pipe(Effect.provide(withLog()))
  );

  it.effect(
    "gives every devtools tool an object input schema, as MCP requires",
    () =>
      Effect.gen(function* objectInputs() {
        const { tools: devtoolsTools } = yield* setup;

        for (const tool of devtoolsTools) {
          expect(
            Tool.getJsonSchemaFromSchema(tool.contract.input)
          ).toMatchObject({
            type: "object",
          });
        }
      }).pipe(Effect.provide(withLog()))
  );

  it("summarizes long arrays, long strings, and deep records", () => {
    const summary = summarize({
      deep: { a: { b: { c: { d: { e: 1 } } } } },
      list: Array.from({ length: 20 }, (_, index) => index),
      text: "x".repeat(500),
    });

    expect(summary).toEqual({
      deep: { a: { b: { c: { _summary: "record", keys: ["d"] } } } },
      list: { _summary: "array", length: 20, sample: [0, 19] },
      text: { _summary: "string", head: "x".repeat(120), length: 500 },
    });
  });
});
