// A legacy MCP session that outlives the memory it runs in.
//
// MCP revisions before 2026-07-28 are stateful: `initialize` opens a session
// and every later request names it. Effect keeps those sessions in memory, so
// one Durable Object per session holds the runtime. Cloudflare evicts idle
// objects, which would drop the session, so the object also stores the
// client's `initialize` request. When a request arrives for a session the
// runtime no longer knows, the object replays `initialize` into a fresh
// runtime and keeps answering under the id the client already has.
import { Effect, Option, Ref, Schema } from "effect";

/** What an object must remember to rebuild its session after eviction. */
export interface StoredSession {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Durable Object storage in production, a Ref in tests. */
export interface SessionStorage<R = never> {
  readonly load: Effect.Effect<StoredSession | undefined, never, R>;
  readonly save: (session: StoredSession) => Effect.Effect<void, never, R>;
}

export interface LegacySessionOptions<R = never> {
  /** Effect's in-memory MCP runtime for the legacy protocols. */
  readonly forward: (request: Request) => Effect.Effect<Response, never, R>;
  readonly storage: SessionStorage<R>;
}

/** The Worker names the client's session to the object in this header. */
export const LEGACY_SESSION_HEADER = "x-ratstack-mcp-session";

const SESSION_HEADER = "mcp-session-id";

// Only these headers matter to the runtime when it replays `initialize`.
const replayHeaders = ["accept", "content-type", "mcp-protocol-version"];

const JsonRpcEnvelope = Schema.fromJsonString(
  Schema.Struct({
    id: Schema.optional(
      Schema.Union([Schema.String, Schema.Finite, Schema.Null])
    ),
    method: Schema.optional(Schema.String),
  })
);

const envelopeOf = (body: string) =>
  Schema.decodeEffect(JsonRpcEnvelope)(body).pipe(Effect.option);

const withSessionId = (
  request: Request,
  body: string,
  sessionId: Option.Option<string>
) => {
  const headers = new Headers(request.headers);
  headers.delete(LEGACY_SESSION_HEADER);

  if (Option.isSome(sessionId)) {
    headers.set(SESSION_HEADER, sessionId.value);
  } else {
    headers.delete(SESSION_HEADER);
  }

  return new Request(request.url, {
    body: request.method === "GET" || request.method === "HEAD" ? null : body,
    headers,
    method: request.method,
  });
};

// The client only ever sees the id it was given, never the runtime's.
const presentAs = (response: Response, externalId: string) => {
  if (!response.headers.has(SESSION_HEADER)) {
    return response;
  }

  const headers = new Headers(response.headers);
  headers.set(SESSION_HEADER, externalId);

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
};

/** The spec's answer to an unknown session: start a new one. */
export const legacySessionNotFound = (id: string | number | null | undefined) =>
  Response.json(
    {
      error: { code: -32_001, message: "Session not found" },
      id: id ?? null,
      jsonrpc: "2.0",
    },
    { status: 404 }
  );

const initializedNotification = JSON.stringify({
  jsonrpc: "2.0",
  method: "notifications/initialized",
});

export const openLegacySession = <R = never>(
  options: LegacySessionOptions<R>
) =>
  Effect.gen(function* buildSession() {
    const { forward, storage } = options;
    // The runtime's own id for this session, while the runtime remembers it.
    const runtimeId = yield* Ref.make(Option.none<string>());

    const open = (request: Request, body: string) =>
      Effect.gen(function* openSession() {
        const response = yield* forward(
          withSessionId(request, body, Option.none())
        );

        const id = response.headers.get(SESSION_HEADER);

        if (response.ok && id !== null) {
          yield* Ref.set(runtimeId, Option.some(id));
        }

        return response;
      });

    // Rebuild the session in a runtime that has forgotten it.
    const restore = (request: Request) =>
      Effect.gen(function* restoreSession() {
        const stored = yield* storage.load;

        if (stored === undefined) {
          return Option.none<string>();
        }

        const replay = new Request(request.url, {
          body: stored.body,
          headers: stored.headers,
          method: "POST",
        });

        yield* open(replay, stored.body);
        const id = yield* Ref.get(runtimeId);

        if (Option.isSome(id)) {
          yield* forward(
            withSessionId(
              new Request(request.url, {
                headers: stored.headers,
                method: "POST",
              }),
              initializedNotification,
              id
            )
          );
        }

        return id;
      });

    const remember = (request: Request, body: string) => {
      const headers: Record<string, string> = {};

      for (const name of replayHeaders) {
        const value = request.headers.get(name);

        if (value !== null) {
          headers[name] = value;
        }
      }

      return storage.save({ body, headers });
    };

    const handle = (request: Request, externalId: string) =>
      Effect.gen(function* handleRequest() {
        const body =
          request.method === "POST"
            ? yield* Effect.promise(request.text.bind(request))
            : "";

        const envelope = Option.getOrUndefined(yield* envelopeOf(body));

        if (envelope?.method === "initialize") {
          const response = yield* open(request, body);

          if (response.ok) {
            yield* remember(request, body);
          }

          return presentAs(response, externalId);
        }

        const known = yield* Ref.get(runtimeId);
        const id = Option.isSome(known) ? known : yield* restore(request);

        if (Option.isNone(id)) {
          return legacySessionNotFound(envelope?.id);
        }

        const response = yield* forward(withSessionId(request, body, id));

        if (response.status !== 404 || Option.isNone(known)) {
          return presentAs(response, externalId);
        }

        // The runtime dropped a session it held a moment ago. Rebuild once.
        yield* Ref.set(runtimeId, Option.none());
        const rebuilt = yield* restore(request);

        if (Option.isNone(rebuilt)) {
          return legacySessionNotFound(envelope?.id);
        }

        return presentAs(
          yield* forward(withSessionId(request, body, rebuilt)),
          externalId
        );
      });

    return { handle };
  });
