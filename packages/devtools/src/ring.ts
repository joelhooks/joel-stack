import { Effect, Ref } from "effect";

export interface RingSnapshot<Entry> {
  readonly entries: readonly Entry[];
  readonly firstIndex: number;
  readonly nextIndex: number;
}

export const DEFAULT_CAPACITY = 500;

export const boundedLog = <Entry extends { readonly index: number }>(
  capacity: number
) =>
  Effect.gen(function* buildRing() {
    const state = yield* Ref.make<{
      readonly entries: readonly Entry[];
      readonly nextIndex: number;
    }>({ entries: [], nextIndex: 0 });

    const append = (build: (index: number) => Entry) =>
      Ref.modify(state, ({ entries, nextIndex }) => {
        const entry = build(nextIndex);

        return [
          entry,
          {
            entries: [...entries, entry].slice(-capacity),
            nextIndex: nextIndex + 1,
          },
        ] as const;
      });

    const snapshot = Ref.get(state).pipe(
      Effect.map(({ entries, nextIndex }): RingSnapshot<Entry> => ({
        entries,
        firstIndex: entries.at(0)?.index ?? nextIndex,
        nextIndex,
      }))
    );

    return { append, snapshot } as const;
  });
