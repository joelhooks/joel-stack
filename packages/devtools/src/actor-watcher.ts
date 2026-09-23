import type {
  ActorEvent,
  ActorWatchService,
  WatchableActor,
} from "@rat-stack/capability/actor-watch";
import { Clock, Effect, Option, Queue, Schema } from "effect";

import { ActorLog } from "./actor-log.js";
import type { NewActorEntry } from "./actor-log.js";

const ChildSchema = Schema.Struct({
  sessionId: Schema.optional(Schema.String),
  src: Schema.optional(Schema.Unknown),
});

const SnapshotSchema = Schema.Struct({
  children: Schema.optional(Schema.Record(Schema.String, ChildSchema)),
  context: Schema.optional(Schema.Unknown),
  status: Schema.optional(Schema.String),
  value: Schema.optional(Schema.Unknown),
});

const InspectionSchema = Schema.Struct({
  actorRef: Schema.Struct({ sessionId: Schema.optional(Schema.String) }),
  event: Schema.optional(Schema.Unknown),
  eventType: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  reason: Schema.optional(Schema.String),
  rootId: Schema.String,
  snapshot: Schema.optional(SnapshotSchema),
  src: Schema.optional(Schema.Unknown),
  type: Schema.Literals([
    "@xstate.actor",
    "@xstate.transition",
    "@xstate.deadletter",
  ]),
});

const decodeInspection = Schema.decodeUnknownOption(InspectionSchema);

const decodeSnapshot = Schema.decodeUnknownOption(SnapshotSchema);

const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- Machine context, state values, and events are user-defined and erased at the XState inspection boundary; turning them into JSON is this function's job.
const jsonOf = (value: unknown) =>
  Effect.try(() => JSON.stringify(value) ?? "null").pipe(
    Effect.flatMap(decodeJson),
    Effect.orElseSucceed((): Schema.Json => ({ unencodable: true }))
  );

const kindOf = {
  "@xstate.actor": "started",
  "@xstate.deadletter": "deadletter",
  "@xstate.transition": "transition",
} as const;

const makeWatcher = (log: ActorLog["Service"]): ActorWatchService => ({
  watch: (machine: string, actor: WatchableActor) =>
    Effect.gen(function* watchActor() {
      const names = new Map<string, string>();
      const queue = yield* Queue.unbounded<ActorEvent>();

      const learnChildren = (
        snapshot: typeof SnapshotSchema.Type | undefined
      ) => {
        for (const [key, child] of Object.entries(snapshot?.children ?? {})) {
          if (child.sessionId !== undefined) {
            names.set(
              child.sessionId,
              Schema.is(Schema.String)(child.src) ? child.src : key
            );
          }
        }
      };

      const entryOf = Effect.fnUntraced(function* entryOf(
        raw: ActorEvent,
        at: number
      ) {
        const inspection = decodeInspection(raw);

        if (Option.isNone(inspection)) {
          return Option.none<NewActorEntry>();
        }

        const {
          actorRef,
          event,
          eventType,
          id,
          reason,
          rootId,
          snapshot,
          src,
          type,
        } = inspection.value;

        const actorId = actorRef.sessionId ?? rootId;

        learnChildren(snapshot);

        if (type === "@xstate.actor" && actorId !== rootId) {
          names.set(
            actorId,
            Schema.is(Schema.String)(src) ? src : (id ?? "child")
          );
        }

        return Option.some<NewActorEntry>({
          actorId,
          at,
          context: yield* jsonOf(snapshot?.context),
          event: yield* jsonOf(event),
          eventType: eventType ?? reason ?? type,
          kind: kindOf[type],
          machine:
            actorId === rootId ? machine : (names.get(actorId) ?? machine),
          rootId,
          state: yield* jsonOf(snapshot?.value),
          status: snapshot?.status ?? "active",
        });
      });

      const record = Effect.fnUntraced(function* record(raw: ActorEvent) {
        const at = yield* Clock.currentTimeMillis;
        const entry = yield* entryOf(raw, at);

        if (Option.isSome(entry)) {
          yield* log.append(entry.value);
        }
      });

      const drain = Queue.clear(queue).pipe(
        Effect.flatMap(Effect.forEach(record)),
        Effect.ignore
      );

      yield* Effect.acquireRelease(
        Effect.sync(() =>
          actor.inspect((event) => {
            Queue.offerUnsafe(queue, event);
          })
        ),
        (subscription) =>
          Effect.sync(() => {
            subscription.unsubscribe();
          }).pipe(Effect.andThen(drain))
      );

      const initial = decodeSnapshot(actor.getSnapshot());

      learnChildren(Option.getOrUndefined(initial));
      const rootId = actor.sessionId ?? machine;
      const startedAt = yield* Clock.currentTimeMillis;

      yield* log.append({
        actorId: rootId,
        at: startedAt,
        context: yield* jsonOf(Option.getOrUndefined(initial)?.context),
        event: null,
        eventType: "@rat.watch",
        kind: "started",
        machine,
        rootId,
        state: yield* jsonOf(Option.getOrUndefined(initial)?.value),
        status: Option.getOrUndefined(initial)?.status ?? "active",
      });

      yield* Effect.forkScoped(
        Effect.forever(Queue.take(queue).pipe(Effect.flatMap(record)))
      );
    }),
});

export const actorWatcher = Effect.gen(function* actorWatcher() {
  const log = yield* ActorLog;

  return makeWatcher(log);
});
