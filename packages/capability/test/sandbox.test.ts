// @effect-diagnostics-next-line nodeBuiltinImport:off -- This integration test needs a real loopback socket; `NodeHttpServer.layer` accepts the Node server factory.
import { createServer } from "node:http";

import {
  NodeHttpClient,
  NodeHttpServer,
  NodeServices,
} from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Schema } from "effect";
import {
  HttpClient,
  HttpServer,
  HttpServerResponse,
} from "effect/unstable/http";

import { Sandbox, invokeFailure } from "../src/sandbox-service.js";
import type { Invoke } from "../src/sandbox-service.js";
import { layerSubprocess } from "../src/sandbox-subprocess.js";

const TestLayer = Layer.provide(
  layerSubprocess({ timeout: "5 seconds" }),
  NodeServices.layer
);

const decodeDouble = Schema.decodeUnknownOption(
  Schema.Struct({ n: Schema.Finite })
);

const invoke: Invoke = (name, input) =>
  Effect.succeed(
    Option.match(name === "double" ? decodeDouble(input) : Option.none(), {
      onNone: () => invokeFailure("UnknownCapability", `no ${name}`),
      onSome: ({ n }) => ({ ok: true, value: { doubled: n * 2 } }),
    })
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

    test.effect("does not expose filesystem or child-process modules", () =>
      Effect.gen(function* deniesAccess() {
        const sandbox = yield* Sandbox;

        const run = yield* sandbox.run(
          `const access = []; for (const name of ["node:fs", "node:child_process"]) { try { await import(name); access.push("allowed"); } catch { access.push("blocked"); } } return access;`,
          invoke
        );

        expect(run.result).toEqual(["blocked", "blocked"]);
      })
    );

    test.effect("does not expose the parent's environment", () =>
      Effect.gen(function* hidesParentEnvironment() {
        const key = "RAT_STACK_SANDBOX_PARENT_SENTINEL";
        const previous = process.env[key];
        process.env[key] = "parent-only-value";
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            if (previous === undefined) {
              delete process.env.RAT_STACK_SANDBOX_PARENT_SENTINEL;
            } else {
              process.env[key] = previous;
            }
          })
        );

        const sandbox = yield* Sandbox;

        const run = yield* sandbox.run(
          `return typeof process === "undefined" ? "unavailable" : process.env["${key}"] ?? null;`,
          invoke
        );

        expect(run.result).toBe("unavailable");
      })
    );

    test.effect("blocks constructor chains into the child process", () =>
      Effect.gen(function* blocksConstructorEscape() {
        const sandbox = yield* Sandbox;

        const run = yield* sandbox.run(
          `const pending = tools.double({ n: 1 }); const value = await tools.double({ n: 1 }); let failure; try { await tools.nothing({}); } catch (error) { failure = error; } const probes = []; for (const target of [console.log, pending, value, failure]) { try { probes.push(target.constructor.constructor("return process")().version); } catch { probes.push("blocked"); } } return probes;`,
          invoke
        );

        expect(run.result).toEqual([
          "blocked",
          "blocked",
          "blocked",
          "blocked",
        ]);
      })
    );

    test.effect("does not complete a request to a local HTTP server", () => {
      let requests = 0;

      const loopbackServer = HttpServer.serve(
        Effect.sync(() => {
          requests += 1;

          return HttpServerResponse.text("reachable");
        })
      ).pipe(
        Layer.provideMerge(
          NodeHttpServer.layer(() => createServer(), {
            host: "127.0.0.1",
            port: 0,
          })
        )
      );

      const layer = Layer.mergeAll(loopbackServer, NodeHttpClient.layerFetch);

      return Effect.gen(function* deniesNetwork() {
        const server = yield* HttpServer.HttpServer;
        const url = HttpServer.formatAddress(server.address);
        const control = yield* HttpClient.get(url);
        expect(control.status).toBe(200);
        yield* control.text;
        expect(requests).toBe(1);
        requests = 0;

        const sandbox = yield* Sandbox;

        const error = yield* sandbox
          .run(
            `await fetch(${JSON.stringify(url)}); return "reachable";`,
            invoke
          )
          .pipe(Effect.flip);

        expect(error.reason).toBe("threw");
        expect(requests).toBe(0);
      }).pipe(Effect.provide(layer));
    });

    test.effect(
      "rejects module imports without exposing the host process",
      () =>
        Effect.gen(function* rejectsImportEscape() {
          const sandbox = yield* Sandbox;

          const run = yield* sandbox.run(
            `try { await import("node:http"); return "imported"; } catch (error) { try { return error.constructor.constructor("return process")().version; } catch { return "blocked"; } }`,
            invoke
          );

          expect(run.result).toBe("blocked");
        })
    );

    test.effect("flushes a multi-megabyte result before child exit", () =>
      Effect.gen(function* flushesLargeResult() {
        const sandbox = yield* Sandbox;
        const expected = "rat".repeat(1_750_000);
        const run = yield* sandbox.run(`return "rat".repeat(1750000);`, invoke);

        expect(run.result).toBe(expected);
      })
    );
  });

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
