// oxlint-disable-next-line typescript/triple-slash-reference -- The Worker runtime module has no Node-resolvable declaration of its own.
/// <reference path="./cloudflare-workers.d.ts" />

import {
  Sandbox,
  SandboxError,
  invokeFailure,
} from "@rat-stack/capability/sandbox";
import type {
  Invoke,
  InvokeOutcome,
  SandboxRun,
} from "@rat-stack/capability/sandbox";
import type { RpcTarget as RpcTargetType } from "cloudflare:workers";
import { Duration, Effect, Layer, Option, Schema } from "effect";

interface ReleasableStub {
  readonly [Symbol.dispose]?: () => void;
}

export interface DynamicWorkerEntrypoint extends ReleasableStub {
  readonly run: (dispatcher: RpcTargetType) => Promise<GuestOutcomeWire>;
}

export interface DynamicWorker extends ReleasableStub {
  readonly getEntrypoint: () => DynamicWorkerEntrypoint;
}

export interface WorkerLoaderBinding {
  readonly load: (code: {
    readonly compatibilityDate: string;
    readonly globalOutbound: null;
    readonly limits: {
      readonly cpuMs: number;
      readonly subRequests: number;
    };
    readonly mainModule: string;
    readonly modules: Readonly<Record<string, string>>;
  }) => DynamicWorker;
}

export interface WorkerLoaderSandboxOptions {
  readonly compatibilityDate?: string | undefined;
  readonly cpuMs?: number | undefined;
  readonly subRequests?: number | undefined;
  readonly timeout?: Duration.Input | undefined;
}

const timeoutMessage = "__RATSTACK_SANDBOX_TIMEOUT__";

const GuestOutcome = Schema.Union([
  Schema.Struct({
    logs: Schema.Array(Schema.String),
    ok: Schema.Literal(true),
    result: Schema.Unknown,
  }),
  Schema.Struct({
    logs: Schema.Array(Schema.String),
    message: Schema.String,
    ok: Schema.Literal(false),
    timeout: Schema.Boolean,
  }),
]);

type GuestOutcomeWire = typeof GuestOutcome.Encoded;

const decodeGuestOutcome = Schema.decodeUnknownEffect(GuestOutcome);

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const sandboxError = (
  reason: SandboxError["reason"],
  message: string,
  logs: readonly string[] = []
) => new SandboxError({ logs, message, reason });

const disposeQuietly = (stub: ReleasableStub): Effect.Effect<void> =>
  Effect.try(() => stub[Symbol.dispose]?.()).pipe(Effect.ignore);

const decodeCallInput = Schema.decodeUnknownOption(Schema.Json);

