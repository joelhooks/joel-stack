import { Clock, Context, Effect, Layer, Ref, Schema } from "effect";

export const AtomSnapshotSchema = Schema.Struct({
  key: Schema.String,
  state: Schema.String,
  value: Schema.Json,
});

export type AtomSnapshot = typeof AtomSnapshotSchema.Type;

export const TabSchema = Schema.Struct({
  atoms: Schema.Array(AtomSnapshotSchema),
  tabId: Schema.String,
  updatedAt: Schema.Int,
});

export type Tab = typeof TabSchema.Type;

export const MAX_TABS = 20;

const makeAtomLog = Effect.gen(function* buildAtomLog() {
  const state = yield* Ref.make<{
    readonly nextTab: number;
    readonly tabs: readonly Tab[];
  }>({ nextTab: 1, tabs: [] });

  const report = (tabId: string | undefined, atoms: readonly AtomSnapshot[]) =>
    Effect.gen(function* reportAtoms() {
      const updatedAt = yield* Clock.currentTimeMillis;

      return yield* Ref.modify(state, ({ nextTab, tabs }) => {
        const id = tabId ?? `tab-${nextTab}`;
        const others = tabs.filter((tab) => tab.tabId !== id);

        return [
          id,
          {
            nextTab: tabId === undefined ? nextTab + 1 : nextTab,
            tabs: [...others, { atoms, tabId: id, updatedAt }].slice(-MAX_TABS),
          },
        ] as const;
      });
    });

  const tabs = Ref.get(state).pipe(Effect.map((current) => current.tabs));

  return { report, tabs } as const;
});

export class AtomLog extends Context.Service<
  AtomLog,
  {
    readonly report: (
      tabId: string | undefined,
      atoms: readonly AtomSnapshot[]
    ) => Effect.Effect<string>;
    readonly tabs: Effect.Effect<readonly Tab[]>;
  }
>()("@rat-stack/devtools/AtomLog") {
  static readonly layer = Layer.effect(this, makeAtomLog);
}
