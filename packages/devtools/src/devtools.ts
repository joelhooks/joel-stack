import {
  aroundHandlers,
  failureSchemaOf,
  implement,
  invokerFor,
  toCatalog,
} from "@rat-stack/capability";
import type { AnyCapability, AnyContract, Around } from "@rat-stack/capability";
import { ActorWatch } from "@rat-stack/capability/actor-watch";
import type { ActorWatchService } from "@rat-stack/capability/actor-watch";
import type { JsonSchema } from "effect";
import { Cause, Clock, Effect, Exit, Layer, Option, Schema } from "effect";

import { ActorEntrySchema, ActorLog } from "./actor-log.js";
import type { ActorEntry, ActorLogSnapshot } from "./actor-log.js";
import { ActorNotFound } from "./actor-not-found.js";
import { actorWatcher } from "./actor-watcher.js";
import { CallEntrySchema, CallLog, OutcomeSchema } from "./call-log.js";
import type { CallEntry, CallLogSnapshot, Outcome } from "./call-log.js";
import { CallNotFound } from "./call-not-found.js";
import {
  InvokeResultSchema,
  ratCall,
  ratCountCalls,
  ratDescribeContract,
  ratDiffCalls,
  ratGetActor,
  ratGetCall,
  ratListActors,
  ratListCalls,
  ratListContracts,
  ratListTransitions,
  ratReplayCall,
} from "./contracts.js";
import type { InvokeResult } from "./contracts.js";
import { ROOT, diff, readPath, summarize, toJson } from "./json.js";
import { UnknownCapability } from "./unknown-capability.js";

const DEFAULT_LIST_LIMIT = 50;

const Tagged = Schema.Struct({ _tag: Schema.String });

const failureTagOf = (failure: Schema.Json) =>
  Schema.decodeUnknownOption(Tagged)(failure).pipe(
    Option.map(({ _tag }) => _tag),
    Option.getOrElse(() => "Unknown")
  );

const outcomeOf = <A, E>(contract: AnyContract, exit: Exit.Exit<A, E>) =>
  Exit.isSuccess(exit)
    ? toJson(contract.output, exit.value).pipe(
        Effect.map((output) => OutcomeSchema.cases.Succeeded.make({ output }))
      )
    : Option.match(Cause.findErrorOption(exit.cause), {
        onNone: () =>
          Effect.succeed(
            OutcomeSchema.cases.Died.make({ message: Cause.pretty(exit.cause) })
          ),
        onSome: (error) =>
          toJson(failureSchemaOf(contract), error).pipe(
            Effect.map((failure) =>
              OutcomeSchema.cases.Failed.make({
                failure,
                failureTag: failureTagOf(failure),
              })
            )
          ),
      });

const recorder =
  (log: CallLog["Service"], watcher: ActorWatchService): Around =>
  (contract, input, run) =>
    Effect.gen(function* recordCall() {
      const startedAt = yield* Clock.currentTimeMillis;

      const exit = yield* Effect.exit(
        run.pipe(Effect.provideService(ActorWatch, watcher))
      );

      const finishedAt = yield* Clock.currentTimeMillis;

      yield* log.append({
        capability: contract.name,
        durationMs: finishedAt - startedAt,
        input: yield* toJson(contract.input, input),
        outcome: yield* outcomeOf(contract, exit),
        startedAt,
      });

      return yield* exit;
    });

export const record = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
) =>
  Effect.gen(function* recordCapabilities() {
    const log = yield* CallLog;
    const watcher = yield* actorWatcher;

    return aroundHandlers(capabilities, recorder(log, watcher));
  });

const summaryOf = ({ contract }: AnyCapability) => ({
  annotations: contract.annotations,
  description: contract.description,
  name: contract.name,
  needsApproval: contract.needsApproval,
});

const findCall = (snapshot: CallLogSnapshot, index: number) =>
  Effect.fromOption(
    Option.fromUndefinedOr(
      snapshot.entries.find((entry) => entry.index === index)
    )
  ).pipe(
    Effect.mapError(
      () =>
        new CallNotFound({
          firstIndex: snapshot.firstIndex,
          index,
          nextIndex: snapshot.nextIndex,
        })
    )
  );

const resultOf = (outcome: Outcome): Schema.Json =>
  OutcomeSchema.match(outcome, {
    Died: ({ message }): Schema.Json => ({
      ok: false,
      value: { defect: message },
    }),
    Failed: ({ failure }): Schema.Json => ({ ok: false, value: failure }),
    Succeeded: ({ output }): Schema.Json => ({ ok: true, value: output }),
  });

const invokeResultOf = (result: InvokeResult): Schema.Json =>
  result.ok
    ? { ok: true, value: result.value }
    : { ok: false, value: result.error };

