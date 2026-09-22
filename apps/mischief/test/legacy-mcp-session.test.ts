import { expect, it } from "@effect/vitest";
import { Effect, Option, Ref, Schema } from "effect";

import { legacyMcpRuntime } from "../src/legacy-mcp/runtime.js";
import { makeLegacySession } from "../src/legacy-mcp/session.js";
import type { StoredSession } from "../src/legacy-mcp/session.js";
import { TestSandbox } from "./test-sandbox.js";

type Forward = (request: Request) => Effect.Effect<Response>;

// One runtime is one Durable Object's memory. A second runtime over the same
// storage is the same object after eviction. Built exactly as the object
// builds it, so the session header path is the production one.
const withRuntime = <A, E, R>(
  use: (forward: Forward) => Effect.Effect<A, E, R>
) =>
  Effect.scoped(
    Effect.gen(function* runtimeScope() {
      return yield* use(yield* legacyMcpRuntime(TestSandbox));
    })
  );

const memoryStorage = Effect.gen(function* makeMemoryStorage() {
  const stored = yield* Ref.make(Option.none<StoredSession>());
  return {
    load: Ref.get(stored).pipe(Effect.map(Option.getOrUndefined)),
    save: (session: StoredSession) => Ref.set(stored, Option.some(session)),
  };
});

const rpc = (body: Readonly<Record<string, unknown>>, sessionId?: string) =>
  new Request("https://ratstack.sh/mcp", {
    body: JSON.stringify({ jsonrpc: "2.0", ...body }),
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...(sessionId === undefined
        ? {}
        : {
            "mcp-protocol-version": "2025-06-18",
            "mcp-session-id": sessionId,
          }),
    },
    method: "POST",
  });

const initialize = () =>
  rpc({
    id: 1,
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "codex", version: "1.0.0" },
      protocolVersion: "2025-06-18",
    },
  });

const decodeJson = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Json)
);

// Legacy servers may answer a POST with JSON or with one SSE event.
const readRpcText = Effect.fnUntraced(function* readRpcText(
  response: Response
) {
  const text = yield* Effect.promise(response.text.bind(response));
  const events = text
    .split("\n")
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());
  // Notifications can precede the reply on the same stream.
  return events.find((event) => event.includes('"id"')) ?? events[0] ?? text;
});

it.effect("a legacy client initializes, lists tools, and calls search", () =>
  withRuntime((forward) =>
    Effect.gen(function* legacyClientFlow() {
      const storage = yield* memoryStorage;
      const session = yield* makeLegacySession({
        forward,
        storage,
      });

      const initialized = yield* session.handle(initialize(), "ext-1");
      expect(initialized.status).toBe(200);
      expect(initialized.headers.get("mcp-session-id")).toBe("ext-1");
      expect(yield* readRpcText(initialized)).toContain('"protocolVersion"');

      const notified = yield* session.handle(
        rpc({ method: "notifications/initialized" }, "ext-1"),
        "ext-1"
      );
      expect(notified.status).toBe(202);

      const tools = yield* session.handle(
        rpc({ id: 2, method: "tools/list" }, "ext-1"),
        "ext-1"
      );
      expect(tools.status).toBe(200);
      const toolsText = yield* readRpcText(tools);
      expect(toolsText).toContain('"search"');
      expect(toolsText).toContain('"execute"');

      const search = yield* session.handle(
        rpc(
          {
            id: 3,
            method: "tools/call",
            params: { arguments: { query: "capability" }, name: "search" },
          },
          "ext-1"
        ),
        "ext-1"
      );
      expect(search.status).toBe(200);
      const result = yield* decodeJson(yield* readRpcText(search));
      expect(JSON.stringify(result)).toContain("ratstack://");
    })
  )
);

it.effect("a legacy session survives eviction of its object", () =>
  Effect.gen(function* survivesEviction() {
    const storage = yield* memoryStorage;

    yield* withRuntime((forward) =>
      Effect.gen(function* beforeEviction() {
        const session = yield* makeLegacySession({
          forward,
          storage,
        });
        const initialized = yield* session.handle(initialize(), "ext-2");
        expect(initialized.status).toBe(200);
      })
    );

    yield* withRuntime((forward) =>
      Effect.gen(function* afterEviction() {
        const session = yield* makeLegacySession({
          forward,
          storage,
        });
        const tools = yield* session.handle(
          rpc({ id: 2, method: "tools/list" }, "ext-2"),
          "ext-2"
        );
        expect(tools.status).toBe(200);
        // The client never sees the replacement runtime's session id.
        expect([null, "ext-2"]).toContain(tools.headers.get("mcp-session-id"));
        expect(yield* readRpcText(tools)).toContain('"search"');
      })
    );
  })
);

it.effect("an unknown legacy session is not found", () =>
  withRuntime((forward) =>
    Effect.gen(function* unknownSession() {
      const storage = yield* memoryStorage;
      const session = yield* makeLegacySession({
        forward,
        storage,
      });
      const tools = yield* session.handle(
        rpc({ id: 2, method: "tools/list" }, "ext-missing"),
        "ext-missing"
      );
      expect(tools.status).toBe(404);
    })
  )
);
