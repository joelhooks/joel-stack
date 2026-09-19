// The one domain object this package projects from.
//
// A Capability is a named, described unit of work with an Effect Schema for
// its input, output, and failure, an Effect handler, and the annotations every
// agent surface agrees on (read-only, destructive, idempotent, open-world,
// approval). Projections (to-command, to-http-api, to-toolkit) are pure
// functions from Capabilities to an Effect surface; they add nothing the
// Capability did not already say.
import type { Effect, Schema } from "effect";

export interface Annotations {
  /** The handler does not mutate anything observable. */
  readonly readOnly: boolean;
  /** The handler may destroy or irreversibly change state. */
  readonly destructive: boolean;
  /** Repeating the call with the same input has no additional effect. */
  readonly idempotent: boolean;
  /** The handler talks to systems outside the process (network, other hosts). */
  readonly openWorld: boolean;
}

/**
 * A schema whose codecs need no services. Projections decode and encode at
 * process edges (argv, HTTP bodies, MCP messages) where no service exists to
 * provide, so every Capability schema must be plain.
 */
export type PlainSchema = Schema.Top & {
  readonly DecodingServices: never;
  readonly EncodingServices: never;
};

export type InputSchema = Schema.Struct<Record<string, PlainSchema>>;

export interface Capability<
  N extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends PlainSchema,
  R,
> {
  readonly _tag: "Capability";
  readonly name: N;
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly failure: F;
  readonly annotations: Annotations;
  /** A host should ask a human before running this. */
  readonly needsApproval: boolean;
  readonly handler: (
    input: I["Type"]
  ) => Effect.Effect<O["Type"], F["Type"], R>;
}

/**
 * Any capability, for projections that take a heterogeneous list.
 *
 * The handler takes `never` so that every concrete handler is assignable
 * (parameters are contravariant), and returns `unknown` in every channel; the
 * extractors below recover the real types from a concrete capability type.
 */
export interface AnyCapability {
  readonly _tag: "Capability";
  readonly name: string;
  readonly description: string;
  readonly input: InputSchema;
  readonly output: PlainSchema;
  readonly failure: PlainSchema;
  readonly annotations: Annotations;
  readonly needsApproval: boolean;
  readonly handler: (input: never) => Effect.Effect<unknown, unknown, unknown>;
}

// Extractors infer every parameter at once: matching against a partly fixed
// `Capability<...>` would compare handler parameter types contravariantly and
// fail for any concrete input.
export type NameOf<C> =
  C extends Capability<infer N, infer _I, infer _O, infer _F, infer _R>
    ? N
    : never;
export type InputOf<C> =
  C extends Capability<infer _N, infer I, infer _O, infer _F, infer _R>
    ? I
    : never;
export type OutputOf<C> =
  C extends Capability<infer _N, infer _I, infer O, infer _F, infer _R>
    ? O
    : never;
export type FailureOf<C> =
  C extends Capability<infer _N, infer _I, infer _O, infer F, infer _R>
    ? F
    : never;
export type RequirementsOf<C> =
  C extends Capability<infer _N, infer _I, infer _O, infer _F, infer R>
    ? R
    : never;

export interface DefineOptions<
  I extends InputSchema,
  O extends PlainSchema,
  F extends PlainSchema,
  R,
> {
  readonly description: string;
  readonly input: I;
  readonly output: O;
  readonly failure: F;
  readonly annotations?: Partial<Annotations> | undefined;
  readonly needsApproval?: boolean | undefined;
  readonly handler: (
    input: I["Type"]
  ) => Effect.Effect<O["Type"], F["Type"], R>;
}

const defaultAnnotations: Annotations = {
  destructive: false,
  idempotent: false,
  openWorld: false,
  readOnly: false,
};

export const defineCapability = <
  const N extends string,
  I extends InputSchema,
  O extends PlainSchema,
  F extends PlainSchema,
  R = never,
>(
  name: N,
  options: DefineOptions<I, O, F, R>
): Capability<N, I, O, F, R> => ({
  _tag: "Capability",
  annotations: { ...defaultAnnotations, ...options.annotations },
  description: options.description,
  failure: options.failure,
  handler: options.handler,
  input: options.input,
  name,
  needsApproval: options.needsApproval ?? false,
  output: options.output,
});
