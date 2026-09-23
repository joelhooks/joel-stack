// Worker-safe contract for running model-written code with exactly one way
// out: `tools.<name>(input)`, which the host answers through an Invoke callback.
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type { SandboxError } from "./sandbox-error.js";

export { SandboxError } from "./sandbox-error.js";

export type InvokeOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

/** A failed call as it crosses the sandbox wire: a tag and a message. */
export const invokeFailure = (tag: string, message: string): InvokeOutcome => ({
  error: { _tag: tag, message },
  ok: false,
});

/**
 * Answers a `tools.<name>(input)` call from inside the sandbox. The input
 * crossed a JSON wire, so it is JSON; the capability's own schema decodes it.
 */
export type Invoke = (
  name: string,
  input: Schema.Json
) => Effect.Effect<InvokeOutcome>;

export interface SandboxRun {
  readonly result: unknown;
  readonly logs: readonly string[];
}

export class Sandbox extends Context.Service<
  Sandbox,
  {
    readonly run: (
      code: string,
      invoke: Invoke
    ) => Effect.Effect<SandboxRun, SandboxError>;
  }
>()("@rat-stack/capability/Sandbox") {}
