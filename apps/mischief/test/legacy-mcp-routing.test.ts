import { expect, it } from "@effect/vitest";
import { Effect, Layer, Option, Ref, Scope } from "effect";
import type { Schema } from "effect";
import * as HttpRouter from "effect/unstable/http/HttpRouter";

import { mischiefRoutes } from "../src/app.js";
import type { LegacyMcpRouter } from "../src/app.js";
import { legacyMcpRuntime } from "../src/legacy-mcp/runtime.js";
import { openLegacySession } from "../src/legacy-mcp/session.js";
import type { StoredSession } from "../src/legacy-mcp/session.js";
import { rateLimitsFrom } from "../src/rate-limits.js";
import type { RateLimitBindings } from "../src/rate-limits.js";
import { TestSandbox } from "./test-sandbox.js";

type WebHandler = (request: Request) => Promise<Response>;

class FakeLimit {
  readonly #results: boolean[];
  constructor(results: readonly boolean[] = []) {
    this.#results = [...results];
  }
  // oxlint-disable-next-line typescript/promise-function-async -- Matches Cloudflare's Promise-returning binding.
  limit() {
    return Promise.resolve({ success: this.#results.shift() ?? true });
  }
}

const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/u;

const fakeNamespace = Effect.gen(function* makeFakeNamespace() {
  const scope = yield* Effect.scope;

  const objects = new Map<
    string,
    {
      readonly handle: (
        request: Request,
        id: string
      ) => Effect.Effect<Response>;
    }
  >();

  const router: LegacyMcpRouter = {
    forward: (name, request) =>
      Effect.gen(function* forwardToObject() {
        let object = objects.get(name);

        if (object === undefined) {
          const forward = yield* legacyMcpRuntime(TestSandbox).pipe(
            Scope.provide(scope)
          );

          const stored = yield* Ref.make(Option.none<StoredSession>());
          object = yield* openLegacySession({
            forward,
            storage: {
              load: Ref.get(stored).pipe(Effect.map(Option.getOrUndefined)),
              save: (session) => Ref.set(stored, Option.some(session)),
            },
          });
          objects.set(name, object);
        }

        return yield* object.handle(request, name);
      }),
  };

  return { objects, router };
});

const withWorker = <A, E, R>(
  use: (
    handler: WebHandler,
    objects: ReadonlyMap<string, unknown>
  ) => Effect.Effect<A, E, R>,
  bindings: Partial<RateLimitBindings> = {}
) =>
  Effect.scoped(
    Effect.gen(function* withLegacyWorker() {
      const namespace = yield* fakeNamespace;

      const worker = yield* Effect.acquireRelease(
        Effect.sync(() =>
          HttpRouter.toWebHandler(
            mischiefRoutes({
              legacyMcp: namespace.router,
              rateLimits: rateLimitsFrom({
                API_PER_IP: bindings.API_PER_IP ?? new FakeLimit(),
                EXECUTE_GLOBAL: bindings.EXECUTE_GLOBAL ?? new FakeLimit(),
                EXECUTE_PER_IP: bindings.EXECUTE_PER_IP ?? new FakeLimit(),
              }),
            }).pipe(Layer.provide(TestSandbox)),
            { disableLogger: true }
          )
        ),
        ({ dispose }) => Effect.promise(dispose)
      );

      return yield* use(worker.handler, namespace.objects);
    })
  );

const legacy = (
  body: Readonly<Record<string, Schema.Json>>,
  sessionId?: string
) => {
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
  });

  if (sessionId !== undefined) {
    headers.set("mcp-protocol-version", "2025-06-18");
    headers.set("mcp-session-id", sessionId);
  }

  return new Request("https://ratstack.sh/mcp", {
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    headers,
    method: "POST",
  });
};

const initialize = (id: number) =>
  legacy({
    id,
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "cursor", version: "1.0.0" },
      protocolVersion: "2025-06-18",
    },
  });

const send = (handler: WebHandler, request: Request) =>
  Effect.promise(handler.bind(undefined, request));

const text = (response: Response) =>
  Effect.promise(response.text.bind(response));

it.effect("gives each legacy MCP client its own session object", () =>
  withWorker((handler, objects) =>
    Effect.gen(function* legacyRouting() {
      const first = yield* send(handler, initialize(1));
      const firstId = first.headers.get("mcp-session-id") ?? "";
      expect(first.status).toBe(200);
      expect(firstId).toMatch(uuid);

      const tools = yield* send(
        handler,
        legacy({ id: 2, method: "tools/list" }, firstId)
      );

      expect(tools.status).toBe(200);
      expect(yield* text(tools)).toContain('"search"');

      const second = yield* send(handler, initialize(3));
      const secondId = second.headers.get("mcp-session-id") ?? "";
      expect(secondId).toMatch(uuid);
      expect(secondId).not.toBe(firstId);
      expect([...objects.keys()]).toEqual([firstId, secondId]);

      const modern = yield* send(
        handler,
        new Request("https://ratstack.sh/mcp", {
          body: JSON.stringify({
            id: "modern",
            jsonrpc: "2.0",
            method: "tools/list",
            params: {
              _meta: {
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/clientInfo": {
                  name: "claude-code",
                  version: "2.1.280",
                },
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
              },
            },
          }),
          headers: {
            "MCP-Protocol-Version": "2026-07-28",
            "Mcp-Method": "tools/list",
            accept: "application/json, text/event-stream",
            "content-type": "application/json",
          },
          method: "POST",
        })
      );

      expect(modern.status).toBe(200);
      expect(objects.size).toBe(2);

      const forged = yield* send(
        handler,
        legacy({ id: 4, method: "tools/list" }, "not-a-session")
      );

      expect(forged.status).toBe(404);
      expect(objects.size).toBe(2);
    })
  )
);

it.effect("applies execute limits to legacy tool calls", () =>
  withWorker(
    (handler) =>
      Effect.gen(function* legacyExecuteLimit() {
        const opened = yield* send(handler, initialize(1));
        const sessionId = opened.headers.get("mcp-session-id") ?? "";

        const denied = yield* send(
          handler,
          legacy(
            {
              id: 2,
              method: "tools/call",
              params: { arguments: { code: "return 1" }, name: "execute" },
            },
            sessionId
          )
        );

        expect(denied.status).toBe(200);
        expect(denied.headers.get("retry-after")).toBe("60");
        expect(yield* text(denied)).toContain(
          "EXECUTE_PER_IP rate limit exceeded"
        );
      }),
    { EXECUTE_PER_IP: new FakeLimit([false]) }
  )
);
