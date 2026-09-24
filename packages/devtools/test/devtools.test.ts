import { describe, expect, it } from "@effect/vitest";
import {
  Approval,
  aroundHandlers,
  defineContract,
  implement,
  toRpc,
  toToolkit,
} from "@rat-stack/capability";
import type { AnyContract } from "@rat-stack/capability";
import { watchActor } from "@rat-stack/capability/actor-watch";
import type {
  ActorEvent,
  WatchableActor,
} from "@rat-stack/capability/actor-watch";
import { CallWatch } from "@rat-stack/capability/call-watch";
import type { CallWatchService } from "@rat-stack/capability/call-watch";
import { Clock, Effect, Layer, Schema, Stream } from "effect";
import { TestClock } from "effect/testing";
import { Tool } from "effect/unstable/ai";
import { RpcTest } from "effect/unstable/rpc";

import {
  ActorLog,
  ActorNotFound,
  AtomNotFound,
  CallLog,
  CallNotFound,
  OutcomeSchema,
  PathNotFound,
  SideSchema,
  UnknownCapability,
  devtools,
  devtoolsLayer,
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

const counterActor = (
  observers: Set<(event: ActorEvent) => void>
): WatchableActor => ({
  getSnapshot: () => ({
    context: { count: 0 },
    status: "active",
    value: "idle",
  }),
  inspect: (observer) => {
    observers.add(observer);

    return {
      unsubscribe: () => {
        observers.delete(observer);
      },
    };
  },
  sessionId: "root-1",
});

const emit = (
  observers: Set<(event: ActorEvent) => void>,
  event: ActorEvent & Schema.JsonObject
) => {
  for (const observer of observers) {
    observer(event);
  }
};

const counter = implement(
  defineContract("counter", {
    description: "Run a tiny counter machine",
    failure: Schema.Never,
    input: Schema.Struct({ by: Schema.Int }),
    output: Schema.Struct({ ran: Schema.Boolean }),
  }),
  ({ by }) =>
    Effect.scoped(
      Effect.gen(function* runCounter() {
        const observers = new Set<(event: ActorEvent) => void>();

        yield* watchActor("counter", counterActor(observers));

        emit(observers, {
          actorRef: { sessionId: "child-1" },
          id: "tick",
          rootId: "root-1",
          snapshot: { status: "active" },
          src: "ticker",
          type: "@xstate.actor",
        });
        emit(observers, {
          actorRef: { sessionId: "root-1" },
          event: { by, type: "inc" },
          eventType: "inc",
          rootId: "root-1",
          snapshot: {
            context: { count: by },
            status: "done",
            value: "counted",
          },
          type: "@xstate.transition",
        });

        return { ran: true };
      })
    )
);

const app = [echo, lookup, boom, now, gated, counter] as const;

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
      listActors,
      listTransitions,
      getActor,
      reportAtoms,
      listAtoms,
      getAtom,
    ] = devtoolsTools;

    return {
      call,
      countCalls,
      describeContract,
      diffCalls,
      getActor,
      getAtom,
      getCall,
      listActors,
      listAtoms,
      listCalls,
      listContracts,
      listTransitions,
      replayCall,
      reportAtoms,
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
  Layer.mergeAll(devtoolsLayer(capacity), Approval.allowAll);

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

        const latest = yield* listCalls.handler({
          capability: "echo",
          fromEnd: true,
          limit: 1,
        });

        const later = yield* listCalls.handler({
          outcome: "Died",
          sinceIndex: 2,
        });

        expect(echoes.matched).toBe(2);
        expect(failed.entries).toMatchObject([
          { capability: "lookup", index: 1 },
        ]);
        expect(latest.entries).toMatchObject([{ index: 3 }]);
        expect(later.entries).toMatchObject([{ index: 2 }]);
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
      const history = yield* listCalls.handler({ capability: "echo" });

      expect(good.result).toEqual({ ok: true, value: { text: "hi" } });
      expect(errorTagOf(bad.result)).toBe("InvalidInput");
      expect(errorTagOf(unknown.result)).toBe("UnknownCapability");
      expect(history.matched).toBe(1);
    }).pipe(Effect.provide(withLog()))
  );

  it.effect("keeps approval-gated capabilities gated and records denial", () =>
    Effect.gen(function* keepsGates() {
      const { call } = yield* tools;
      const denied = yield* call.handler({ capability: "gated", input: {} });
      const { entries } = yield* (yield* CallLog).snapshot;
      const recorded = entries.find((entry) => entry.capability === "gated");

      const outcome = recorded?.outcome;

      expect(errorTagOf(denied.result)).toBe("ApprovalDenied");
      expect(
        outcome !== undefined &&
          OutcomeSchema.guards.Failed(outcome) &&
          outcome.failureTag === "ApprovalDenied"
      ).toBe(true);
    }).pipe(Effect.provide(Layer.mergeAll(devtoolsLayer(), Approval.denyAll)))
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
          "counter",
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
        "counter",
        "rat_list_contracts",
        "rat_describe_contract",
        "rat_list_calls",
        "rat_count_calls",
        "rat_get_call",
        "rat_call",
        "rat_replay_call",
        "rat_diff_calls",
        "rat_list_actors",
        "rat_list_transitions",
        "rat_get_actor",
        "rat_report_atoms",
        "rat_list_atoms",
        "rat_get_atom",
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

  it.effect("keeps the original capabilities without wrapping the list", () =>
    Effect.gen(function* keepsOriginalCapabilities() {
      const { capabilities, recorded } = yield* setup;

      expect(recorded).toBe(app);
      expect(capabilities.slice(0, app.length)).toEqual(app);
    }).pipe(Effect.provide(withLog()))
  );

  it.effect("records calls through the RPC projection", () => {
    const projection = toRpc([echo]);

    return Effect.gen(function* recordsRpc() {
      const client = yield* RpcTest.makeClient(projection.group);
      yield* client.echo({ text: "rpc" });

      const { entries } = yield* (yield* CallLog).snapshot;

      expect(entries).toMatchObject([
        { capability: "echo", input: { text: "rpc" } },
      ]);
    }).pipe(
      Effect.provide(projection.layer.pipe(Layer.provideMerge(devtoolsLayer())))
    );
  });

  it.effect("records calls through the toolkit projection", () => {
    const projection = toToolkit([echo]);

    return Effect.gen(function* recordsToolkit() {
      const toolkit = yield* projection.toolkit;
      const result = yield* toolkit.handle("echo", { text: "toolkit" });
      yield* Stream.runDrain(result);

      const { entries } = yield* (yield* CallLog).snapshot;

      expect(entries).toMatchObject([
        { capability: "echo", input: { text: "toolkit" } },
      ]);
    }).pipe(
      Effect.provide(projection.layer.pipe(Layer.provideMerge(devtoolsLayer())))
    );
  });

  it.effect("runs list policy outside the ambient recorder", () =>
    Effect.gen(function* composesPolicyAndRecording() {
      const markers: string[] = [];
      const callWatch = yield* CallWatch;

      const recording: CallWatchService = {
        around: <A, E, R>(
          contract: AnyContract,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- CallWatch preserves the erased input across heterogeneous capability lists.
          input: unknown,
          run: Effect.Effect<A, E, R>
        ): Effect.Effect<A, E, R> =>
          Effect.ensuring(
            Effect.sync(() => {
              markers.push("recording:start");
            }).pipe(Effect.andThen(callWatch.around(contract, input, run))),
            Effect.sync(() => {
              markers.push("recording:end");
            })
          ),
      };

      const [gate] = aroundHandlers(
        [gated],
        <A, E, R>(
          _contract: AnyContract,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters -- aroundHandlers erases input across a heterogeneous capability list.
          _input: unknown,
          run: Effect.Effect<A, E, R>
        ): Effect.Effect<A, E, R> =>
          Effect.ensuring(
            Effect.sync(() => {
              markers.push("gate:start");
            }).pipe(Effect.andThen(run)),
            Effect.sync(() => {
              markers.push("gate:end");
            })
          )
      );

      yield* Effect.exit(
        gate.handler({}).pipe(Effect.provideService(CallWatch, recording))
      );

      const { entries } = yield* (yield* CallLog).snapshot;
      const [entry] = entries;
      const outcome = entry?.outcome;

      expect(markers).toEqual([
        "gate:start",
        "recording:start",
        "recording:end",
        "gate:end",
      ]);
      expect(entry?.capability).toBe("gated");
      expect(
        outcome !== undefined && OutcomeSchema.guards.Failed(outcome)
      ).toBe(true);
    }).pipe(Effect.provide(Layer.mergeAll(devtoolsLayer(), Approval.denyAll)))
  );

  it.effect(
    "records machine transitions from a recorded call, including ones emitted just before the scope closes",
    () =>
      Effect.gen(function* recordsMachines() {
        const { call, getActor, listActors, listTransitions } = yield* tools;

        yield* call.handler({ capability: "counter", input: { by: 3 } });

        const { actors } = yield* listActors.handler({});

        const counted = yield* getActor.handler({
          actorId: "root-1",
          path: "root.context.count",
        });

        const transitions = yield* listTransitions.handler({
          machine: "counter",
        });

        const missing = yield* Effect.flip(
          getActor.handler({ actorId: "nope" })
        );

        expect(actors).toEqual([
          {
            actorId: "root-1",
            lastIndex: 2,
            machine: "counter",
            rootId: "root-1",
            state: "counted",
            status: "done",
            transitions: 1,
          },
          {
            actorId: "child-1",
            lastIndex: 1,
            machine: "ticker",
            rootId: "root-1",
            state: null,
            status: "active",
            transitions: 0,
          },
        ]);
        expect(counted.value).toBe(3);
        expect(transitions.matched).toBe(2);
        expect(Schema.is(ActorNotFound)(missing)).toBe(true);
      }).pipe(Effect.provide(withLog()))
  );

  it.effect("records nothing when a machine runs outside devtools", () =>
    Effect.gen(function* watchesNothing() {
      yield* counter.handler({ by: 1 });
      const { entries } = yield* (yield* ActorLog).snapshot;

      expect(entries).toEqual([]);
    }).pipe(Effect.provide(ActorLog.layer()))
  );

  it.effect(
    "stores each tab's atom snapshot and reads atoms by key and path",
    () =>
      Effect.gen(function* readsAtoms() {
        const { getAtom, listAtoms, reportAtoms } = yield* tools;

        const first = yield* reportAtoms.handler({
          atoms: [
            {
              key: "search:capability",
              state: "valid",
              value: { matches: [{ id: "skills/add-a-capability" }], total: 1 },
            },
          ],
        });

        const again = yield* reportAtoms.handler({
          atoms: [
            { key: "search:capability", state: "stale", value: { total: 2 } },
            { key: "read:skills", state: "uninitialized", value: null },
          ],
          tabId: first.tabId,
        });

        const listed = yield* listAtoms.handler({});

        const total = yield* getAtom.handler({
          key: "search:capability",
          path: "root.total",
        });

        const missing = yield* Effect.flip(getAtom.handler({ key: "nope" }));

        expect(first.tabId).toBe("tab-1");
        expect(again.tabId).toBe("tab-1");
        expect(listed.tabs).toMatchObject([
          {
            atoms: [
              { key: "search:capability", state: "stale" },
              { key: "read:skills", state: "uninitialized" },
            ],
            tabId: "tab-1",
          },
        ]);
        expect(total).toEqual({ tabId: "tab-1", value: 2 });
        expect(Schema.is(AtomNotFound)(missing)).toBe(true);
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
