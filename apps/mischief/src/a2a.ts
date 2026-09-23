import { Effect, Schema } from "effect";

import { read, search } from "./capabilities/index.js";

const JsonRpcId = Schema.Union([Schema.String, Schema.Finite]);

const TextPart = Schema.Struct({
  kind: Schema.optional(Schema.Literal("text")),
  text: Schema.String,
});

const A2aRequest = Schema.Struct({
  id: JsonRpcId,
  jsonrpc: Schema.Literal("2.0"),
  method: Schema.Literals(["message/send", "SendMessage"]),
  params: Schema.Struct({
    message: Schema.Struct({
      contextId: Schema.optional(Schema.String),
      kind: Schema.optional(Schema.Literal("message")),
      messageId: Schema.String,
      parts: Schema.Array(TextPart),
      role: Schema.Literals(["user", "ROLE_USER"]),
    }),
  }),
});

/** Parses a JSON-RPC body into an A2A request at the HTTP boundary. */
export const decodeA2aRequest = Schema.decodeUnknownEffect(A2aRequest);

const answerQuestion = Effect.fn("A2A.answerQuestion")(function* answerQuestion(
  question: string
) {
  const searched = yield* search.handler({ limit: 3, query: question });

  // Effect.forEach is the Effect combinator, not Array#forEach with a thisArg.
  // oxlint-disable-next-line unicorn/no-array-method-this-argument
  const sources = yield* Effect.forEach(searched.matches, (match) =>
    read.handler({ id: match.id }).pipe(
      Effect.map((resource) => ({ match, resource })),
      // Search returns ids from the same in-memory corpus, so a missing read is
      // an internal invariant violation rather than an A2A client failure.
      Effect.orDie
    )
  );

  if (sources.length === 0) {
    return `No public rat-stack law or skill matched: ${question}`;
  }

  return [
    `Source-grounded rat-stack matches for: ${question}`,
    ...sources.map(
      ({ match, resource }) =>
        `## ${resource.title}\nResource: ${resource.id}\nSource: ${resource.sourcePath}\n${match.excerpt}`
    ),
  ].join("\n\n");
});

export const handleA2aRequest = Effect.fn("A2A.handleRequest")(
  function* handleA2aRequest(request: typeof A2aRequest.Type) {
    const question = request.params.message.parts
      .map((part) => part.text)
      .join("\n")
      .trim();

    const answer = yield* answerQuestion(question);
    const messageId = `reply-${request.params.message.messageId}`;

    const contextId =
      request.params.message.contextId ??
      `context-${request.params.message.messageId}`;

    return {
      id: request.id,
      jsonrpc: "2.0" as const,
      result: {
        contextId,
        kind: "message" as const,
        messageId,
        parts: [{ kind: "text" as const, text: answer }],
        role: "agent" as const,
      },
    };
  }
);

export const a2aError = (
  code: number,
  message: string,
  id: string | number | null = null
) => ({
  error: { code, message },
  id,
  jsonrpc: "2.0" as const,
});
