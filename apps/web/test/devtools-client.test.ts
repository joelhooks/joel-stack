import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import * as Atom from "effect/unstable/reactivity/Atom";
import * as AtomRegistry from "effect/unstable/reactivity/AtomRegistry";

import { snapshotOf } from "../src/dev/client/devtools.js";

it.effect("reports keyed and labeled atoms, and skips anonymous ones", () =>
  Effect.gen(function* reportsNamedAtoms() {
    const registry = AtomRegistry.make();

    const count = Atom.make(1).pipe(
      Atom.serializable({ key: "count", schema: Schema.Finite })
    );

    const greeting = Atom.make("hello").pipe(Atom.withLabel("greeting"));
    const hidden = Atom.make(true);

    const unmounts = [
      registry.mount(count),
      registry.mount(greeting),
      registry.mount(hidden),
    ];

    yield* Effect.addFinalizer(() =>
      Effect.sync(() => {
        for (const unmount of unmounts) {
          unmount();
        }
      })
    );

    expect(snapshotOf(registry)).toEqual([
      { key: "count", state: "valid", value: 1 },
      { key: "greeting", state: "valid", value: "hello" },
    ]);
  })
);
