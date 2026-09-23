import { defineContract, implement } from "@rat-stack/capability";
import { PersonIdSchema } from "@rat-stack/database";
import { Effect, Layer, Schema } from "effect";

import { Auth } from "./auth.js";
import { CurrentPerson } from "./current-person.js";
import { TestPersonUnavailable } from "./test-person-unavailable.js";

export { TestPersonUnavailable } from "./test-person-unavailable.js";

export const TEST_PERSON_DOMAIN = "rat.test";

const TEST_PERSON_PASSWORD = "rat-test-person-password";

export const runAsPerson = {
  label: "person id",
  schema: PersonIdSchema,
  tag: CurrentPerson,
} as const;

export const ratTestPersonContract = defineContract("rat_test_person", {
  annotations: { idempotent: true },
  description:
    "Sign a test person in, creating them first if needed, and return their person id and session cookie. Test people always get an @rat.test email and a fixed development password, so this cannot reach a real account. Pass the person id as `as` to rat_call to run a capability as them.",
  failure: TestPersonUnavailable,
  input: Schema.Struct({
    name: Schema.String.check(Schema.isPattern(/^[a-z0-9-]{1,32}$/u)).annotate({
      description:
        "Lowercase letters, digits, and dashes. The email becomes <name>@rat.test.",
    }),
  }),
  output: Schema.Struct({
    cookie: Schema.String,
    email: Schema.String,
    personId: PersonIdSchema,
  }),
});

export const ratTestPerson = implement(ratTestPersonContract, ({ name }) =>
  Effect.gen(function* signInTestPerson() {
    const auth = yield* Auth;
    const email = `${name}@${TEST_PERSON_DOMAIN}`;
    const credentials = { email, password: TEST_PERSON_PASSWORD };

    const unavailable = (message: string) =>
      new TestPersonUnavailable({ message, name });

    const raw = yield* auth.auth;

    const refused = () => unavailable("Better Auth refused the sign-in");

    const signedIn = yield* Effect.tryPromise({
      catch: refused,
      // @effect-diagnostics-next-line asyncFunction:off -- Better Auth's raw API is Promise-based.
      try: async () =>
        await raw.api.signInEmail({ body: credentials, returnHeaders: true }),
    }).pipe(
      Effect.catch(() =>
        Effect.tryPromise({
          catch: refused,
          // @effect-diagnostics-next-line asyncFunction:off -- Better Auth's raw API is Promise-based.
          try: async () =>
            await raw.api.signUpEmail({
              body: { ...credentials, name },
              returnHeaders: true,
            }),
        })
      )
    );

    const cookie = signedIn.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");

    if (cookie === "") {
      return yield* unavailable("Better Auth returned no session cookie");
    }

    const personId = yield* Schema.decodeEffect(PersonIdSchema)(
      signedIn.response.user.id
    ).pipe(
      Effect.mapError(() => unavailable("The user id is not a person id"))
    );

    return { cookie, email, personId };
  })
);

export const testPersonLayer = (name: string) =>
  Layer.effect(
    CurrentPerson,
    ratTestPerson.handler({ name }).pipe(Effect.map(({ personId }) => personId))
  );
