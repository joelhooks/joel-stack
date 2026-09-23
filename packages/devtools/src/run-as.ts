import type { PlainSchema } from "@rat-stack/capability";
import type { Context } from "effect";

export interface RunAs<Identifier, Value> {
  readonly label: string;
  readonly schema: PlainSchema & { readonly Type: Value };
  readonly tag: Context.Key<Identifier, Value>;
}

export interface DevtoolsOptions<Identifier, Value> {
  readonly runAs?: RunAs<Identifier, Value> | undefined;
}
