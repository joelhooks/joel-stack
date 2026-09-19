import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";

import { Sandbox, layerSubprocess } from "../src/sandbox.js";
import type { Invoke } from "../src/sandbox.js";

const TestLayer = Layer.provide(
  layerSubprocess({ timeout: "5 seconds" }),
  NodeServices.layer
);

const invoke: Invoke = (name, input) =>
  Effect.succeed(
    name === "double" &&
      typeof input === "object" &&
      input !== null &&
      "n" in input
      ? { ok: true, value: { doubled: Number(input.n) * 2 } }
      : {
          error: { _tag: "UnknownCapability", message: `no ${name}` },
          ok: false,
        }
  );

describe("subprocess Sandbox", () => {
  it.layer(TestLayer)("runs model code against tools", (test) => {
    test.effect("returns the program's value and captured logs", () =>
      Effect.gen(function* returnsValue() {
        const sandbox = yield* Sandbox;
        const run = yield* sandbox.run(
          `console.log("start", 1); const a = await tools.double({ n: 2 }); return a.doubled + 1;`,
          invoke
        );

        expect(run.result).toBe(5);
        expect(run.logs).toEqual(["log: start 1"]);
      })
    );

    test.effect("lets the program catch a capability failure", () =>
      Effect.gen(function* catchesFailure() {
        const sandbox = yield* Sandbox;
        const run = yield* sandbox.run(
          `try { await tools.nothing({}); } catch (error) { return error._tag; }`,
          invoke
        );

        expect(run.result).toBe("UnknownCapability");
      })
    );

    test.effect("reports a thrown error with reason threw", () =>
      Effect.gen(function* reportsThrow() {
        const sandbox = yield* Sandbox;
        const error = yield* sandbox
          .run(`throw new Error("boom")`, invoke)
          .pipe(Effect.flip);

        expect(error.reason).toBe("threw");
        expect(error.message).toBe("boom");
      })
    );

    test.effect("denies file system and child process access", () =>
      Effect.gen(function* deniesAccess() {
        const sandbox = yield* Sandbox;
        const run = yield* sandbox.run(
          `const codes = []; for (const name of ["node:fs", "node:child_process"]) { try { const m = await import(name); (m.readFileSync ?? m.execSync)("/etc/hosts"); codes.push("allowed"); } catch (error) { codes.push(error.code); } } return codes;`,
          invoke
        );

        expect(run.result).toEqual(["ERR_ACCESS_DENIED", "ERR_ACCESS_DENIED"]);
      })
    );
  });

  // `it.effect` and `it.layer` run on the TestClock, where a timeout never
  // fires on its own; the child process is real, so this one runs live.
  it.live("kills a runaway program with reason timeout", () =>
    Effect.gen(function* timesOut() {
      const sandbox = yield* Sandbox;
      const error = yield* sandbox.run(`for (;;) {}`, invoke).pipe(Effect.flip);

      expect(error.reason).toBe("timeout");
    }).pipe(
      Effect.provide(
        Layer.provide(
          layerSubprocess({ timeout: "300 millis" }),
          NodeServices.layer
        )
      )
    )
  );
});
