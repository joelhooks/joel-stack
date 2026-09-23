// Node implementation of Sandbox: a fresh process under `--permission`
// speaks newline-delimited JSON over stdio. Network egress is not blocked by
// Node's permission model; use a Worker-side implementation for real isolation.
import { Duration, Effect, Layer, Option, Queue, Schema, Stream } from "effect";
import type { Cause } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

import { SandboxError } from "./sandbox-error.js";
import { Sandbox } from "./sandbox-service.js";
import type { Invoke, InvokeOutcome, SandboxRun } from "./sandbox-service.js";

/**
 * The program the child runs, passed with `-e` so the permission model never
 * has to allow a file read. Protocol, one JSON object per line:
 *
 *   parent -> child  { type: "run", code }
 *   child  -> parent { type: "call", id, name, input }
 *   parent -> child  { type: "result", id, ok, value | error }
 *   child  -> parent { type: "done", result, logs } | { type: "error", message, logs }
 *
 * `console` inside the program is a capture; the real one is unavailable.
 */
const RUNNER_SOURCE = String.raw`
import { createInterface } from "node:readline";
const pending = new Map();
const logs = [];
let nextId = 1;
const send = (message) => process.stdout.write(JSON.stringify(message) + "\n");
const capture = (level) => (...parts) =>
  logs.push(level + ": " + parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" "));
const console = { debug: capture("debug"), error: capture("error"), info: capture("info"), log: capture("log"), warn: capture("warn") };
const tools = new Proxy({}, {
  get: (_target, name) => (input) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      send({ type: "call", id, name: String(name), input: input === undefined ? {} : input });
    }),
});
const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
const rl = createInterface({ input: process.stdin });
rl.on("line", async (line) => {
  if (line.trim() === "") return;
  const message = JSON.parse(line);
  if (message.type === "result") {
    const waiter = pending.get(message.id);
    pending.delete(message.id);
    if (waiter === undefined) return;
    if (message.ok) waiter.resolve(message.value);
    else {
      const error = new Error((message.error && message.error.message) || "capability failed");
      Object.assign(error, message.error);
      waiter.reject(error);
    }
    return;
  }
  if (message.type === "run") {
    try {
      const program = new AsyncFunction("tools", "console", message.code);
      const result = await program(tools, console);
      send({ type: "done", result: result === undefined ? null : result, logs });
    } catch (error) {
      send({ type: "error", message: error instanceof Error ? error.message : String(error), logs });
    }
    process.exit(0);
  }
});
`;

const ChildMessage = Schema.Union([
  Schema.Struct({
    id: Schema.Finite,
    input: Schema.Unknown,
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

const encoder = new TextEncoder();

const isSandboxError = Schema.is(SandboxError);

export interface SubprocessOptions {
  /** Wall-clock budget for one program; the process is killed after. */
  readonly timeout?: Duration.Input | undefined;
  /** Node executable; defaults to the current one. */
  readonly nodePath?: string | undefined;
}

const makeSubprocess = (options?: SubprocessOptions) =>
  Effect.gen(function* makeSubprocessSandbox() {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const timeout = Duration.fromInputUnsafe(options?.timeout ?? "10 seconds");
    const nodePath = options?.nodePath ?? process.execPath;

    const command = ChildProcess.make(nodePath, [
      "--permission",
      "--input-type=module",
      "-e",
      RUNNER_SOURCE,
    ]);

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

      const send = (message: unknown) =>
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

/** A Sandbox backed by a fresh Node subprocess per run. */
export const layerSubprocess = (
  options?: SubprocessOptions
): Layer.Layer<Sandbox, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Layer.effect(Sandbox, makeSubprocess(options));