const makeRpcDispatcher = (invoke: Invoke) =>
  Effect.tryPromise({
    catch: (error) =>
      sandboxError(
        "protocol",
        `Unable to load the Cloudflare RPC runtime: ${messageOf(error)}`
      ),
    // oxlint-disable-next-line typescript/promise-function-async -- The built-in exists only inside workerd; keeping it lazy lets Alchemy import the Stack under Node without resolving the special URL.
    try: () => import("cloudflare:workers"),
  }).pipe(
    Effect.map(({ RpcTarget }) => {
      class InvokeDispatcher extends RpcTarget {
        readonly #invoke = invoke;

        // @effect-diagnostics-next-line asyncFunction:off -- Cloudflare RPC requires a Promise-returning method at this boundary. This is the sandbox's way out, so `input` arrives untrusted and is parsed as JSON before any capability sees it.
        async call(
          name: string,
          // oxlint-disable-next-line anti-slop/no-unknown-parameters
          input: unknown
        ): Promise<InvokeOutcome> {
          const json = decodeCallInput(input);

          if (Option.isNone(json)) {
            return invokeFailure("InvalidInput", "Tool input must be JSON");
          }

          try {
            return await Effect.runPromise(this.#invoke(name, json.value));
          } catch (error) {
            return invokeFailure("HostDefect", messageOf(error));
          }
        }
      }

      return new InvokeDispatcher();
    })
  );

const moduleSource = (code: string, timeoutMs: number): string => `
import { WorkerEntrypoint } from "cloudflare:workers";

export default class CodeExecutor extends WorkerEntrypoint {
  async run(dispatcher) {
    const logs = [];
    const render = (part) => {
      if (typeof part === "string") return part;
      try { return JSON.stringify(part); } catch { return String(part); }
    };
    const capture = (level) => (...parts) =>
      logs.push(level + ": " + parts.map(render).join(" "));
    const console = {
      debug: capture("debug"), error: capture("error"),
      info: capture("info"), log: capture("log"), warn: capture("warn")
    };
    const tools = new Proxy({}, {
      get: (_target, name) => async (input = {}) => {
        const outcome = await dispatcher.call(String(name), input);
        if (outcome.ok) return outcome.value;
        const error = new Error(outcome.error?.message ?? "capability failed");
        Object.assign(error, outcome.error);
        throw error;
      }
    });

    try {
      const value = await Promise.race([
        (async (tools, console) => { ${code} })(tools, console),
        new Promise((_, reject) => setTimeout(
          () => reject(new Error("${timeoutMessage}")), ${timeoutMs}
        ))
      ]);
      const result = JSON.parse(JSON.stringify(value === undefined ? null : value));
      return { ok: true, result, logs };
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return {
        ok: false,
        message,
        logs,
        timeout: message === "${timeoutMessage}"
      };
    }
  }
}
`;

export const sandboxLimits: WorkerLoaderSandboxOptions = {
  compatibilityDate: "2026-05-28",
  cpuMs: 100,
  subRequests: 5,
  timeout: "10 seconds",
};

export const layerWorkerLoader = (
  loader: WorkerLoaderBinding,
  options: WorkerLoaderSandboxOptions = {}
): Layer.Layer<Sandbox> => {
  const timeout = Duration.fromInputUnsafe(options.timeout ?? "10 seconds");
  const timeoutMs = Duration.toMillis(timeout);
  const compatibilityDate = options.compatibilityDate ?? "2026-05-28";

  const run = (code: string, invoke: Invoke) => {
    const execute = Effect.acquireUseRelease(
      Effect.try({
        catch: (cause) =>
          sandboxError(
            "exited",
            `Unable to start Dynamic Worker: ${messageOf(cause)}`
          ),
        try: () =>
          loader.load({
            compatibilityDate,
            globalOutbound: null,
            limits: {
              cpuMs: options.cpuMs ?? Math.max(10, Math.ceil(timeoutMs / 4)),
              subRequests: options.subRequests ?? 5,
            },
            mainModule: "executor.js",
            modules: { "executor.js": moduleSource(code, timeoutMs) },
          }),
      }),
      (worker) =>
        Effect.acquireUseRelease(
          Effect.try({
            catch: (cause) =>
              sandboxError(
                "exited",
                `Unable to open Dynamic Worker entrypoint: ${messageOf(cause)}`
              ),
            try: () => worker.getEntrypoint(),
          }),
          (entrypoint) =>
            makeRpcDispatcher(invoke).pipe(
              Effect.flatMap((dispatcher) =>
                Effect.tryPromise({
                  catch: (cause) => {
                    const message = messageOf(cause);

                    return sandboxError(
                      /CPU time limit|timed out/iu.test(message)
                        ? "timeout"
                        : "exited",
                      message
                    );
                  },
                  // oxlint-disable-next-line typescript/promise-function-async -- Effect.tryPromise accepts the platform Promise directly.
                  try: () => entrypoint.run(dispatcher),
                })
              ),
              Effect.flatMap((outcome) =>
                decodeGuestOutcome(outcome).pipe(
                  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Oxlint mistakes this Effect handler for a Promise callback.
                  Effect.mapError((error) =>
                    sandboxError(
                      "protocol",
                      `Unreadable Dynamic Worker response: ${error.message}`
                    )
                  )
                )
              ),
              Effect.flatMap((outcome) => {
                if (outcome.ok) {
                  return Effect.succeed<SandboxRun>({
                    logs: outcome.logs,
                    result: outcome.result,
                  });
                }

                return Effect.fail(
                  sandboxError(
                    outcome.timeout ? "timeout" : "threw",
                    outcome.timeout
                      ? `The program did not finish within ${Duration.format(timeout)}`
                      : outcome.message,
                    outcome.logs
                  )
                );
              })
            ),
          disposeQuietly
        ),
      disposeQuietly
    );

    return execute.pipe(
      Effect.timeoutOrElse({
        duration: Duration.millis(timeoutMs + 1000),
        orElse: () =>
          Effect.fail(
            sandboxError(
              "timeout",
              `The program did not finish within ${Duration.format(timeout)}`
            )
          ),
      })
    );
  };

  return Layer.succeed(Sandbox, { run });
};
