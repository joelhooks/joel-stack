// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off -- See to-toolkit.ts: a projection over a heterogeneous list erases error and requirement types at the boundary and recovers them for callers.
import type { Effect, Layer, Schema } from "effect";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  OpenApi,
} from "effect/unstable/httpapi";

import { ApprovalDenied } from "./approval.js";
import { failureSchemaOf } from "./capability.js";
import type {
  AnyCapability,
  FailureOf,
  InputOf,
  InputSchema,
  NameOf,
  OutputOf,
  PlainSchema,
} from "./capability.js";
import type { RequirementsOf } from "./to-toolkit.js";

export const GROUP = "capabilities";

// SAFETY: `HttpApiEndpoint.post` checks at the type level that the error schema is not a streaming schema, through a non-exported conditional type that a generic `Failure` cannot satisfy. A plain schema is never a stream, so the runtime call goes through this loosely typed alias and `EndpointOf` names the precise endpoint type separately.
// oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
const post = HttpApiEndpoint.post as unknown as (
  name: string,
  path: `/${string}`,
  options: {
    readonly error: Schema.Top | readonly Schema.Top[];
    readonly payload: InputSchema;
    readonly success: PlainSchema;
  }
) => HttpApiEndpoint.Constraint;

const DEFAULT_FAILURE_STATUS = 422;

const withFailureStatus = (failure: PlainSchema): Schema.Top =>
  failure.ast.annotations?.httpApiStatus === undefined
    ? failure.annotate({ httpApiStatus: DEFAULT_FAILURE_STATUS })
    : failure;

const httpFailure = (capability: AnyCapability): readonly Schema.Top[] =>
  capability.needsApproval
    ? [withFailureStatus(capability.failure), ApprovalDenied]
    : [withFailureStatus(failureSchemaOf(capability))];

export type EndpointOf<C> = ReturnType<
  typeof HttpApiEndpoint.post<
    NameOf<C>,
    `/${NameOf<C>}`,
    never,
    never,
    InputOf<C>,
    never,
    OutputOf<C>,
    FailureOf<C>
  >
>;

const groupFor = <
  const Endpoints extends readonly [
    HttpApiEndpoint.Constraint,
    ...HttpApiEndpoint.Constraint[],
  ],
>(
  ...endpoints: Endpoints
) => HttpApiGroup.make(GROUP).add(...endpoints);

const apiFor = <const Id extends string, Group extends HttpApiGroup.Constraint>(
  id: Id,
  group: Group
) =>
  HttpApi.make(id)
    .add(group)
    .annotateMerge(OpenApi.annotations({ title: id }));

export type EndpointsOf<Caps extends readonly AnyCapability[]> = {
  readonly [K in keyof Caps]: EndpointOf<Caps[K]>;
};

export type GroupOf<Caps extends readonly AnyCapability[]> = ReturnType<
  typeof groupFor<
    EndpointsOf<Caps> extends readonly [
      HttpApiEndpoint.Constraint,
      ...HttpApiEndpoint.Constraint[],
    ]
      ? EndpointsOf<Caps>
      : never
  >
>;

export type ApiOf<
  Id extends string,
  Caps extends readonly AnyCapability[],
> = ReturnType<typeof apiFor<Id, GroupOf<Caps>>>;

export interface HttpApiProjectionOptions {
  readonly errors?: readonly Schema.Top[] | undefined;
  readonly prefix?: `/${string}` | undefined;
}

export interface HttpApiProjection<
  Id extends string,
  Caps extends readonly AnyCapability[],
> {
  readonly api: ApiOf<Id, Caps>;
  readonly layer: Layer.Layer<
    HttpApiGroup.ToService<Id, GroupOf<Caps>>,
    never,
    RequirementsOf<Caps>
  >;
  readonly openApi: () => OpenApi.OpenAPISpec;
}

export const toHttpApi = <
  const Id extends string,
  const Caps extends readonly [AnyCapability, ...AnyCapability[]],
>(
  id: Id,
  capabilities: Caps,
  options?: HttpApiProjectionOptions
): HttpApiProjection<Id, Caps> => {
  const hostErrors = options?.errors ?? [];

  const endpoints = capabilities.map((capability) =>
    post(capability.name, `/${capability.name}`, {
      error: [...httpFailure(capability), ...hostErrors],
      payload: capability.input,
      success: capability.output,
    })
  );

  const [first, ...rest] = endpoints;

  if (first === undefined) {
    throw new Error("toHttpApi needs at least one capability");
  }

  const baseApi = apiFor(id, groupFor(first, ...rest));

  const projectedApi =
    options?.prefix === undefined ? baseApi : baseApi.prefix(options.prefix);

  // SAFETY: prefixing changes endpoint paths but not the API id, group id, schemas, or handler service. Keep the stable public type while preserving that runtime path transformation for HttpApiBuilder and OpenAPI.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const api = projectedApi as unknown as ApiOf<Id, Caps>;

  const implementations: Record<
    string,
    (request: {
      readonly payload: unknown;
    }) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>
  > = {};

  for (const capability of capabilities) {
    // SAFETY: `Any` erased this capability's requirements to `unknown`; they are a subset of `RequirementsOf<Caps>`. HttpApi decodes the payload.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const run = capability.handler as (
      // oxlint-disable-next-line anti-slop/no-unknown-parameters
      input: unknown
    ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;

    implementations[capability.name] = ({ payload }) => run(payload);
  }

  // SAFETY: `handleAll` wants a record keyed by the group's endpoint identifiers with each handler typed to its endpoint; that is what `implementations` is at runtime, but a loop cannot say so. `never` is accepted by every parameter type, so the call stays checked on its return side.
  const built = HttpApiBuilder.group(api, GROUP, (handlers) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    handlers.handleAll(implementations as never)
  );

  // SAFETY: `built` is the layer for exactly the group `api` names, which is what `HttpApiProjection<Id, Caps>["layer"]` spells out.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion, anti-slop/no-chained-type-assertions
  const layer = built as unknown as HttpApiProjection<Id, Caps>["layer"];

  return { api, layer, openApi: () => OpenApi.fromApi(api) };
};
