import { expect, it } from "@effect/vitest";
import { PersonIdSchema } from "@rat-stack/database";
import { RuntimeContext } from "alchemy";
import { Context, Effect, Fiber, Layer, Queue, Schema } from "effect";
import type * as Headers from "effect/unstable/http/Headers";
import * as HttpServerRequest from "effect/unstable/http/HttpServerRequest";
import * as HttpServerResponse from "effect/unstable/http/HttpServerResponse";
import { Rpc, RpcClient, RpcGroup, RpcServer } from "effect/unstable/rpc";
import type * as RpcMessage from "effect/unstable/rpc/RpcMessage";

import {
  Auth,
  CurrentPerson,
  CurrentPersonMiddleware,
  CurrentPersonMiddlewareLayer,
  Unauthenticated,
} from "../src/index.js";

const authSecret = "local-test-secret-with-enough-entropy";

const PersonRpcs = RpcGroup.make(
  Rpc.make("currentPerson", {
    payload: Schema.Struct({}),
    success: PersonIdSchema,
  }).middleware(CurrentPersonMiddleware)
);

const personHandler = PersonRpcs.toLayerHandler("currentPerson", () =>
  Effect.map(Effect.context<CurrentPerson>(), (context) =>
    Context.get(context, CurrentPerson)
  )
);

const authAndMiddleware = Layer.provideMerge(
  CurrentPersonMiddlewareLayer,
  Auth.memoryLayer(authSecret)
);

const services = Layer.provideMerge(
  Layer.mergeAll(personHandler, authAndMiddleware),
  RuntimeContext.phantom
);

it.effect("signs up, signs in, reads a session, and protects an RPC call", () =>
  Effect.gen(function* testAuthAndRpc() {
    const auth = yield* Auth;

    const signUp = yield* auth.api.signUpEmail({
      body: {
        email: "auth-test@example.com",
        name: "Auth Test",
        password: "password1234",
      },
    });

    const personId = yield* Schema.decodeEffect(PersonIdSchema)(signUp.user.id);

    const signInResponse = yield* auth.fetch.pipe(
      Effect.provideService(
        HttpServerRequest.HttpServerRequest,
        HttpServerRequest.fromWeb(
          new Request("http://auth.test/auth/sign-in/email", {
            body: JSON.stringify({
              email: "auth-test@example.com",
              password: "password1234",
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          })
        )
      ),
      Effect.flatMap((response) =>
        Effect.sync(() => HttpServerResponse.toWeb(response))
      ),
      Effect.orDie
    );

    expect(signInResponse.status).toBe(200);

    const cookie = signInResponse.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    expect(cookie).not.toBe("");

    const session = yield* auth.getSession(new globalThis.Headers({ cookie }));

    expect(session?.user.id).toBe(personId);

    const responses =
      yield* Queue.unbounded<
        RpcMessage.FromServer<RpcGroup.Rpcs<typeof PersonRpcs>>
      >();

    const server = yield* RpcServer.makeNoSerialization(PersonRpcs, {
      onFromServer: (message) =>
        Queue.offer(responses, message).pipe(Effect.asVoid),
    });

    const { client, write } = yield* RpcClient.makeNoSerialization<
      RpcGroup.Rpcs<typeof PersonRpcs>,
      Unauthenticated
    >(PersonRpcs, {
      onFromClient: ({ message }) => server.write(1, message),
    });

    const callCurrentPerson = (headers: Headers.Input = {}) =>
      Effect.gen(function* performCurrentPersonRequest() {
        const pending = yield* client
          .currentPerson({}, { headers })
          .pipe(Effect.forkChild);

        const response = yield* Queue.take(responses);

        yield* write(response);

        return yield* pending.pipe(Fiber.join);
      });

    const authenticatedPerson = yield* callCurrentPerson({ cookie });

    expect(authenticatedPerson).toBe(personId);

    const anonymousFailure = yield* Effect.flip(callCurrentPerson());

    expect(anonymousFailure).toBeInstanceOf(Unauthenticated);
  }).pipe(Effect.provide(services))
);
