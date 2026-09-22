// The Worker runtime module has no Node-resolvable declaration of its own.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="./cloudflare-workers.d.ts" />

import { Sandbox, SandboxError } from "@rat-stack/capability/sandbox";
import type {
  Invoke,
  InvokeOutcome,
  SandboxRun,
} from "@rat-stack/capability/sandbox";
import type { RpcTarget as RpcTargetType } from "cloudflare:workers";
import { Duration, Effect, Layer, Schema } from "effect";

export interface DynamicWorkerEntrypoint {
  readonly run: (dispatcher: RpcTargetType) => Promise<unknown>;
}

export interface DynamicWorker {
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

const decodeGuestOutcome = Schema.decodeUnknownEffect(GuestOutcome);

const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const sandboxError = (
  reason: SandboxError["reason"],
  message: string,
  logs: readonly string[] = []
) => new SandboxError({ logs, message, reason });

const disposeQuietly = (value: unknown): Effect.Effect<void> =>
  Effect.sync(() => {
    if (
      typeof value !== "object" ||
      value === null ||
      !(Symbol.dispose in value)
    ) {
      return;
    }
    const dispose = value[Symbol.dispose];
    if (typeof dispose !== "function") {
      return;
    }
    try {
      dispose.call(value);
    } catch {
      // Cleanup must not mask the sandbox result.
    }
  });

const makeRpcDispatcher = (invoke: Invoke) =>
  Effect.tryPromise({
    catch: (error) =>
      sandboxError(
        "protocol",
        `Unable to load the Cloudflare RPC runtime: ${messageOf(error)}`
      ),
    // The built-in exists only inside workerd; keeping it lazy lets Alchemy
    // import the Stack under Node without resolving the special URL.
    // oxlint-disable-next-line typescript/promise-function-async
    try: () => import("cloudflare:workers"),
  }).pipe(
    Effect.map(({ RpcTarget }) => {
      class InvokeDispatcher extends RpcTarget {
        readonly #invoke = invoke;

        // Cloudflare RPC requires a Promise-returning method at this boundary.
        // @effect-diagnostics-next-line asyncFunction:off
        async call(name: string, input: unknown): Promise<InvokeOutcome> {
          try {
            return await Effect.runPromise(this.#invoke(name, input));
          } catch (error) {
            return {
              error: { _tag: "HostDefect", message: messageOf(error) },
              ok: false,
            };
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

/** A fresh, network-denied Dynamic Worker for every program run. */
/** The limits every code-mode program runs under, from any surface. */
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
                  // Effect.tryPromise accepts the platform Promise directly.
                  // oxlint-disable-next-line typescript/promise-function-async
                  try: () => entrypoint.run(dispatcher),
                })
              ),
              Effect.flatMap((outcome) =>
                decodeGuestOutcome(outcome).pipe(
                  // Oxlint mistakes this Effect handler for a Promise callback.
                  // oxlint-disable-next-line promise/prefer-await-to-callbacks
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
