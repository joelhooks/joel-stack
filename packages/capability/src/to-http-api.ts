// @effect-diagnostics anyUnknownInErrorContext:off unsafeEffectTypeAssertion:off missingEffectContext:off
// See to-toolkit.ts: a projection over a heterogeneous list erases error and
// requirement types at the boundary and recovers them for callers.
// Projection: Capabilities -> effect/unstable/httpapi HttpApi (REST + OpenAPI).
//
// Every capability becomes `POST /<name>` in one group, with the input as the
// JSON payload, the output as the success body, and the failure as the error
// body. POST for everything is deliberate: it keeps the projection total (any
// Struct input fits a JSON body) and keeps one rule for agents to learn.
// `OpenApi.fromApi(api)` then derives the document for free.
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

/**
 * `HttpApiEndpoint.post` checks at the type level that the error schema is
 * not a streaming schema, through a non-exported conditional type that a
 * generic `Failure` cannot satisfy. A plain schema is never a stream, so the
 * runtime call goes through this loosely typed alias and `EndpointOf` names
 * the precise endpoint type separately.
 */
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const post = HttpApiEndpoint.post as unknown as (
  name: string,
  path: `/${string}`,
  options: {
    readonly error: Schema.Top | readonly Schema.Top[];
    readonly payload: InputSchema;
    readonly success: PlainSchema;
  }
) => HttpApiEndpoint.Constraint;

/**
 * A declared failure is the caller's problem, so it answers 422 unless the
 * capability annotated its failure schema with a status of its own (for
 * example `HttpApiSchema.status(404)`). Undeclared errors stay 500.
 */
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
  /**
   * Failures the host can produce on any route before a handler runs, such
   * as a 429 from a rate limiter. Each schema carries its own `httpApiStatus`
   * annotation. They are documented on every endpoint; the capabilities'
   * own failure schemas are unchanged.
   */
  readonly errors?: readonly Schema.Top[] | undefined;
  readonly prefix?: `/${string}` | undefined;
}

export interface HttpApiProjection<
  Id extends string,
  Caps extends readonly AnyCapability[],
> {
  readonly api: ApiOf<Id, Caps>;
  /** Handlers for every endpoint; requires whatever the capabilities require. */
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
  // `map` over a tuple returns an array; `EndpointsOf<Caps>` is the tuple
  // type the group needs. One cast at this boundary keeps callers typed.
  const baseApi = apiFor(id, groupFor(first, ...rest));
  const projectedApi =
    options?.prefix === undefined ? baseApi : baseApi.prefix(options.prefix);
  // Prefixing changes endpoint paths but not the API id, group id, schemas, or
  // handler service. Keep the stable public type while preserving that runtime
  // path transformation for HttpApiBuilder and OpenAPI.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const api = projectedApi as unknown as ApiOf<Id, Caps>;

  const implementations: Record<
    string,
    (request: {
      readonly payload: unknown;
    }) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>
  > = {};
  for (const capability of capabilities) {
    // `Any` erased this capability's requirements to `unknown`; they are a
    // subset of `RequirementsOf<Caps>`.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const run = capability.handler as (
      input: unknown
    ) => Effect.Effect<unknown, unknown, RequirementsOf<Caps>>;
    implementations[capability.name] = ({ payload }) => run(payload);
  }
  // `handleAll` wants a record keyed by the group's endpoint identifiers with
  // each handler typed to its endpoint; that is what `implementations` is at
  // runtime, but a loop cannot say so. `never` is accepted by every parameter
  // type, so the call stays checked on its return side.
  const built = HttpApiBuilder.group(api, GROUP, (handlers) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    handlers.handleAll(implementations as never)
  );
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  const layer = built as unknown as HttpApiProjection<Id, Caps>["layer"];

  return { api, layer, openApi: () => OpenApi.fromApi(api) };
};
