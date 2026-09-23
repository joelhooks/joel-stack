import { PersonIdSchema } from "@rat-stack/database";
import type { RuntimeContext } from "alchemy";
import { Effect, Layer, Schema } from "effect";
import * as RpcMiddleware from "effect/unstable/rpc/RpcMiddleware";

import { Auth } from "./auth.js";
import { CurrentPerson } from "./current-person.js";
import { Unauthenticated } from "./unauthenticated.js";

export class CurrentPersonMiddleware extends RpcMiddleware.Service<
  CurrentPersonMiddleware,
  {
    provides: CurrentPerson;
    requires: RuntimeContext;
  }
>()("@rat-stack/auth/CurrentPersonMiddleware", {
  error: Unauthenticated,
}) {}

export const CurrentPersonMiddlewareLayer = Layer.effect(
  CurrentPersonMiddleware,
  Effect.gen(function* makeCurrentPersonMiddleware() {
    const auth = yield* Auth;

    return (effect, options) =>
      auth.getSession(new Headers({ ...options.headers })).pipe(
        // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Effect.tapError needs an Effect continuation, not a Promise callback.
        Effect.tapError((error) =>
          Effect.logError("Better Auth session lookup failed", error)
        ),
        Effect.orDie,
        Effect.flatMap((session) => {
          if (session === null) {
            return Effect.fail(
              new Unauthenticated({
                message: "A signed-in person is required",
              })
            );
          }

          return Schema.decodeEffect(PersonIdSchema)(session.user.id).pipe(
            Effect.mapError(
              () =>
                new Unauthenticated({
                  message: "The session has no valid person id",
                })
            ),
            Effect.flatMap((personId) =>
              Effect.provideService(effect, CurrentPerson, personId)
            )
          );
        })
      );
  })
);
