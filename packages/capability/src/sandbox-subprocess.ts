import { Duration, Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import type { Cause } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { SandboxError } from "./sandbox-error.js";
import { Sandbox } from "./sandbox-service.js";
import type { Invoke, InvokeOutcome, SandboxRun } from "./sandbox-service.js";

const RUNNER_SOURCE = String.raw`
import { createInterface } from "node:readline";
import { createContext, Script } from "node:vm";
const logs = [];
const send = (message) => new Promise((resolve, reject) => {
  process.stdout.write(JSON.stringify(message) + "\n", (error) => {
    if (error) reject(error);
    else resolve();
  });
});
const context = createContext(Object.create(null), {
  codeGeneration: { strings: false, wasm: false },
  microtaskMode: "afterEvaluate",
});
context.__hostCall = (id, name, input) => {
  send({ type: "call", id, name, input: JSON.parse(input) }).catch(() => {
    process.exitCode = 1;
  });
};
context.__hostLog = (level, text) => {
  logs.push(level + ": " + text);
};
context.__hostDone = (encoded) => {
  const outcome = JSON.parse(encoded);
  send({ ...outcome, logs }).then(
    () => process.exit(0),
    () => {
      process.exitCode = 1;
    }
  );
};
const bridge = new Script([
  "(() => {",
  "  const hostCall = globalThis.__hostCall;",
  "  const hostLog = globalThis.__hostLog;",
  "  const hostDone = globalThis.__hostDone;",
  "  delete globalThis.__hostCall;",
  "  delete globalThis.__hostLog;",
  "  delete globalThis.__hostDone;",
  "  const parse = JSON.parse;",
  "  const stringify = JSON.stringify;",
  "  const ContextError = Error;",
  "  const assign = Object.assign;",
  "  const pending = new Map();",
  "  let nextId = 1;",
  "  const tools = new Proxy(Object.create(null), {",
  "    get: (_target, name) => {",
  '      if (typeof name !== "string") return undefined;',
  "      return (input) => new Promise((resolve, reject) => {",
  "        const id = nextId++;",
  "        pending.set(id, { resolve, reject });",
  "        hostCall(id, name, stringify(input === undefined ? {} : input));",
  "      });",
  "    },",
  "  });",
  '  const capture = (level) => (...parts) => hostLog(level, parts.map((part) => typeof part === "string" ? part : stringify(part)).join(" "));',
  '  const console = Object.freeze({ debug: capture("debug"), error: capture("error"), info: capture("info"), log: capture("log"), warn: capture("warn") });',
  "  const deliver = (id, encoded) => {",
  "    const waiter = pending.get(id);",
  "    pending.delete(id);",
  "    if (waiter === undefined) return;",
  "    const message = parse(encoded);",
  "    if (message.ok) waiter.resolve(message.value);",
  "    else {",
  '      const error = new ContextError((message.error && message.error.message) || "capability failed");',
  "      assign(error, message.error);",
  "      waiter.reject(error);",
  "    }",
  "  };",
  "  const execute = async (program) => {",
  "    try {",
  "      const result = await program(tools, console);",
  '      hostDone(stringify({ type: "done", result: result === undefined ? null : result }));',
  "    } catch (error) {",
  '      hostDone(stringify({ type: "error", message: error instanceof Error ? error.message : String(error) }));',
  "    }",
  "  };",
  "  return { tools, console, deliver, execute };",
  "})()",
].join(String.fromCharCode(10))).runInContext(context);
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (line.trim() === "") return;
  const message = JSON.parse(line);
  if (message.type === "result") {
    bridge.deliver(message.id, JSON.stringify(message));
    new Script("void 0").runInContext(context);
    return;
  }
  if (message.type !== "run") return;
  try {
    const program = new Script("(async function(tools, console) {" + String.fromCharCode(10) + message.code + String.fromCharCode(10) + "})").runInContext(context);
    bridge.execute(program);
    new Script("void 0").runInContext(context);
  } catch (error) {
    const outcome = {
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    };
    send({ ...outcome, logs }).then(
      () => process.exit(0),
      () => {
        process.exitCode = 1;
      }
    );
  }
});
`;

const ChildMessage = Schema.Union([
  Schema.Struct({
    id: Schema.Finite,
    input: Schema.Json,
    name: Schema.String,
    type: Schema.Literal("call"),
  }),
  Schema.Struct({
    logs: Schema.Array(Schema.String),
    result: Schema.Unknown,
    type: Schema.Literal("done"),
  }),
  Schema.Struct({
    logs: Schema.Array(Schema.String),
    message: Schema.String,
    type: Schema.Literal("error"),
  }),
]);

const decodeChildMessage = Schema.decodeUnknownEffect(
  Schema.fromJsonString(ChildMessage)
);

type HostMessage =
  | { readonly code: string; readonly type: "run" }
  | ({ readonly id: number; readonly type: "result" } & InvokeOutcome);

const encoder = new TextEncoder();

const isSandboxError = Schema.is(SandboxError);

export interface SubprocessOptions {
  readonly timeout?: Duration.Input | undefined;
  readonly nodePath?: string | undefined;
}

const makeSubprocess = (options?: SubprocessOptions) =>
  Effect.gen(function* makeSubprocessSandbox() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const timeout = Duration.fromInputUnsafe(options?.timeout ?? "10 seconds");
    const nodePath = options?.nodePath ?? process.execPath;

    const command = ChildProcess.make(
      nodePath,
      [
        "--permission",
        "--disallow-code-generation-from-strings",
        "--input-type=module",
        "-e",
        RUNNER_SOURCE,
      ],
      { env: {}, extendEnv: false }
    );

    const run = Effect.fn("Sandbox.run")(function* run(
      code: string,
      invoke: Invoke
    ) {
      const handle = yield* spawner.spawn(command).pipe(
        Effect.mapError(
          (error) =>
            new SandboxError({
              logs: [],
              message: error.message,
              reason: "exited",
            })
        )
      );

      const outbox = yield* Queue.unbounded<Uint8Array, Cause.Done>();
      yield* Stream.fromQueue(outbox).pipe(
        Stream.run(handle.stdin),
        Effect.ignore,
        Effect.forkScoped
      );

      const send = (message: HostMessage) =>
        Queue.offer(outbox, encoder.encode(`${JSON.stringify(message)}\n`));

      yield* send({ code, type: "run" });

      const outcome = yield* Stream.decodeText(handle.stdout).pipe(
        Stream.splitLines,
        Stream.filter((line) => line.trim() !== ""),
        Stream.mapEffect((line) =>
          decodeChildMessage(line).pipe(
            Effect.mapError(
              (error) =>
                new SandboxError({
                  logs: [],
                  message: `Unreadable sandbox message: ${error.message}`,
                  reason: "protocol",
                })
            ),
            Effect.flatMap((message) => {
              if (message.type === "call") {
                return invoke(message.name, message.input).pipe(
                  Effect.flatMap((result: InvokeOutcome) =>
                    send({ id: message.id, type: "result", ...result })
                  ),
                  Effect.andThen(Effect.succeedNone)
                );
              }

              return Effect.succeedSome<SandboxRun | SandboxError>(
                message.type === "done"
                  ? { logs: message.logs, result: message.result }
                  : new SandboxError({
                      logs: message.logs,
                      message: message.message,
                      reason: "threw",
                    })
              );
            })
          )
        ),
        Stream.filter(Option.isSome),
        Stream.map((option) => option.value),
        Stream.runHead,
        Effect.mapError((error) =>
          isSandboxError(error)
            ? error
            : new SandboxError({
                logs: [],
                message: error.message,
                reason: "exited",
              })
        )
      );

      if (Option.isNone(outcome)) {
        return yield* new SandboxError({
          logs: [],
          message: "The sandbox exited before finishing the program",
          reason: "exited",
        });
      }

      if (isSandboxError(outcome.value)) {
        return yield* outcome.value;
      }

      return outcome.value;
    }, Effect.scoped);

    return {
      run: (code: string, invoke: Invoke) =>
        run(code, invoke).pipe(
          Effect.timeoutOrElse({
            duration: timeout,
            orElse: () =>
              Effect.fail(
                new SandboxError({
                  logs: [],
                  message: `The program did not finish within ${Duration.format(timeout)}`,
                  reason: "timeout",
                })
              ),
          })
        ),
    } as const;
  });

export const layerSubprocess = (
  options?: SubprocessOptions
): Layer.Layer<Sandbox, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(Sandbox, makeSubprocess(options));
