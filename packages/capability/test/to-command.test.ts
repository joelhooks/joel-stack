import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { TestConsole } from "effect/testing";
import { CliOutput, Command } from "effect/unstable/cli";

import { ApprovalDenied, toCommand } from "../src/index.js";
import { Greeter, approved, echo, greet, shape } from "./fixtures.js";

const TestLayer = Layer.mergeAll(
  TestConsole.layer,
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  Greeter.layer
).pipe(Layer.provideMerge(NodeServices.layer));

const run = <const Name extends string, Input, E, R, ContextInput>(
  command: Command.Command<Name, Input, ContextInput, E, R>,
  args: readonly string[]
) => Command.runWith(command, { version: "0.0.0" })(args);

const lastLine = TestConsole.logLines.pipe(
  Effect.map((lines) => String(lines.at(-1)))
);

describe("toCommand", () => {
  it.layer(TestLayer)("flags from the input struct", (test) => {
    test.effect("maps fields to flags and prints encoded JSON", () =>
      Effect.gen(function* mapsFields() {
        yield* run(toCommand(echo), ["--text", "hi", "--times", "2"]);
        expect(JSON.parse(yield* lastLine)).toEqual({ text: "hihi" });
      })
    );

    test.effect("lets optional fields be omitted", () =>
      Effect.gen(function* optionalFields() {
        yield* run(toCommand(echo), ["--text", "hi"]);
        expect(JSON.parse(yield* lastLine)).toEqual({ text: "hi" });
      })
    );

    test.effect("handles booleans, literals, and JSON-valued fields", () =>
      Effect.gen(function* otherKinds() {
        yield* run(toCommand(shape), [
          "--enabled",
          "--mode",
          "slow",
          "--tags",
          '["a","b"]',
        ]);
        expect(JSON.parse(yield* lastLine)).toEqual({
          enabled: true,
          mode: "slow",
          tags: ["a", "b"],
        });
      })
    );
  });

  it.layer(TestLayer)("positional arguments and rendering", (test) => {
    const command = toCommand(greet, {
      positional: ["name"],
      render: (output) => `>> ${output.greeting}`,
    });

    test.effect("renders through the supplied function", () =>
      Effect.gen(function* renders() {
        yield* run(command, ["rat"]);
        expect(yield* lastLine).toBe(">> hello rat");
      })
    );

    test.effect("switches back to JSON with --json", () =>
      Effect.gen(function* jsonFlag() {
        yield* run(command, ["rat", "--json"]);
        expect(JSON.parse(yield* lastLine)).toEqual({ greeting: "hello rat" });
      })
    );

    test.effect("keeps the capability's failure typed", () =>
      Effect.gen(function* failure() {
        const error = yield* run(command, ["nobody"]).pipe(Effect.flip);
        expect(error._tag).toBe("NotFound");
      })
    );

    test.effect("denies gated commands unless --yes is explicit", () =>
      Effect.gen(function* approval() {
        const denied = yield* run(toCommand(approved), [
          "--message",
          "run",
        ]).pipe(Effect.flip);

        expect(denied).toBeInstanceOf(ApprovalDenied);
        yield* run(toCommand(approved), ["--message", "run", "--yes"]);
      })
    );
  });
});