const comparableOf = (entry: CallEntry): Schema.Json => ({
  capability: entry.capability,
  input: entry.input,
  result: resultOf(entry.outcome),
});

const encodeEntry = (entry: CallEntry) =>
  toJson(CallEntrySchema, entry).pipe(Effect.map(summarize));

const jsonSchemaOf = (schema: JsonSchema.JsonSchema | undefined) =>
  Schema.decodeUnknownEffect(Schema.Json)(schema).pipe(
    Effect.orElseSucceed((): Schema.Json => ({}))
  );

const latestActors = (snapshot: ActorLogSnapshot) => {
  const latest = new Map<string, ActorEntry>();
  const transitions = new Map<string, number>();

  for (const entry of snapshot.entries) {
    latest.set(entry.actorId, entry);

    if (entry.kind === "transition") {
      transitions.set(entry.actorId, (transitions.get(entry.actorId) ?? 0) + 1);
    }
  }

  return [...latest.values()].map((entry) => ({
    actorId: entry.actorId,
    lastIndex: entry.index,
    machine: entry.machine,
    rootId: entry.rootId,
    state: entry.state,
    status: entry.status,
    transitions: transitions.get(entry.actorId) ?? 0,
  }));
};

const encodeActorEntry = (entry: ActorEntry) =>
  toJson(ActorEntrySchema, entry).pipe(Effect.map(summarize));

