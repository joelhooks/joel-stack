import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Schema from "effect/Schema";

import type { SandboxError } from "./sandbox-error.js";

export { SandboxError } from "./sandbox-error.js";

export type InvokeOutcome =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly error: unknown };

export const invokeFailure = (tag: string, message: string): InvokeOutcome => ({
  error: { _tag: tag, message },
  ok: false,
});

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
