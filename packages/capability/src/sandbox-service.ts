// Worker-safe contract for running model-written code with exactly one way
// out: `tools.<name>(input)`, which the host answers through an Invoke callback.
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { SandboxError } from "./sandbox-error.js";

export { SandboxError } from "./sandbox-error.js";

export type InvokeOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

/** Answers a `tools.<name>(input)` call from inside the sandbox. */
export type Invoke = (
  name: string,
  input: unknown
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