const toolsFor = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps,
  log: CallLog["Service"],
  actors: ActorLog["Service"]
) => {
  const byName = new Map(
    capabilities.map((capability) => [capability.contract.name, capability])
  );

  const names = [...byName.keys()];

  const dispatch = (name: string, input: Schema.Json) =>
    Effect.gen(function* dispatchCall() {
      const invoke = yield* invokerFor(capabilities);
      const outcome = yield* invoke(name, input);

      return yield* Schema.decodeUnknownEffect(InvokeResultSchema)(
        outcome
      ).pipe(
        Effect.orElseSucceed((): InvokeResult => ({
          error: { reason: "The result could not be encoded as JSON" },
          ok: false,
        }))
      );
    });

  return [
    implement(ratListContracts, ({ query }) => {
      const needle = query?.toLowerCase();

      return Effect.succeed({
        contracts: capabilities
          .map(summaryOf)
          .filter(
            ({ description, name }) =>
              needle === undefined ||
              `${name} ${description}`.toLowerCase().includes(needle)
          ),
      });
    }),
    implement(ratDescribeContract, ({ name }) =>
      Option.match(Option.fromUndefinedOr(byName.get(name)), {
        onNone: () =>
          Effect.fail(new UnknownCapability({ available: names, name })),
        onSome: (capability) =>
          Effect.gen(function* describe() {
            const [entry] = toCatalog([capability]).capabilities;

            return {
              contract: summaryOf(capability),
              failure: yield* jsonSchemaOf(entry?.failure),
              input: yield* jsonSchemaOf(entry?.input),
              output: yield* jsonSchemaOf(entry?.output),
            };
          }),
      })
    ),
    implement(
      ratListCalls,
      Effect.fn("Devtools.listCalls")(function* listCallsHandler({
        capability,
        fromEnd,
        limit,
        outcome,
        sinceIndex,
      }) {
        const { entries, firstIndex, nextIndex } = yield* log.snapshot;
        const size = limit ?? DEFAULT_LIST_LIMIT;

        const matching = entries.filter(
          (entry) =>
            (capability === undefined || entry.capability === capability) &&
            (outcome === undefined ||
              OutcomeSchema.isAnyOf([outcome])(entry.outcome)) &&
            (sinceIndex === undefined || entry.index >= sinceIndex)
        );

        const page =
          fromEnd === true ? matching.slice(-size) : matching.slice(0, size);

        const encoded = yield* Effect.forEach(encodeEntry)(page);

        return {
          entries: encoded,
          firstIndex,
          matched: matching.length,
          nextIndex,
        };
      })
    ),
    implement(
      ratCountCalls,
      Effect.fn("Devtools.countCalls")(function* countCallsHandler({
        capability,
      }) {
        const snapshot = yield* log.snapshot;
        const { firstIndex, nextIndex } = snapshot;

        const entries = snapshot.entries.filter(
          (entry) => capability === undefined || entry.capability === capability
        );

        const counts = new Map<
          string,
          { died: number; failed: number; succeeded: number }
        >();

        for (const entry of entries) {
          const current = counts.get(entry.capability) ?? {
            died: 0,
            failed: 0,
            succeeded: 0,
          };

          counts.set(
            entry.capability,
            OutcomeSchema.match(entry.outcome, {
              Died: () => ({ ...current, died: current.died + 1 }),
              Failed: () => ({ ...current, failed: current.failed + 1 }),
              Succeeded: () => ({
                ...current,
                succeeded: current.succeeded + 1,
              }),
            })
          );
        }

        return {
          counts: [...counts]
            .map(([name, count]) => ({
              ...count,
              capability: name,
              total: count.died + count.failed + count.succeeded,
            }))
            .toSorted((left, right) => right.total - left.total),
          firstIndex,
          nextIndex,
        };
      })
    ),
    implement(
      ratGetCall,
      Effect.fn("Devtools.getCall")(function* getCallHandler({
        expand,
        index,
        path,
      }) {
        const entry = yield* findCall(yield* log.snapshot, index);
        const encoded = yield* toJson(CallEntrySchema, entry);
        const value = yield* readPath(encoded, path ?? ROOT);

        return { value: expand === true ? value : summarize(value) };
      })
    ),
    implement(ratCall, ({ capability, input }) =>
      dispatch(capability, input).pipe(Effect.map((result) => ({ result })))
    ),
    implement(
      ratReplayCall,
      Effect.fn("Devtools.replayCall")(function* replayCallHandler({ index }) {
        const entry = yield* findCall(yield* log.snapshot, index);
        const replayed = yield* dispatch(entry.capability, entry.input);

        return {
          changes: diff(resultOf(entry.outcome), invokeResultOf(replayed)),
          recorded: entry.outcome,
          replayed,
        };
      })
    ),
    implement(
      ratDiffCalls,
      Effect.fn("Devtools.diffCalls")(function* diffCallsHandler({ from, to }) {
        const snapshot = yield* log.snapshot;
        const before = yield* findCall(snapshot, from);
        const after = yield* findCall(snapshot, to);

        return { changes: diff(comparableOf(before), comparableOf(after)) };
      })
    ),
    implement(
      ratListActors,
      Effect.fn("Devtools.listActors")(function* listActorsHandler({
        machine,
      }) {
        const snapshot = yield* actors.snapshot;

        return {
          actors: latestActors(snapshot).filter(
            (actor) => machine === undefined || actor.machine === machine
          ),
          firstIndex: snapshot.firstIndex,
          nextIndex: snapshot.nextIndex,
        };
      })
    ),
    implement(
      ratListTransitions,
      Effect.fn("Devtools.listTransitions")(function* listTransitionsHandler({
        actorId,
        fromEnd,
        limit,
        machine,
        sinceIndex,
      }) {
        const { entries, firstIndex, nextIndex } = yield* actors.snapshot;
        const size = limit ?? DEFAULT_LIST_LIMIT;

        const matching = entries.filter(
          (entry) =>
            (actorId === undefined || entry.actorId === actorId) &&
            (machine === undefined || entry.machine === machine) &&
            (sinceIndex === undefined || entry.index >= sinceIndex)
        );

        const page =
          fromEnd === true ? matching.slice(-size) : matching.slice(0, size);

        return {
          entries: yield* Effect.forEach(encodeActorEntry)(page),
          firstIndex,
          matched: matching.length,
          nextIndex,
        };
      })
    ),
    implement(
      ratGetActor,
      Effect.fn("Devtools.getActor")(function* getActorHandler({
        actorId,
        expand,
        path,
      }) {
        const snapshot = yield* actors.snapshot;
        const known = latestActors(snapshot);
        const actor = known.find((candidate) => candidate.actorId === actorId);

        const entry = snapshot.entries.findLast(
          (candidate) => candidate.actorId === actorId
        );

        if (actor === undefined || entry === undefined) {
          return yield* new ActorNotFound({
            actorId,
            available: known.map((candidate) => candidate.actorId),
          });
        }

        const encoded = yield* toJson(ActorEntrySchema, entry);
        const value = yield* readPath(encoded, path ?? ROOT);

        return { value: expand === true ? value : summarize(value) };
      })
    ),
  ] as const;
};

export const devtools = <const Caps extends readonly AnyCapability[]>(
  capabilities: Caps
) =>
  Effect.gen(function* buildDevtools() {
    const log = yield* CallLog;
    const actors = yield* ActorLog;
    const watcher = yield* actorWatcher;
    const recorded = aroundHandlers(capabilities, recorder(log, watcher));
    const tools = toolsFor(recorded, log, actors);

    return {
      capabilities: [...recorded, ...tools] as const,
      recorded,
      tools,
    };
  });

export const devtoolsLayer = (capacity?: number) =>
  Layer.mergeAll(CallLog.layer(capacity), ActorLog.layer(capacity));
