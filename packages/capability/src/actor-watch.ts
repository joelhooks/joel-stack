import { Context, Effect } from "effect";
import type { Scope } from "effect";

export interface ActorEvent {
  readonly type: string;
}

export interface ActorSnapshot {
  readonly status: string;
}

export interface WatchableActor {
  readonly sessionId?: string | undefined;
  readonly getSnapshot: () => ActorSnapshot;
  readonly inspect: (observer: (event: ActorEvent) => void) => {
    readonly unsubscribe: () => void;
  };
}

export interface ActorWatchService {
  readonly watch: (
    machine: string,
    actor: WatchableActor
  ) => Effect.Effect<void, never, Scope.Scope>;
}

export const ActorWatch = Context.Reference<ActorWatchService>(
  "@rat-stack/capability/ActorWatch",
  { defaultValue: () => ({ watch: () => Effect.void }) }
);

export const watchActor = Effect.fnUntraced(function* watchActor(
  machine: string,
  actor: WatchableActor
) {
  const watcher = yield* ActorWatch;

  yield* watcher.watch(machine, actor);
});
