import { Sandbox, SandboxError } from "@rat-stack/capability/sandbox";
import { Effect, Layer, Schema } from "effect";

const SearchWire = Schema.Struct({
  matches: Schema.Array(Schema.Struct({ id: Schema.String })),
});

const ReadWire = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  title: Schema.String,
});

const protocolError = (message: string) =>
  new SandboxError({ logs: [], message, reason: "protocol" });

const unwrap = (outcome: {
  readonly ok: boolean;
  readonly value?: unknown;
  readonly error?: unknown;
}) =>
  outcome.ok
    ? Effect.succeed(outcome.value)
    : Effect.fail(protocolError(`Capability failed: ${String(outcome.error)}`));

export const TestSandbox = Layer.succeed(Sandbox, {
  run: (code, invoke) =>
    Effect.gen(function* runTestProgram() {
      if (!(code.includes("tools.search") && code.includes("tools.read"))) {
        return yield* protocolError(
          "Test program must call search and then read"
        );
      }

      const searched = yield* invoke("search", {
        limit: 1,
        query: "capability",
      }).pipe(Effect.flatMap(unwrap));

      const searchResult = yield* Schema.decodeUnknownEffect(SearchWire)(
        searched
      ).pipe(Effect.mapError((error) => protocolError(error.message)));

      const id = searchResult.matches[0]?.id;

      if (id === undefined) {
        return yield* protocolError("Search returned no matches");
      }

      const read = yield* invoke("read", { id }).pipe(Effect.flatMap(unwrap));

      const resource = yield* Schema.decodeUnknownEffect(ReadWire)(read).pipe(
        Effect.mapError((error) => protocolError(error.message))
      );

      const result = code.includes("tools.neighbors")
        ? yield* invoke("neighbors", { depth: 1, slug: "cartridges" }).pipe(
            Effect.flatMap(unwrap)
          )
        : resource;

      return {
        logs: ["test: search then read"],
        result,
      };
    }),
});
